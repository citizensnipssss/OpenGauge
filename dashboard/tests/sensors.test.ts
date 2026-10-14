import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateProfile,validateDevice,convertReading} from '../src/sensors/model.ts';
const seed=JSON.parse(readFileSync(new URL('../public/config/sensors/default_device.json',import.meta.url),'utf8'));
const config=()=>structuredClone(seed);

test('default wiring is valid and uncalibrated transmission temperature is disabled',()=>{
  const d=validateDevice(config());assert.equal(d.boards[0].connection.address,0x48);assert.equal(d.boards[1].connection.address,0x67);
  assert.deepEqual(d.sensors.map(s=>[s.input,s.channel]),[[0,'fuel_pressure'],[1,'boost'],[2,'trans_temp'],[0,'egt']]);
  assert.equal(d.sensors[2].enabled,false);
  const header=readFileSync(new URL('../../BuckIfYouTruck/SensorDefaults.h',import.meta.url),'utf8');
  const encoded=header.match(/R"ogcfg\((.*)\)ogcfg"/s);assert.ok(encoded);assert.deepEqual(JSON.parse(encoded[1]),seed);
});
test('linear readings preserve calibration and reject disconnected/out-of-range voltage',()=>{
  const p=validateProfile(seed.sensors[0].profile);assert.equal(convertReading(p,2.5).value,12.5);
  assert.equal(convertReading(p,0).status,'fault');assert.equal(convertReading(p,5).status,'fault');
  assert.equal(convertReading(seed.sensors[1].profile,2.5,seed.sensors[1].offset).value,30);
});
test('thermistor must be calibrated, uses resistor-divider topology, and rejects shorts/opens',()=>{
  const p=validateProfile(seed.sensors[2].profile);assert.equal(convertReading(p,1.65).status,'unavailable');
  p.calibrated=true;assert.ok(Math.abs(convertReading(p,1.65).value!-77)<0.001);
  assert.equal(convertReading(p,0).status,'fault');assert.equal(convertReading(p,3.3).status,'fault');
  const d=config();d.sensors[2].enabled=true;assert.throws(()=>validateDevice(d),/Calibrate/);
});
test('negative thermocouple temperatures are valid readings',()=>{
  assert.equal(convertReading(seed.sensors[3].profile,-40).value,-40);
  assert.equal(convertReading(seed.sensors[3].profile,NaN).status,'fault');
});
test('reject duplicate addresses, board inputs, logical channels and incompatible units',()=>{
  const address=config();address.boards.push(structuredClone(address.boards[0]));address.boards[2].id='another-board';assert.throws(()=>validateDevice(address),/addresses/);
  const input=config();input.sensors[1].input=0;assert.throws(()=>validateDevice(input),/only once/);
  const channel=config();channel.sensors[1].channel='fuel_pressure';assert.throws(()=>validateDevice(channel),/only once/);
  const units=config();units.sensors[0].channel='voltage';assert.throws(()=>validateDevice(units),/units/);
  const driver=config();driver.boards[0].type='unknown';assert.throws(()=>validateDevice(driver),/driver/);
});
test('reject unsafe expected ADC voltage, malformed numbers and unsupported conversion code',()=>{
  const voltage=config();voltage.sensors[0].dividerRatio=1;assert.throws(()=>validateDevice(voltage),/3.3/);
  const nan=config();nan.sensors[0].offset=NaN;assert.throws(()=>validateDevice(nan));
  const code=structuredClone(seed.sensors[0].profile);code.kind='javascript';assert.throws(()=>validateProfile(code),/conversion/);
});
test('documented profiles need evidence links; unverified metadata stays unverified',()=>{
  const p=structuredClone(seed.sensors[0].profile);p.evidence='hardware-tested';assert.throws(()=>validateProfile(p),/report/);
  p.sources=['https://example.com/test-report'];assert.equal(validateProfile(p).evidence,'hardware-tested');
  p.sources=['javascript:alert(1)'];assert.throws(()=>validateProfile(p),/HTTP/);
  p.sources=['https://secret@example.com/test'];assert.throws(()=>validateProfile(p),/credentials/);
});

