import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();
const KEY = 'opengauge/device-connection';
export type Connection = { host: string; demo: boolean };

/** Accept a host only; never allow credentials, paths or script URLs. */
export function validateHost(input: string): string {
  const host = input.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/.test(host)) {
    throw new Error('Enter an IP address or hostname, without http://, a port, or a path.');
  }
  if (host.includes('..')) throw new Error('Invalid hostname.');
  return host;
}

export function connection(): Connection {
  if (!isNative()) {
    const host = window.location.hostname;
    return { host, demo: window.location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved.host === 'string' && typeof saved.demo === 'boolean') {
      return { host: validateHost(saved.host), demo: saved.demo };
    }
  } catch { /* Invalid saved settings use the real device default. */ }
  return { host: '192.168.4.1', demo: false };
}

export function saveConnection(value: Connection) {
  localStorage.setItem(KEY, JSON.stringify({ host: validateHost(value.host), demo: value.demo }));
}

export const websocketUrl = () => `ws://${connection().host}:81/`;
export function deviceUrl(path: string): string {
  return isNative() ? `http://${connection().host}${path}` : path;
}
