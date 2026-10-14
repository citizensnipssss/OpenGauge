import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Capacitor } from '@capacitor/core';
import { connection, deviceUrl, websocketUrl, saveConnection, validateHost } from '../src/platform/connection.ts';

test('native localhost connects to ESP32, demo is explicit, and browser endpoints stay relative', () => {
  const oldNative = Capacitor.isNativePlatform;
  const data = new Map();
  Object.assign(globalThis, { window: { location: { hostname: 'localhost' } },
    localStorage: { getItem: (k: string) => data.get(k), setItem: (k: string,v: string) => data.set(k,v) } });
  try {
    Capacitor.isNativePlatform = () => true;
    assert.deepEqual(connection(), { host: '192.168.4.1', demo: false });
    assert.equal(websocketUrl(), 'ws://192.168.4.1:81/');
    assert.equal(deviceUrl('/update'), 'http://192.168.4.1/update');
    saveConnection({ host: 'buckifyoutruck.local', demo: true });
    assert.equal(connection().demo, true);
    assert.equal(deviceUrl('/api/sensors'), 'http://buckifyoutruck.local/api/sensors');
    data.set('opengauge/device-connection', '{broken');
    assert.equal(connection().demo, false);
    Capacitor.isNativePlatform = () => false;
    assert.equal(connection().demo, true);
    assert.equal(deviceUrl('/upload?path=/www/index.html'), '/upload?path=/www/index.html');
    (globalThis as any).window.location.hostname = '192.168.4.1';
    assert.equal(connection().demo, false);
  } finally { Capacitor.isNativePlatform = oldNative; }
});

test('reject URLs, credentials, ports and markup in device settings', () => {
  for (const value of ['http://192.168.4.1', 'host:81', 'user@host', '<script>', 'a/b', '', 'a..b']) {
    assert.throws(() => validateHost(value));
  }
  assert.equal(validateHost(' BuckIfYouTruck.local '), 'buckifyoutruck.local');
});
