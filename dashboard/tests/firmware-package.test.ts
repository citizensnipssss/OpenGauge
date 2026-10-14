import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}}});
import {parseFirmwareManifest,validateFirmwarePackage,matchesInstalledFirmware,firmwareUploadPath} from '../src/platform/firmware-package.ts';
import {backupSection} from '../src/platform/settings-backup.ts';
const data=new Uint8Array(32);data[0]=0xe9;
const manifest=parseFirmwareManifest({schemaVersion:1,firmwareVersion:'v1',buildId:'abc123',firmwareTarget:'arduino-nano-esp32',sensorConfigSchema:1,filename:'firmware.bin',size:32,sha256:createHash('sha256').update(data).digest('hex')});
const info={schemaVersion:1 as const,firmwareVersion:'v0',buildId:'old',firmwareTarget:'arduino-nano-esp32',chipModel:'ESP32-S3',sensorConfigSchema:1,capabilities:{firmwareUpload:true,sensorConfig:true}};
test('matching update passes checksum without a secure-context browser API',()=>{validateFirmwarePackage(info,manifest,'firmware.bin',data);assert.match(firmwareUploadPath(manifest),/target=arduino-nano-esp32/);});
test('wrong target, changed file, wrong filename and settings migration block updates',()=>{
  assert.throws(()=>validateFirmwarePackage({...info,firmwareTarget:'other'},manifest,'firmware.bin',data));
  const changed=data.slice();changed[31]=1;
  assert.throws(()=>validateFirmwarePackage(info,manifest,'firmware.bin',changed));
  assert.throws(()=>validateFirmwarePackage(info,manifest,'fw.html',data));
  validateFirmwarePackage(info,manifest,'firmware (1).bin',data);
  assert.throws(()=>validateFirmwarePackage({...info,sensorConfigSchema:2},manifest,'firmware.bin',data));
});
test('reboot verification requires version, target and build to match',()=>{
  assert.equal(matchesInstalledFirmware(info,manifest),false);
  assert.equal(matchesInstalledFirmware({...info,firmwareVersion:'v1'},manifest),false);
  assert.equal(matchesInstalledFirmware({...info,firmwareVersion:'v1',buildId:'abc123'},manifest),true);
});
test('invalid manifests cannot choose paths, oversized binaries or unsupported schemas',()=>{
  for(const bad of [{...manifest,filename:'../firmware.bin'},{...manifest,size:9*1024*1024},{...manifest,schemaVersion:2},{...manifest,sha256:'x'},{...manifest,buildId:''}])assert.throws(()=>parseFirmwareManifest(bad));
});
test('saved update backup can restore either settings section without mixing them',()=>{
  const dashboard={schemaVersion:1,layoutId:'test'};const sensors={schemaVersion:1,boards:[],sensors:[]};
  const backup={format:'opengauge-device-backup',schemaVersion:1,dashboard,sensors};
  assert.equal(backupSection(backup,'dashboard'),dashboard);
  assert.equal(backupSection(backup,'sensors'),sensors);
  assert.equal(backupSection(dashboard,'dashboard'),dashboard);
  assert.throws(()=>backupSection({...backup,schemaVersion:2},'dashboard'));
});
