/*
 * Truck Gauge Monitor — Phase 3
 * 2001 Dodge Ram 2500 5.9L Cummins / 47RE / VP44
 * Arduino Nano ESP32 (ESP32-S3) on Nano Connector Carrier
 *
 * Sensors (all I2C via Qwiic chain):
 *   ADS1115 @ 0x48
 *     CH0: Fuel pressure  0.5-4.5V -> 0-25 psi  (10k/15k divider)
 *     CH1: Boost pressure 0.5-4.5V -> 0-60 psi  (10k/15k divider)
 *     CH2: Trans temp     thermistor, 10k ref    (R25=10000, Beta=3950 placeholder)
 *     CH3: spare
 *   MCP9601 @ 0x67  K-type thermocouple -> EGT deg F
 *
 * Relays (direct GPIO + 2N2222 transistor):
 *   D2: fan
 *   D3: lights
 *
 * WiFi: AP mode, SSID=TruckGauge, IP=192.168.4.1
 * Dashboard: http://192.168.4.1/         (served from SD /www/)
 * WebSocket: ws://192.168.4.1/ws         (telemetry push ~10Hz)
 * Config:    GET/PUT http://192.168.4.1/api/config
 * Sensors:   GET     http://192.168.4.1/api/sensors
 * Relay:     POST    http://192.168.4.1/api/relay
 * Upload:    GET/POST http://192.168.4.1/upload
 *
 * SD card layout:
 *   /www/index.html
 *   /www/assets/index-*.js
 *   /www/config/gauge_registry.json
 *   /www/config/layout_registry.json
 *   /www/config/theme_performance_chrome.json
 *   /www/manifest.json
 *   /www/favicon.svg
 *   /dashboard-config.json   (user dashboard config, written by PUT /api/config)
 *   /datalog.csv
 */

#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <ArduinoOTA.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <Adafruit_ADS1X15.h>
// MCP9601 driven directly via Wire — Adafruit library begin() fails due to
// device ID register returning 0x00 on this board revision.

// --- Pin assignments ---
#define SD_CS       D4
#define RELAY_FAN   D2
#define RELAY_LIGHT D3

// --- WiFi ---
const char* AP_SSID = "TruckGauge";
const char* AP_PASS = "";   // open network

// --- Sensor objects ---
Adafruit_ADS1115 ads;
#define MCP9601_ADDR       0x67
#define MCP9601_REG_TC     0x00   // Hot junction thermocouple temp (16-bit, 0.0625 C/LSB)
#define MCP9601_REG_SSCFG  0x05   // Sensor config (thermocouple type + filter)
#define MCP9601_REG_DEVCFG 0x06   // Device config (operating mode)
#define MCP9601_REG_DEVID  0x20   // Device ID (high byte should be 0x40)

// Write one byte to MCP9601 register
void mcpWriteReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MCP9601_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

// Read 16-bit big-endian from MCP9601 register
int16_t mcpReadReg16(uint8_t reg) {
  Wire.beginTransmission(MCP9601_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MCP9601_ADDR, (uint8_t)2);
  if (Wire.available() >= 2) {
    uint8_t msb = Wire.read();
    uint8_t lsb = Wire.read();
    return (int16_t)((msb << 8) | lsb);
  }
  return 0;
}

bool mcpInit() {
  // Check device is present and has correct ID
  int16_t devId = mcpReadReg16(MCP9601_REG_DEVID);
  uint8_t idHigh = (devId >> 8) & 0xFF;
  // MCP9600 = 0x40, MCP9601 = 0x41 — accept either
  if (idHigh != 0x40 && idHigh != 0x41) return false;
  // K-type thermocouple (bits 6:4 = 000), filter coeff 3 (bits 2:0 = 011)
  mcpWriteReg(MCP9601_REG_SSCFG, 0x03);
  // Normal operating mode
  mcpWriteReg(MCP9601_REG_DEVCFG, 0x00);
  delay(250);  // Wait for first conversion (~170ms typical)
  return true;
}

float mcpReadThermocouple() {
  int16_t raw = mcpReadReg16(MCP9601_REG_TC);
  return raw * 0.0625f;
}

// --- State ---
struct SensorData {
  float fuelPsi;
  float transTempF;
  float boostPsi;
  float egtF;
  bool  relayFan;
  bool  relayLight;
  // peak hold
  float fuelPsiMin;
  float transTempMax;
  float boostPsiMax;
  float egtMax;
};
SensorData data = {0, 0, 0, 0, false, false, 9999, 0, 0, 0};

bool adsOk  = false;
bool mcpOk  = false;
bool sdOk   = false;

// Sensor read timing — only probe I2C every 100ms to keep loop() non-blocking
unsigned long lastSensorRead = 0;
const unsigned long SENSOR_INTERVAL_MS = 100;

WebServer        server(80);
WebSocketsServer ws(81);     // WebSocket on port 81

// ---------------------------------------------------------------
// Sensor reading
// ---------------------------------------------------------------

#define ADS_GAIN      GAIN_ONE
#define ADS_MV_LSB    0.125f
#define DIVIDER_R1    10000.0f
#define DIVIDER_R2    15000.0f
#define DIVIDER_RATIO (DIVIDER_R2 / (DIVIDER_R1 + DIVIDER_R2))

// Zero offset for boost sensor — atmospheric reads ~4 PSI due to sensor offset.
// Adjust if needed after bench/truck calibration.
#define BOOST_ZERO_OFFSET_PSI  4.0f

float voltToPsi(float v, float psiMax) {
  float psi = (v - 0.5f) / 4.0f * psiMax;
  return constrain(psi, 0, psiMax);
}

// Re-probe the ADS1115 and update adsOk. If previously OK and now missing,
// reset the I2C bus so it doesn't stay hung.
void probeAds() {
  bool detected = ads.begin(0x48);
  if (!detected && adsOk) {
    // Device vanished — recover I2C bus
    Serial.println("ADS1115: lost — resetting I2C bus");
    Wire.end();
    delay(10);
    Wire.begin();
    Wire.setTimeout(3);  // 3ms timeout (ESP32 Wire API)
  }
  adsOk = detected;
}

// Safe single-ended read: returns raw counts, or INT16_MIN on error.
// Wire timeout (set in setup) limits how long a hung bus can block.
int16_t safeReadAds(int channel) {
  int16_t raw = ads.readADC_SingleEnded(channel);
  return raw;
}

float readAdsVolts(int channel) {
  int16_t raw = safeReadAds(channel);
  if (raw == INT16_MIN) return -999.0f;  // sentinel — caller must treat as error
  float vDiv = raw * ADS_MV_LSB / 1000.0f;
  return vDiv / DIVIDER_RATIO;
}

float readFuelPressurePsi() {
  if (!adsOk) return -1;
  float v = readAdsVolts(0);
  if (v < -100.0f) return -1;
  return voltToPsi(v, 25.0f);
}

float readBoostPsi() {
  if (!adsOk) return -1;
  float v = readAdsVolts(1);
  if (v < -100.0f) return -1;
  float psi = voltToPsi(v, 60.0f) - BOOST_ZERO_OFFSET_PSI;
  return max(psi, 0.0f);
}

float readTransTempF() {
  if (!adsOk) return -1;
  const float VREF  = 3.3f;
  const float R_REF = 10000.0f;
  const float R25   = 10000.0f;   // PLACEHOLDER
  const float BETA  = 3950.0f;    // PLACEHOLDER
  const float T25_K = 298.15f;
  int16_t raw = safeReadAds(2);
  if (raw == INT16_MIN) return -1;
  float vOut = raw * ADS_MV_LSB / 1000.0f;
  if (vOut <= 0 || vOut >= VREF) return -1;
  float rTherm = R_REF * vOut / (VREF - vOut);
  float tK = 1.0f / (1.0f/T25_K + (1.0f/BETA) * log(rTherm / R25));
  float tF = (tK - 273.15f) * 9.0f/5.0f + 32.0f;
  return constrain(tF, -40, 400);
}

float readEgtF() {
  if (!mcpOk) return -1;
  float tC = mcpReadThermocouple();
  return tC * 9.0f/5.0f + 32.0f;
}

void updateSensors() {
  // Re-probe ADS each cycle so hot-plug/unplug is detected
  probeAds();

  // Re-probe MCP9601 each cycle
  if (!mcpOk) mcpOk = mcpInit();

  data.fuelPsi    = readFuelPressurePsi();
  data.transTempF = readTransTempF();
  data.boostPsi   = readBoostPsi();
  data.egtF       = readEgtF();

  if (data.fuelPsi    >= 0 && data.fuelPsi    < data.fuelPsiMin)   data.fuelPsiMin   = data.fuelPsi;
  if (data.transTempF >= 0 && data.transTempF > data.transTempMax) data.transTempMax = data.transTempF;
  if (data.boostPsi   >= 0 && data.boostPsi   > data.boostPsiMax)  data.boostPsiMax  = data.boostPsi;
  if (data.egtF       >= 0 && data.egtF       > data.egtMax)       data.egtMax       = data.egtF;
}

// ---------------------------------------------------------------
// WebSocket telemetry
// ---------------------------------------------------------------

// Sequence counter for protocol
static uint32_t wsTxSeq = 0;

// Build and broadcast a telemetry JSON message to all connected clients.
// Uses logical channel keys matching gauge_registry.json telemetryKey fields.
// Marks channels as "unavailable" (value=-1) so the browser can show NO SIGNAL.
void broadcastTelemetry() {
  if (ws.connectedClients() == 0) return;

  char buf[512];
  // Channel status: unavailable if sensor not detected or returned -1
  auto statusStr = [](float v, bool ok) -> const char* {
    if (!ok || v < 0) return "unavailable";
    return "good";
  };

  // Telemetry message — TELEMETRY_PROTOCOL.md format
  snprintf(buf, sizeof(buf),
    "{"
      "\"type\":\"telemetry\","
      "\"version\":1,"
      "\"seq\":%lu,"
      "\"ts\":%lu,"
      "\"values\":{"
        "\"fuel_pressure\":%.1f,"
        "\"boost\":%.1f,"
        "\"trans_temp\":%.1f,"
        "\"egt\":%.0f"
      "}"
    "}",
    (unsigned long)wsTxSeq++,
    (unsigned long)millis(),
    data.fuelPsi    >= 0 ? data.fuelPsi    : 0.0f,
    data.boostPsi   >= 0 ? data.boostPsi   : 0.0f,
    data.transTempF >= 0 ? data.transTempF : 0.0f,
    data.egtF       >= 0 ? data.egtF       : 0.0f
  );
  ws.broadcastTXT(buf);

  // Status message for per-channel availability
  snprintf(buf, sizeof(buf),
    "{"
      "\"type\":\"status\","
      "\"version\":1,"
      "\"device\":\"connected\","
      "\"channels\":{"
        "\"fuel_pressure\":\"%s\","
        "\"boost\":\"%s\","
        "\"trans_temp\":\"%s\","
        "\"egt\":\"%s\""
      "}"
    "}",
    statusStr(data.fuelPsi,    adsOk),
    statusStr(data.boostPsi,   adsOk),
    statusStr(data.transTempF, adsOk),
    statusStr(data.egtF,       mcpOk)
  );
  ws.broadcastTXT(buf);
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  // Browser currently only receives; no inbound messages needed yet.
  (void)num; (void)payload; (void)length;
  if (type == WStype_CONNECTED) {
    Serial.printf("WS client %u connected\n", num);
  } else if (type == WStype_DISCONNECTED) {
    Serial.printf("WS client %u disconnected\n", num);
  }
}

// ---------------------------------------------------------------
// SD logging
// ---------------------------------------------------------------

unsigned long lastLog = 0;
const unsigned long LOG_INTERVAL_MS = 5000;

void logToSd() {
  if (!sdOk) return;
  unsigned long now = millis();
  if (now - lastLog < LOG_INTERVAL_MS) return;
  lastLog = now;
  File f = SD.open("/datalog.csv", FILE_APPEND);
  if (!f) return;
  f.printf("%lu,%.1f,%.1f,%.1f,%.1f\n",
    now, data.fuelPsi, data.transTempF, data.boostPsi, data.egtF);
  f.close();
}

// ---------------------------------------------------------------
// Static file server (serves /www/ tree from SD)
// ---------------------------------------------------------------

// Map file extension to MIME type
const char* mimeType(const String& path) {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".js"))   return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".svg"))  return "image/svg+xml";
  if (path.endsWith(".css"))  return "text/css";
  if (path.endsWith(".ico"))  return "image/x-icon";
  return "application/octet-stream";
}

// Try to serve a file from /www<uri> on SD card.
// Returns true if served.
bool serveFromSd(const String& uri) {
  if (!sdOk) return false;
  String path = "/www" + uri;
  // Directory index
  if (path.endsWith("/")) path += "index.html";
  if (!SD.exists(path)) return false;
  File f = SD.open(path);
  if (!f) return false;
  server.streamFile(f, mimeType(path));
  f.close();
  return true;
}

// ---------------------------------------------------------------
// HTTP API handlers
// ---------------------------------------------------------------

void handleRoot() {
  if (!serveFromSd("/index.html")) {
    // Minimal fallback if SD not present / not yet loaded
    server.send(200, "text/html",
      "<!DOCTYPE html><html><head><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>Truck Gauge</title></head><body style='background:#0b0e12;color:#eee;"
      "font-family:Arial,sans-serif;padding:20px'>"
      "<h2>Truck Gauge Monitor</h2>"
      "<p>SD card not detected or /www/index.html missing.</p>"
      "<p>Upload the dashboard files via <a href='/upload' style='color:#ff9700'>/upload</a>.</p>"
      "</body></html>");
  }
}

// Catch-all for static assets (JS, JSON configs, SVG, manifest, etc.)
void handleStaticFile() {
  if (!serveFromSd(server.uri())) {
    server.send(404, "text/plain", "Not found");
  }
}

// GET /api/sensors — legacy JSON endpoint (kept for backwards compat / debugging)
void handleSensors() {
  char buf[256];
  snprintf(buf, sizeof(buf),
    "{"
    "\"fuel_pressure\":%.1f,\"fuel_pressure_min\":%.1f,"
    "\"trans_temp\":%.1f,\"trans_temp_max\":%.1f,"
    "\"boost\":%.1f,\"boost_max\":%.1f,"
    "\"egt\":%.0f,\"egt_max\":%.0f,"
    "\"relay_fan\":%s,\"relay_light\":%s"
    "}",
    data.fuelPsi, data.fuelPsiMin,
    data.transTempF, data.transTempMax,
    data.boostPsi, data.boostPsiMax,
    data.egtF, data.egtMax,
    data.relayFan   ? "true" : "false",
    data.relayLight ? "true" : "false"
  );
  server.send(200, "application/json", buf);
}

// GET /api/config — return dashboard config JSON from SD
void handleGetConfig() {
  if (!sdOk || !SD.exists("/dashboard-config.json")) {
    server.send(404, "application/json", "{}");
    return;
  }
  File f = SD.open("/dashboard-config.json");
  server.streamFile(f, "application/json");
  f.close();
}

// PUT /api/config — save dashboard config JSON to SD
void handlePutConfig() {
  if (!sdOk) { server.send(500, "text/plain", "SD not available"); return; }
  if (!server.hasArg("plain")) { server.send(400, "text/plain", "No body"); return; }
  String body = server.arg("plain");
  if (SD.exists("/dashboard-config.json")) SD.remove("/dashboard-config.json");
  File f = SD.open("/dashboard-config.json", FILE_WRITE);
  if (!f) { server.send(500, "text/plain", "Write failed"); return; }
  f.print(body);
  f.close();
  server.send(200, "application/json", "{\"ok\":true}");
}

// POST /api/relay — {"relay":"fan"|"lights","state":true|false}
void handleRelay() {
  if (!server.hasArg("plain")) { server.send(400, "text/plain", "No body"); return; }
  String body = server.arg("plain");
  bool isFan   = body.indexOf("\"fan\"")    >= 0;
  bool isLight = body.indexOf("\"lights\"") >= 0;
  bool stateOn = body.indexOf("true")       >= 0;
  if (isFan) {
    data.relayFan = stateOn;
    digitalWrite(RELAY_FAN, stateOn ? HIGH : LOW);
  } else if (isLight) {
    data.relayLight = stateOn;
    digitalWrite(RELAY_LIGHT, stateOn ? HIGH : LOW);
  } else {
    server.send(400, "text/plain", "Unknown relay"); return;
  }
  server.send(200, "application/json", "{\"ok\":true}");
}

// GET /upload — upload form; POST /upload — write file to SD /www/
void handleUploadPage() {
  server.send(200, "text/html",
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Upload</title>"
    "<style>body{background:#0b0e12;color:#eee;font-family:Arial,sans-serif;padding:20px}"
    "input,button{margin-top:10px;display:block;width:100%;padding:12px;font-size:16px;box-sizing:border-box}"
    "button{background:#181c22;color:#ff9700;border:1px solid #ff9700;border-radius:8px;cursor:pointer}"
    "p{color:#9ab;font-size:13px}</style></head>"
    "<body><h2>Upload to SD (/www/)</h2>"
    "<p>Upload the built dashboard files here. Place them so they appear at /www/index.html, "
    "/www/assets/*, /www/config/*, /www/manifest.json on the SD card.</p>"
    "<form method='POST' action='/upload' enctype='multipart/form-data'>"
    "<input type='file' name='file'>"
    "<button type='submit'>Upload</button>"
    "</form></body></html>"
  );
}

File uploadFile;
String uploadPath;

void handleUploadDone() {
  server.send(200, "text/html",
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Done</title>"
    "<style>body{background:#0b0e12;color:#eee;font-family:Arial,sans-serif;padding:20px}"
    "a{color:#ff9700}</style></head>"
    "<body><h2>Upload complete.</h2>"
    "<p><a href='/'>Dashboard</a> &nbsp; <a href='/upload'>Upload another</a></p>"
    "</body></html>"
  );
}

// Ensure all parent directories in a path exist on the SD card
void mkdirP(const String& path) {
  for (int i = 1; i < (int)path.length(); i++) {
    if (path[i] == '/') {
      String dir = path.substring(0, i);
      if (!SD.exists(dir)) SD.mkdir(dir);
    }
  }
}

void handleFileUpload() {
  if (!sdOk) { server.send(500, "text/plain", "SD not available"); return; }
  HTTPUpload& upload = server.upload();
  if (upload.status == UPLOAD_FILE_START) {
    // Use ?path=/www/assets/foo.js if provided, else fall back to /www/<filename>
    if (server.hasArg("path")) {
      uploadPath = server.arg("path");
    } else {
      uploadPath = "/www/" + upload.filename;
    }
    mkdirP(uploadPath);
    if (SD.exists(uploadPath)) SD.remove(uploadPath);
    uploadFile = SD.open(uploadPath, FILE_WRITE);
    Serial.printf("Upload start: %s\n", uploadPath.c_str());
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (uploadFile) uploadFile.write(upload.buf, upload.currentSize);
  } else if (upload.status == UPLOAD_FILE_END) {
    if (uploadFile) { uploadFile.close(); Serial.printf("Upload done: %s (%u bytes)\n", uploadPath.c_str(), upload.totalSize); }
  }
}

void handleNotFound() {
  // Try SD first for any unknown path (catches /assets/*, /config/*, etc.)
  if (!serveFromSd(server.uri())) {
    server.send(404, "text/plain", "Not found");
  }
}

// ---------------------------------------------------------------
// Telemetry timing
// ---------------------------------------------------------------

unsigned long lastTx = 0;
const unsigned long TX_INTERVAL_MS = 100;   // 10 Hz

// ---------------------------------------------------------------
// Setup & loop
// ---------------------------------------------------------------

void setup() {
  Serial.begin(9600);
  delay(1000);

  // Relay pins
  pinMode(RELAY_FAN,   OUTPUT); digitalWrite(RELAY_FAN,   LOW);
  pinMode(RELAY_LIGHT, OUTPUT); digitalWrite(RELAY_LIGHT, LOW);

  // SD card
  SPI.begin(D13, D12, D11, SD_CS);
  if (SD.begin(SD_CS)) {
    sdOk = true;
    Serial.println("SD: OK");
    if (!SD.exists("/datalog.csv")) {
      File f = SD.open("/datalog.csv", FILE_WRITE);
      if (f) { f.println("millis,fuel_psi,trans_f,boost_psi,egt_f"); f.close(); }
    }
    // Ensure /www/ directory exists
    if (!SD.exists("/www")) SD.mkdir("/www");
  } else {
    Serial.println("SD: FAILED");
  }

  // I2C — 3ms timeout prevents bus hang if a device disappears mid-read
  Wire.begin();
  Wire.setTimeout(3);  // 3ms timeout (ESP32 Wire API)

  // ADS1115
  ads.setGain(ADS_GAIN);
  if (ads.begin(0x48)) {
    adsOk = true;
    Serial.println("ADS1115: OK");
  } else {
    Serial.println("ADS1115: NOT FOUND");
  }

  // MCP9601 — driven directly via Wire (library begin() fails on this board revision)
  if (mcpInit()) {
    mcpOk = true;
    Serial.println("MCP9601: OK");
  } else {
    Serial.println("MCP9601: NOT FOUND");
  }

  // WiFi AP
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.printf("WiFi AP: %s  IP: %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());

  // mDNS — device reachable at http://buckifyoutruck.local
  if (MDNS.begin("buckifyoutruck")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("mDNS: http://buckifyoutruck.local");
  } else {
    Serial.println("mDNS: FAILED");
  }

  // HTTP routes
  server.on("/",              HTTP_GET,  handleRoot);
  server.on("/api/sensors",   HTTP_GET,  handleSensors);
  server.on("/api/config",    HTTP_GET,  handleGetConfig);
  server.on("/api/config",    HTTP_PUT,  handlePutConfig);
  server.on("/api/relay",     HTTP_POST, handleRelay);
  server.on("/upload",        HTTP_GET,  handleUploadPage);
  server.on("/upload",        HTTP_POST, handleUploadDone, handleFileUpload);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("HTTP server started on port 80");

  // WebSocket server
  ws.begin();
  ws.onEvent(onWsEvent);
  Serial.println("WebSocket server started on port 81");

  // OTA firmware update
  ArduinoOTA.setHostname("buckifyoutruck");
  ArduinoOTA.setPassword("cummins");
  ArduinoOTA.onStart([]() { Serial.println("OTA: start"); });
  ArduinoOTA.onEnd([]()   { Serial.println("OTA: done"); });
  ArduinoOTA.onError([](ota_error_t e) { Serial.printf("OTA error[%u]\n", e); });
  ArduinoOTA.begin();
  Serial.println("OTA ready (password: cummins)");
}

void loop() {
  ArduinoOTA.handle();
  server.handleClient();
  ws.loop();

  // Rate-limit sensor reads to SENSOR_INTERVAL_MS (100ms).
  // This keeps loop() non-blocking between reads so HTTP/WS stays responsive.
  unsigned long now = millis();
  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = now;
    updateSensors();
    logToSd();
  }

  // Broadcast telemetry at ~10 Hz
  unsigned long txNow = millis();
  if (txNow - lastTx >= TX_INTERVAL_MS) {
    lastTx = txNow;
    broadcastTelemetry();
  }
}
