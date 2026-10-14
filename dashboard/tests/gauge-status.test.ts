import {test} from 'node:test';
import assert from 'node:assert/strict';

test('gauge overlays and dimming distinguish stale, offline, faults and recovered samples',async()=>{
  Object.assign(globalThis,{HTMLElement:class {attachShadow(){}},customElements:{define(){}}});
  const {PcGauge}=await import('../src/components/pc-gauge/pc-gauge.ts');
  const gauge:any=new PcGauge();gauge.design={readout:{show:false}};
  gauge.elOverlay={innerHTML:''};gauge.elLive={style:{}};gauge.elDigits={style:{}};
  gauge.channelStatus='good';gauge.connectionStatus='disconnected';gauge.renderOverlay();
  assert.match(gauge.elOverlay.innerHTML,/OFFLINE/);assert.equal(gauge.elDigits.style.opacity,'0.35');
  gauge.connectionStatus='stale';gauge.renderOverlay();assert.match(gauge.elOverlay.innerHTML,/STALE/);
  gauge.connectionStatus='connected';gauge.applyTelemetrySample({status:'stale',value:12,ts:1});assert.match(gauge.elOverlay.innerHTML,/STALE/);assert.equal(gauge.channelStatus,'stale');
  gauge.applyTelemetrySample({status:'fault',value:12,ts:1});assert.match(gauge.elOverlay.innerHTML,/FAULT/);
  gauge.updateIndicator=()=>{};gauge.renderDigits=()=>{};
  gauge.applyTelemetrySample({status:'good',value:14,ts:2});assert.equal(gauge.elOverlay.innerHTML,'');assert.equal(gauge.elDigits.style.opacity,'1');assert.equal(gauge.currentValue,14);
  gauge.def={telemetryKey:'boost',scale:{min:0}};
  const {TelemetryStore}=await import('../src/telemetry/TelemetryStore.ts');gauge.connectStore(new TelemetryStore());
  assert.equal(gauge.hasReading,false);assert.equal(gauge.currentValue,0);assert.match(gauge.elOverlay.innerHTML,/OFFLINE/);
});
