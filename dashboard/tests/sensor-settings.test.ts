import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';

// Browser modules use extensionless local imports; resolve them for Node's TS runner.
registerHooks({resolve(specifier,context,next){
  if(specifier.endsWith('.json'))return next(specifier,{...context,importAttributes:{type:'json'}});
  try{return next(specifier,context);}catch(error){
    if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);
    throw error;
  }
},load(url,context,next){if(url.endsWith('.json'))return {format:'module',shortCircuit:true,source:'export default '+readFileSync(new URL(url),'utf8')+';'};return next(url,context);}});
const memory=new Map<string,string>();
Object.assign(globalThis,{window:{location:{protocol:'http:',hostname:'192.168.4.1'}},localStorage:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)},customElements:{define(){}},HTMLElement:class{style={};shadowRoot:any;attachShadow(){const element:any={addEventListener(){},textContent:'',scrollIntoView(){},value:'linear-voltage'};element.querySelector=()=>element;return this.shadowRoot={innerHTML:'',querySelector:()=>element,querySelectorAll:()=>[]};}}});

test('sensor settings separates navigation and protects a cancelled save',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.render();
  assert.match(screen.shadowRoot.innerHTML,/Example setup/);
  assert.match(screen.shadowRoot.innerHTML,/data-tab="library"/);
  assert.match(screen.shadowRoot.innerHTML,/Advanced calibration/);
  screen.baseline=structuredClone(screen.draft);screen.loaded=true;
  screen.draft.sensors[0].offset=1;const before=structuredClone(screen.draft);
  let requests=0;screen.request=async()=>{requests++;};screen.review=async()=>false;
  await screen.save();assert.equal(requests,0);assert.deepEqual(screen.draft,before);
});
test('customizing from Setup switches to Library and survives a render',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.tab='setup';screen.editor(screen.draft.sensors[0].profile);
  assert.equal(screen.tab,'library');const id=screen.editorDraft.id;screen.render();assert.equal(screen.editorDraft.id,id);
});
test('save timeout is described as unknown and preserves the draft',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.render=()=>{};screen.baseline=structuredClone(screen.draft);screen.loaded=true;screen.draft.sensors[0].offset=2;
  screen.review=async()=>true;screen.request=async()=>{throw new DOMException('Timed out','TimeoutError');};await screen.save();assert.match(screen.message,/Save result unknown/);assert.equal(screen.draft.sensors[0].offset,2);
});
test('Done cancel retains an open dirty draft',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.style.display='block';screen.draft.sensors[0].offset=2;Object.assign(globalThis,{confirm:()=>false});screen.close();assert.equal(screen.style.display,'block');
});
test('live inputs are not requested against example configuration',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.style.display='block';screen.isConnected=true;screen.tab='setup';let requests=0;screen.request=async()=>{requests++;};await screen.refreshInputs();assert.equal(requests,0);
});
test('profile choices match both board driver and reading units',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings(),sensor=screen.draft.sensors[0];
  assert.ok(screen.compatibleProfiles(sensor,'ads1115').every((p:any)=>p.unit==='PSI'&&p.kind!=='thermocouple-k'));
  assert.equal(screen.compatibleProfiles(sensor,'mcp9601').length,0);
});
test('unfinished sensor and wiring choices cannot be saved or exported',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.pendingProfiles.add(screen.draft.sensors[0].id);assert.throws(()=>screen.validateDraft(),/Choose a sensor profile and wiring/);
});
test('board type changes reserve a free address and obey instance limits',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.draft.sensors=[];Object.assign(globalThis,{confirm:()=>true});
  screen.draft.boards=[{id:'one',type:'ads1115',connection:{type:'i2c',bus:'Wire',address:72}},{id:'two',type:'mcp9601',connection:{type:'i2c',bus:'Wire',address:96}},{id:'three',type:'ads1115',connection:{type:'i2c',bus:'Wire',address:73}}];
  screen.changeBoard(0,'mcp9601');assert.equal(screen.draft.boards[0].connection.address,97);
  screen.changeBoard(2,'mcp9601');assert.equal(screen.draft.boards[2].type,'ads1115');
});
test('local draft restoration is explicit and retains its baseline',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  memory.clear();const screen:any=new SensorSettings();screen.baseline=structuredClone(screen.draft);screen.draft.sensors[0].offset=5;screen.persist();
  const next:any=new SensorSettings();Object.assign(globalThis,{confirm:()=>true});next.restore();assert.equal(next.draft.sensors[0].offset,5);assert.equal(next.baseline.sensors[0].offset,0);assert.equal(next.dirty(),true);memory.clear();
});
test('unfinished incompatible draft restores without erasing its backup',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  memory.clear();const screen:any=new SensorSettings();screen.baseline=structuredClone(screen.draft);const sensor=screen.draft.sensors[0];sensor.channel='coolant_temp';sensor.enabled=false;screen.pendingProfiles.add(sensor.id);screen.persist();
  const next:any=new SensorSettings();Object.assign(globalThis,{confirm:()=>true});next.restore();next.render();assert.equal(next.draft.sensors[0].channel,'coolant_temp');assert.ok(next.pendingProfiles.has(sensor.id));assert.ok(memory.has(next.draftKey()));memory.clear();
});
test('failed restore never overwrites or deletes the saved backup',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  memory.clear();const screen:any=new SensorSettings();memory.set(screen.draftKey(),'{broken');screen.restore();screen.render();assert.equal(memory.get(screen.draftKey()),'{broken');assert.equal(screen.backupBlocked,true);memory.clear();
});
test('gauge shortcut resolves after device settings load',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  memory.clear();const screen:any=new SensorSettings(),loaded=structuredClone(screen.draft);loaded.sensors=[{...loaded.sensors[0],channel:'boost'}];screen.render=()=>{};
  const details={open:false},card={dataset:{reading:'boost'},querySelector:()=>details,scrollIntoView(){}};
  screen.shadowRoot.querySelectorAll=()=>screen.baseline?[card]:[];screen.request=async()=>loaded;
  await screen.open('boost');assert.equal(details.open,true);assert.doesNotMatch(screen.message,/No assignment/);memory.clear();
});
test('Add board allows thermocouple boards after four analog boards',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.render=()=>{};screen.draft.sensors=[];screen.draft.boards=[72,73,74,75].map((address,i)=>({id:'board-'+i,type:'ads1115',connection:{type:'i2c',bus:'Wire',address}}));screen.addBoard();assert.equal(screen.draft.boards.at(-1).type,'mcp9601');assert.equal(screen.draft.boards.at(-1).connection.address,96);
});
test('Add sensor skips readings without a compatible conversion profile',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const {CHANNEL_UNITS}=await import('../src/sensors/model.ts');const screen:any=new SensorSettings();screen.render=()=>{};
  const profile={...screen.draft.sensors.find((s:any)=>s.profile.unit==='°F').profile,kind:'linear-voltage'};
  screen.profiles=()=>[profile];screen.draft.boards=[{id:'analog',type:'ads1115',connection:{type:'i2c',bus:'Wire',address:72}}];
  screen.draft.sensors=Object.keys(CHANNEL_UNITS).filter(c=>!['rpm','coolant_temp'].includes(c)).map((channel,i)=>({...screen.draft.sensors[0],id:'s-'+i,channel,boardId:'unrelated',input:i}));
  screen.addSensor();assert.equal(screen.draft.sensors.at(-1).channel,'coolant_temp');assert.equal(screen.draft.sensors.at(-1).enabled,false);
});
test('numeric edits update the draft without rebuilding focused controls',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();let renders=0;screen.render=()=>{renders++;};
  screen.updateNumber({dataset:{sensor:'0',field:'offset'},value:'3',removeAttribute(){}});assert.equal(screen.draft.sensors[0].offset,3);assert.equal(renders,0);
});
test('partial invalid numeric input survives draft restoration and remains unsavable',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  memory.clear();const screen:any=new SensorSettings();screen.updateNumber({dataset:{sensor:'0',field:'dividerRatio'},value:'',setAttribute(){}});
  const next:any=new SensorSettings();Object.assign(globalThis,{confirm:()=>true});next.restore();assert.equal(next.numericDrafts.get(next.draft.sensors[0].id+':dividerRatio'),'');assert.throws(()=>next.validateDraft(),/numeric fields/);memory.clear();
});
test('duplicate profile import keeps the existing local library entry',async()=>{
  const {saveProfile,builtins,localProfiles}=await import('../src/sensors/library.ts');memory.clear();const profile={...builtins()[0],id:'custom-duplicate',name:'Original'};saveProfile(profile);
  assert.throws(()=>saveProfile({...profile,name:'Replacement'}),/already exists/);assert.equal(localProfiles()[0].name,'Original');memory.clear();
});
test('failed save retains the dirty draft and loaded baseline',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.render=()=>{};
  screen.baseline=structuredClone(screen.draft);screen.loaded=true;screen.draft.sensors[0].offset=2;
  const before=structuredClone(screen.draft),baseline=structuredClone(screen.baseline);
  screen.review=async()=>true;screen.request=async()=>{throw new Error('Offline');};
  await screen.save();assert.deepEqual(screen.draft,before);assert.deepEqual(screen.baseline,baseline);assert.equal(screen.dirty(),true);assert.equal(screen.busy,false);
});
test('loading over a dirty draft requires confirmation',async()=>{
  const {SensorSettings}=await import('../src/components/sensor-settings/sensor-settings.ts');
  const screen:any=new SensorSettings();screen.draft.sensors[0].offset=3;
  Object.assign(globalThis,{confirm:()=>false});let requests=0;screen.request=async()=>{requests++;};
  await screen.load();assert.equal(requests,0);assert.equal(screen.draft.sensors[0].offset,3);
});
