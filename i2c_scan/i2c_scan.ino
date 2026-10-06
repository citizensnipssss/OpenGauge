// MCP9601 raw register debug — serves results at http://192.168.4.1/

#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>

const char* AP_SSID = "TruckGauge";
const char* AP_PASS = "";

WebServer server(80);
String result = "";

// Read a single byte from an I2C device register
uint8_t readReg(uint8_t addr, uint8_t reg) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)addr, (uint8_t)1);
  if (Wire.available()) return Wire.read();
  return 0xFF;
}

// Write a single byte to an I2C device register
void writeReg(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

// Read 16-bit big-endian from register
int16_t readReg16(uint8_t addr, uint8_t reg) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)addr, (uint8_t)2);
  if (Wire.available() >= 2) {
    uint8_t msb = Wire.read();
    uint8_t lsb = Wire.read();
    return (int16_t)((msb << 8) | lsb);
  }
  return 0;
}

void handleRoot() {
  String html = "<!DOCTYPE html><html><head>"
    "<meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>MCP9601 Raw Debug</title>"
    "<style>body{background:#0b0e12;color:#eee;font-family:Arial,sans-serif;padding:20px}"
    "pre{font-size:16px;color:#ff9700}a{color:#ff9700}</style></head><body>"
    "<h2>MCP9601 Raw Debug</h2><pre>" + result + "</pre>"
    "<p><a href='/'>Refresh</a></p></body></html>";
  server.send(200, "text/html", html);
}

void setup() {
  Wire.begin();
  Wire.setClock(100000);
  delay(200);
  WiFi.softAP(AP_SSID, AP_PASS);
  server.on("/", handleRoot);
  server.begin();

  uint8_t addr = 0x67;

  // Dump every possible register
  result += "=== Raw register dump (addr 0x67) ===\n";
  uint8_t regs[] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x20};
  const char* names[] = {"0x00 TC temp    ", "0x01 Delta      ", "0x02 Cold junct ",
                          "0x03 Raw ADC    ", "0x04 Status     ", "0x05 Sensor cfg ",
                          "0x06 Device cfg ", "0x20 Device ID  "};
  for (int i = 0; i < 8; i++) {
    int16_t val16 = readReg16(addr, regs[i]);
    uint8_t val8  = readReg(addr, regs[i]);
    result += String(names[i]) + " 8bit=0x" + String(val8, HEX)
            + "  16bit=0x" + String((uint16_t)val16, HEX) + "\n";
  }

  // Configure K-type, filter 3, normal mode and read temp
  result += "\n=== After config ===\n";
  writeReg(addr, 0x05, 0x03);  // K-type, filter 3
  writeReg(addr, 0x06, 0x00);  // normal mode
  delay(500);

  int16_t raw = readReg16(addr, 0x00);
  float tC = raw * 0.0625f;
  float tF = tC * 9.0f / 5.0f + 32.0f;
  result += "TC raw: 0x" + String((uint16_t)raw, HEX) + "\n";
  result += "TC temp: " + String(tC, 1) + " C  /  " + String(tF, 1) + " F\n";

  int16_t cj = readReg16(addr, 0x02);
  result += "Cold junct: " + String(cj * 0.0625f, 1) + " C\n";
}

void loop() {
  server.handleClient();
}
