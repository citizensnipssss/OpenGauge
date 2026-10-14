import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDeviceInfo} from '../src/platform/device-info.ts';

const info={schemaVersion:1, firmwareVersion:'1.0.0', firmwareTarget:'arduino-nano-esp32', chipModel:'ESP32-S3', sensorConfigSchema:1, capabilities:{firmwareUpload:true,sensorConfig:true}};
test('accepts device identity without inferring a board from its chip',()=>{
  assert.equal(parseDeviceInfo(info).firmwareTarget,'arduino-nano-esp32');
});
test('rejects incomplete and unsupported identity responses',()=>{
  for(const value of [null,{}, {...info,schemaVersion:2}, {...info,firmwareTarget:''}, {...info,capabilities:{}}, {...info,sensorConfigSchema:NaN}]) assert.throws(()=>parseDeviceInfo(value));
});
