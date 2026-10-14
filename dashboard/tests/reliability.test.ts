import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DashboardConfigStore} from '../src/store/dashboardConfig.ts';
import {TelemetryStore} from '../src/telemetry/TelemetryStore.ts';
import {WebSocketProvider} from '../src/telemetry/WebSocketProvider.ts';
import {SimulatorProvider} from '../src/telemetry/SimulatorProvider.ts';

const layout=(layoutId:string,ids:string[])=>({layoutId,portrait:{slots:ids.map(slotId=>({slotId}))}});
function configStore(){
  const memory=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k),setItem:(k:string,v:string)=>memory.set(k,v)}});
  const store=new DashboardConfigStore({gauges:[],layouts:{layouts:[layout('large',['a','b','c']),layout('small',['a']),layout('pair',['a','b']),layout('other',['x','y'])]} as any});
  store.save({schemaVersion:1,layoutId:'large',themeId:'old',slots:[{slotId:'a',channelId:'boost',overrides:{max:60}},{slotId:'b',channelId:null,overrides:{min:1}},{slotId:'c',channelId:'egt',overrides:{warningHigh:900}}]});
  return store;
}
test('theme changes preserve every slot and override including gaps',()=>{
  const store=configStore(),slots=structuredClone(store.current!.slots);
  store.startNew('large','new');assert.deepEqual(store.current!.slots,slots);
});
test('layout review reports removed gauges without saving, matches applied mapping',()=>{
  const store=configStore(),before=structuredClone(store.current);
  const preview=store.previewLayout('small');assert.deepEqual(store.current,before);
  assert.deepEqual(preview.dropped.map(s=>s.channelId),['egt']);
  assert.deepEqual(store.startNew('small','old').slots,preview.slots);
});
test('different slot IDs carry assignments and their settings in order',()=>{
  const store=configStore(),preview=store.previewLayout('other');
  assert.equal(preview.dropped.length,0);const next=store.startNew('other','old');
  assert.deepEqual(next.slots.map(s=>s.channelId),['boost','egt']);assert.equal(next.slots[1].overrides.warningHigh,900);
});
class Socket {
  static OPEN=1;static instances:Socket[]=[];readyState=0;
  onopen:any;onmessage:any;onclose:any;onerror:any;
  constructor(_url:string){Socket.instances.push(this);}
  open(){this.readyState=1;this.onopen?.();}
  message(data:string){this.onmessage?.({data});}
  close(){this.readyState=3;this.onclose?.();}
}
function provider(t:any){t.mock.timers.enable({apis:['setTimeout']});Socket.instances=[];Object.defineProperty(globalThis,'WebSocket',{configurable:true,value:Socket});const store=new TelemetryStore();const p=new WebSocketProvider(store,'ws://example');p.start();t.after(()=>p.stop());return {store,p,socket:Socket.instances[0]};}
test('malformed and unsupported messages do not prevent stale reconnect',t=>{
  const {store,socket}=provider(t);socket.open();socket.message(JSON.stringify({type:'telemetry',version:1,seq:1,ts:1,values:{boost:12}}));
  t.mock.timers.tick(2000);socket.message('broken');socket.message(JSON.stringify({type:'status',version:2,device:'connected',channels:{}}));
  t.mock.timers.tick(1000);assert.equal(store.connectionStatus,'stale');assert.equal(socket.readyState,3);
  t.mock.timers.tick(1000);assert.equal(Socket.instances.length,2);
  const recovered=Socket.instances[1];recovered.open();recovered.message(JSON.stringify({type:'telemetry',version:1,seq:2,ts:2,values:{boost:14}}));assert.equal(store.get('boost')?.value,14);
});
test('initial connection timeout retries and stop cancels future retries',t=>{
  const {store,p}=provider(t);t.mock.timers.tick(8000);assert.equal(store.connectionStatus,'disconnected');t.mock.timers.tick(1000);assert.equal(Socket.instances.length,2);p.stop();t.mock.timers.tick(20000);assert.equal(Socket.instances.length,2);
});
test('fault then good recovery and socket close publish expected state',t=>{
  const {store,socket}=provider(t);socket.open();socket.message(JSON.stringify({type:'status',version:1,device:'connected',channels:{boost:'fault'}}));assert.equal(store.get('boost')?.status,'fault');socket.message(JSON.stringify({type:'telemetry',version:1,seq:1,ts:1,values:{boost:8}}));assert.equal(store.get('boost')?.status,'good');socket.close();assert.equal(store.connectionStatus,'disconnected');
});

test('changing a channel clears its calibration but keeps gauge style',()=>{
  const store=configStore();store.current!.slots[0].overrides={min:1,max:60,warningHigh:50,designId:'dial'};
  store.assignChannel('a','egt');assert.deepEqual(store.current!.slots[0].overrides,{designId:'dial'});
});
test('layout changes fill a matching empty slot before dropping a gauge',()=>{
  const store=configStore();store.current!.slots[0].channelId=null;store.current!.slots[1].channelId='boost';
  const preview=store.previewLayout('pair');assert.equal(preview.dropped.length,0);
  assert.deepEqual(preview.slots.map(s=>s.channelId),['egt','boost']);assert.deepEqual(store.startNew('pair','old').slots,preview.slots);
});
test('retry backoff grows for sockets that open but never send telemetry',t=>{
  const {socket}=provider(t);socket.open();t.mock.timers.tick(3000);t.mock.timers.tick(1000);
  Socket.instances[1].open();t.mock.timers.tick(3000);t.mock.timers.tick(1000);assert.equal(Socket.instances.length,2);
  t.mock.timers.tick(1000);assert.equal(Socket.instances.length,3);
});

test('unknown channel status does not hide another channel fault',t=>{
  const {store,socket}=provider(t);socket.open();socket.message(JSON.stringify({type:'status',version:1,device:'connected',channels:{egt:'disabled',boost:'fault'}}));
  assert.equal(store.get('egt')?.status,'unavailable');assert.equal(store.get('boost')?.status,'fault');
});

test('reconnect status cannot revive cached readings or invent zero',t=>{
  const {store,socket}=provider(t);socket.open();socket.message(JSON.stringify({type:'telemetry',version:1,seq:1,ts:1,values:{boost:12}}));
  const timestamp=store.get('boost')!.ts;socket.close();t.mock.timers.tick(1000);
  const next=Socket.instances[1];next.open();next.message(JSON.stringify({type:'status',version:1,device:'connected',channels:{boost:'good',egt:'good'}}));
  assert.equal(store.get('boost')?.status,'stale');assert.equal(store.get('boost')?.ts,timestamp);assert.ok(Number.isNaN(store.get('egt')?.value));assert.equal(store.connectionStatus,'connecting');
  next.message(JSON.stringify({type:'telemetry',version:1,seq:2,ts:2,values:{boost:14}}));assert.equal(store.get('boost')?.status,'good');
});

test('status traffic cannot keep a silent telemetry stream fresh',t=>{
  const {store,socket}=provider(t);socket.open();socket.message(JSON.stringify({type:'telemetry',version:1,seq:1,ts:1,values:{boost:12}}));
  t.mock.timers.tick(2000);socket.message(JSON.stringify({type:'status',version:1,device:'connected',channels:{boost:'good'}}));
  t.mock.timers.tick(1000);assert.equal(store.connectionStatus,'stale');
});
test('omitted fault readings retain their fault label between broadcasts',t=>{
  const {store,socket}=provider(t);socket.open();socket.message(JSON.stringify({type:'status',version:1,device:'connected',channels:{boost:'fault'}}));
  const states:string[]=[];store.subscribe('boost',(_,s)=>states.push(s.status));
  socket.message(JSON.stringify({type:'telemetry',version:1,seq:1,ts:1,values:{}}));
  socket.message(JSON.stringify({type:'status',version:1,device:'connected',channels:{boost:'fault'}}));assert.deepEqual(states,['fault','fault']);
});
test('simulator disconnect survives stop and restart',()=>{
  const store=new TelemetryStore(),sim=new SimulatorProvider(store);sim.setScenario('disconnect');sim.start();
  try{assert.equal(store.connectionStatus,'disconnected');}finally{sim.stop();}
});
