import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketProvider } from '../src/telemetry/WebSocketProvider.ts';

test('telemetry/status protocol, stale timeout, reconnect and stopped callbacks', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: any[] = [];
  class Socket {
    onopen: any; onmessage: any; onclose: any; onerror: any;
    url: string;
    constructor(url: string) { this.url = url; sockets.push(this); }
    close() { this.onclose?.(); }
  }
  Object.assign(globalThis, { WebSocket: Socket });
  const statuses: string[] = [], samples: any[] = [];
  const store = { snapshot:()=>({}), setConnectionStatus: (s: string) => statuses.push(s),
    publish: (...args: any[]) => samples.push(args), publishStatus: (...args: any[]) => samples.push(args) };
  const provider = new WebSocketProvider(store as any, 'ws://192.168.4.1:81/');
  provider.start();
  assert.equal(sockets[0].url, 'ws://192.168.4.1:81/');
  sockets[0].onopen();
  sockets[0].onmessage({ data: JSON.stringify({ type:'telemetry',version:1,seq:1,ts:100,values:{boost:12.3} }) });
  sockets[0].onmessage({ data: JSON.stringify({ type:'status',version:1,device:'connected',channels:{trans_temp:'unavailable'} }) });
  assert.deepEqual(samples, [['boost',12.3,'good'],['trans_temp','unavailable']]);
  t.mock.timers.tick(3000);
  assert.equal(statuses.at(-1),'stale');
  assert.equal(sockets[0].onclose,null); // stale sockets are retired before retry
  t.mock.timers.tick(1000);
  assert.equal(sockets.length,2);
  provider.stop();
  assert.equal(sockets[1].onclose,null);
  t.mock.timers.tick(30000);
  assert.equal(sockets.length,2);
  assert.equal(statuses.at(-1),'disconnected');
});
