import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.citizensnipssss.opengauge',
  appName: 'OpenGauge',
  webDir: 'dist-native',
  ios: { backgroundColor: '#0b0e12', contentInset: 'never' },
  plugins: {
    // Native URLSession bypasses browser CORS for unchanged ESP32 HTTP endpoints.
    CapacitorHttp: { enabled: true },
  },
};
export default config;
