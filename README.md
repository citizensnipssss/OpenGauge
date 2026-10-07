# OpenGauge

An open-source ESP32-based gauge monitor for diesel trucks. Built around a 2001 Dodge Ram 2500 5.9L Cummins, but designed to be adapted for any vehicle.

The idea is simple — put real sensor data on your phone without expensive proprietary monitors. WiFi hotspot from the ESP32, open your browser, done.

---

## What it does

- Reads boost, EGT, fuel pressure, and trans temp from real sensors
- Hosts a gauge dashboard on a local WiFi AP — no app, just a browser
- Logs data to an SD card every 5 seconds
- Updates firmware and dashboard files wirelessly over OTA

---

## Hardware

| Part | Notes |
|------|-------|
| Arduino Nano ESP32 on Connector Carrier | Main controller |
| ADS1115 breakout (I2C) | Analog sensors via voltage divider |
| MCP9601 breakout (I2C) | K-type thermocouple for EGT |
| SD card (via carrier) | Data logging + dashboard file storage |

**Sensors wired in this build:**
- Boost pressure — 0.5–4.5V linear sender, 0–60 PSI
- Fuel pressure — 0.5–4.5V linear sender, 0–25 PSI
- Trans temp — NTC thermistor
- EGT — K-type thermocouple (salvaged from an Edge Juice kit)

---

## Dashboard

Built with TypeScript, Web Components, and SVG. No framework. Served directly from the ESP32's SD card.

- 11 gauge channels available
- 6 layouts (1, 2, 4, 5, 8, or 11 gauges)
- Performance Chrome theme
- Works as a PWA — add to home screen for fullscreen display on your phone

Connect to the `TruckGauge` WiFi AP, open `http://buckifyoutruck.local` (or `192.168.4.1`), and you're in.

---

## Build your own

This project is built to be forked and adapted. The sensor channels, gauge layouts, and warning thresholds are all defined in JSON config files — no code changes needed for most customizations.

To adapt it for your truck:
1. Wire your sensors to the ADS1115 channels
2. Update the channel mapping in `BuckIfYouTruck.ino`
3. Adjust min/max/warning values in `gauge_registry.json`
4. Flash and go

---

## Releases

Each [release](https://github.com/citizensnipssss/OpenGauge/releases) includes:
- **Firmware** `.bin` — flash to the ESP32 via OTA at `http://buckifyoutruck.local/update`
- **Dashboard** `.zip` — upload to the device via the same page

No need to install Arduino IDE or Node.js to update an existing install.

---

## License

MIT — do whatever you want with it. If you build something cool, share it back.
