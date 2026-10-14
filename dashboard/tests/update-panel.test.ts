import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
registerHooks({resolve(specifier,context,next){
  try{return next(specifier,context);}catch(error){
    if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);
    throw error;
  }
}});
Object.assign(globalThis,{window:{location:{protocol:'http:',hostname:'192.168.4.1'}},customElements:{define(){}},HTMLElement:class {
  style={}; shadowRoot:any;
  attachShadow(){const elements=new Map();return this.shadowRoot={innerHTML:'',querySelector:(key:string)=>{
    if(!elements.has(key))elements.set(key,{disabled:false,textContent:'',addEventListener(){},style:{},firstElementChild:{style:{}}});
    return elements.get(key);
  }};}
}});
const identity={schemaVersion:1,firmwareVersion:'1',firmwareTarget:'arduino-nano-esp32',chipModel:'ESP32-S3',sensorConfigSchema:1,capabilities:{firmwareUpload:false,sensorConfig:true}};
test('capability rejection survives dashboard upload, then legacy reconnect resets it',async()=>{
  const {UpdatePanel}=await import('../src/components/update-panel/update-panel.ts');
  const panel:any=new UpdatePanel();
  globalThis.fetch=async()=>new Response(JSON.stringify(identity));
  await panel.loadDeviceInfo();
  panel.setBusy(true);panel.setBusy(false);
  assert.equal(panel.shadowRoot.querySelector('#fwBtn').disabled,true);
  globalThis.fetch=async()=>new Response('Not found',{status:404});
  await panel.loadDeviceInfo();
  assert.equal(panel.shadowRoot.querySelector('#fwBtn').disabled,false);
  assert.equal(panel.deviceInfo,null);
});
test('Demo opens a visible warning with installation disabled',async()=>{
  const {UpdatePanel}=await import('../src/components/update-panel/update-panel.ts');
  (globalThis as any).window.location.protocol='file:';
  const panel:any=new UpdatePanel();panel.open();
  assert.equal(panel.style.display,'block');
  assert.equal(panel.shadowRoot.querySelector('#fwBtn').disabled,true);
  assert.equal(panel.shadowRoot.querySelector('#dashBtn').disabled,true);
  assert.match(panel.shadowRoot.querySelector('#status').textContent,/Demo/);
});
test('failed backup and cancelled review never upload firmware; successful review supplies metadata',async()=>{
  const {UpdatePanel}=await import('../src/components/update-panel/update-panel.ts');
  (globalThis as any).window.location.protocol='http:';
  const bytes=new Uint8Array(32);bytes[0]=0xe9;
  const manifest={schemaVersion:1,firmwareVersion:'v2',buildId:'new',firmwareTarget:identity.firmwareTarget,sensorConfigSchema:1,filename:'fw.bin',size:32,sha256:createHash('sha256').update(bytes).digest('hex')};
  const file=new File([bytes],'fw.bin');const details=new File([JSON.stringify(manifest)],'fw.json');
  const panel:any=new UpdatePanel();let uploads=0;
  panel.readJson=async(path:string)=>path==='/api/device-info'?{...identity,buildId:'old',capabilities:{firmwareUpload:true,sensorConfig:true}}:path==='/api/config'?{}:{schemaVersion:1,revision:0,boards:[],sensors:[]};
  panel.upload=(_file:File,path:string)=>{uploads++;assert.match(path,/sha256=/);assert.match(path,/target=arduino-nano-esp32/);};
  panel.exportBackup=async()=>false;
  await panel.prepareFirmware(file,details);assert.equal(uploads,0);assert.equal(panel.busy,false);
  panel.exportBackup=async()=>true;(globalThis as any).window.confirm=()=>false;
  await panel.prepareFirmware(file,details);assert.equal(uploads,0);assert.equal(panel.busy,false);
  (globalThis as any).window.confirm=()=>true;
  await panel.prepareFirmware(file,details);assert.equal(uploads,1);
});
test('a missing device dashboard uses the app snapshot in the backup',async()=>{
  const {UpdatePanel}=await import('../src/components/update-panel/update-panel.ts');
  const bytes=new Uint8Array(32);bytes[0]=0xe9;
  const manifest={schemaVersion:1,firmwareVersion:'v2',buildId:'new',firmwareTarget:identity.firmwareTarget,sensorConfigSchema:1,filename:'fw.bin',size:32,sha256:createHash('sha256').update(bytes).digest('hex')};
  const panel:any=new UpdatePanel();panel.activeDashboard={layoutId:'local-layout'};
  panel.readJson=async(path:string)=>path==='/api/device-info'?{...identity,capabilities:{firmwareUpload:true,sensorConfig:true}}:path==='/api/config'?null:{schemaVersion:1,revision:0,boards:[],sensors:[]};
  let backup:any;panel.exportBackup=async(value:unknown)=>{backup=value;return true;};
  (globalThis as any).window.confirm=()=>false;
  await panel.prepareFirmware(new File([bytes],'fw.bin'),new File([JSON.stringify(manifest)],'fw.json'));
  assert.deepEqual(backup.dashboard,{layoutId:'local-layout'});assert.equal(backup.deviceDashboard,null);
});
test('lost response after full transfer verifies firmware; incomplete transfer never claims success',async()=>{
  const {UpdatePanel}=await import('../src/components/update-panel/update-panel.ts');
  let xhr:any;
  Object.assign(globalThis,{XMLHttpRequest:class {upload:any={};constructor(){xhr=this;}open(){}send(){}}});
  const panel:any=new UpdatePanel();let verifies=0,successes=0;
  panel.upload(new File(['data'],'fw.bin'),'/update','done',()=>successes++,()=>verifies++);
  xhr.onerror();assert.equal(verifies,0);assert.equal(successes,0);assert.equal(panel.busy,false);
  panel.upload(new File(['data'],'fw.bin'),'/update','done',()=>successes++,()=>verifies++);
  xhr.upload.onload();xhr.onerror();assert.equal(verifies,1);assert.equal(successes,0);assert.equal(panel.busy,true);
});
