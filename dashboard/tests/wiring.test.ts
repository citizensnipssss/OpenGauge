import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDevice,convertPinReading} from '../src/sensors/model.ts';
import {validateWiringPreset,wiringRatio,bindingWithPreset,saveWiringPreset,wiringPresets} from '../src/sensors/wiring.ts';
const seed=JSON.parse(readFileSync(new URL('../public/config/sensors/default_device.json',import.meta.url),'utf8'));
const divider={schema:'opengauge-wiring-preset/1',id:'test-divider',name:'Test divider',upperOhms:10000,lowerOhms:15000};
test('A0 and A1 share divider scaling but preserve distinct ranges, with zero boost offset',()=>{
 const d=validateDevice(seed),fuel=d.sensors[0],boost=d.sensors[1];
 assert.equal(boost.offset,0);assert.equal(fuel.dividerRatio,boost.dividerRatio);
 assert.equal(convertPinReading(fuel,1.5).value,12.5);assert.equal(convertPinReading(boost,1.5).value,30);
 for(const b of [fuel,boost]){
  for(const [volts,status] of [[0.29,'fault'],[0.3,'good'],[0.5,'good'],[4.5,'good'],[4.75,'good'],[4.76,'fault']] as const)assert.equal(convertPinReading(b,volts*0.6).status,status,`${volts} V sender`);
  assert.equal(convertPinReading(b,NaN).status,'fault');assert.equal(convertPinReading(b,3.31).status,'fault');
  assert.equal(convertPinReading({...b,enabled:false},1.5).status,'unavailable');
  assert.equal(convertPinReading({...b,dividerRatio:0},1.5).status,'fault');
 }
});
test('applying a wiring preset changes ratio only and refuses incompatible inputs',()=>{
 const b=validateDevice(seed).sensors[1];b.offset=2;
 const changed=bindingWithPreset(b,divider);assert.equal(wiringRatio(divider),0.6);assert.equal(changed.offset,2);assert.deepEqual(changed.profile,b.profile);
 assert.throws(()=>bindingWithPreset(b,{...divider,upperOhms:0}),/3.3 V/);
 assert.throws(()=>bindingWithPreset(validateDevice(seed).sensors[3],divider),/Thermocouple/);
 for(const raw of [{...divider,lowerOhms:0},{...divider,upperOhms:-1},{...divider,upperOhms:NaN},{...divider,lowerOhms:Infinity},{...divider,unknown:true},{...divider,schema:'wrong'}])assert.throws(()=>validateWiringPreset(raw));
});
test('preset imports stay in the library and duplicate IDs cannot replace existing presets',()=>{
 const data=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)}});
 const d=validateDevice(seed),before=structuredClone(d);
 saveWiringPreset(divider);assert.deepEqual(d,before);assert.ok(wiringPresets().some(p=>p.id===divider.id));
 assert.throws(()=>saveWiringPreset(divider),/already exists/);assert.throws(()=>saveWiringPreset({...divider,id:'divider-10k-15k'}),/already exists/);
});
