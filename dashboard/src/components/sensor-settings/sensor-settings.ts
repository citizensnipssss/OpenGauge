import { connection, deviceUrl } from '../../platform/connection';
import { exportJson } from '../../platform/export';
import {backupSection} from '../../platform/settings-backup';
import { githubList, repoLink, REPO_URL } from '../../community/github';
import { CHANNEL_UNITS, validateDevice, validateProfile, convertPinReading, type DeviceSensors, type SensorProfile } from '../../sensors/model';
import { defaultDevice, allProfiles, saveProfile, profilesFromIssue } from '../../sensors/library';
import { wiringPresets, wiringRatio, saveWiringPreset, bindingWithPreset } from '../../sensors/wiring';
import { restoreSetupDraft } from '../../sensors/draft';

const esc=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const label=(v:string)=>v.replaceAll('_',' ');
const options=(values:{id:string;name:string}[],selected:string)=>values.map(v=>`<option value="${esc(v.id)}" ${v.id===selected?'selected':''}>${esc(v.name)}</option>`).join('');
const clone=<T,>(value:T):T=>structuredClone(value);

export class SensorSettings extends HTMLElement {
  private draft:DeviceSensors=defaultDevice();
  private loaded=false;
  private baseline:DeviceSensors|null=null;
  private tab='overview';
  private libraryFilter='';
  private pendingProfiles=new Set<string>();
  private pendingWiring=new Set<string>();
  private editorDraft:SensorProfile|null=null;
  private communityCards:{profile:SensorProfile;url:string|null}[]=[];
  private communityMessage='';
  private restored=false;
  private backupBlocked=false;
  private storageWarning='';
  private invalidFields=new Set<string>();
  private numericDrafts=new Map<string,string>();
  private busy=false;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private generation=0;
  private message='';
  constructor(){super();this.attachShadow({mode:'open'});}
  private draftKey(){return 'opengauge/setup-draft/'+connection().host;}
  private persist(){
    if(this.backupBlocked)return;
    try{if(this.dirty()||this.editorDraft)localStorage.setItem(this.draftKey(),JSON.stringify({draft:this.draft,baseline:this.baseline,pendingProfiles:[...this.pendingProfiles],pendingWiring:[...this.pendingWiring],numericDrafts:[...this.numericDrafts],invalidFields:[...this.invalidFields],editor:this.editorDraft}));else localStorage.removeItem(this.draftKey());}
    catch{this.storageWarning='Local draft backup unavailable. Export wiring before leaving this page.';return;}
    this.storageWarning='';
  }
  private restore(){
    if(this.restored)return;this.restored=true;
    try{const saved=JSON.parse(localStorage.getItem(this.draftKey())??'null');if(!saved)return;
      if(!confirm('Restore your unsaved setup draft for this device?')){this.backupBlocked=true;this.message='Saved draft kept. Export or discard the backup before replacing it.';return;}
      this.draft=restoreSetupDraft(saved.draft);this.baseline=saved.baseline?validateDevice(saved.baseline):null;this.loaded=!!this.baseline;
      this.pendingProfiles=new Set(saved.pendingProfiles??[]);this.pendingWiring=new Set(saved.pendingWiring??[]);this.editorDraft=saved.editor??null;
      this.numericDrafts=new Map(saved.numericDrafts??[]);this.invalidFields=new Set(saved.invalidFields??[]);
      this.message='Restored local draft. It has not been saved to the device. The device will reject an outdated revision.';
    }catch{this.backupBlocked=true;this.message='Could not restore the local draft. The backup is kept; export it or explicitly discard it.';}
  }
  async open(channel?:string){
    this.restore();if(channel)this.tab='setup';this.style.display='block';this.render();
    if(!connection().demo&&!this.baseline&&!this.dirty())await this.load();else void this.refreshInputs();
    if(channel){const card=Array.from(this.shadowRoot!.querySelectorAll<HTMLElement>('[data-reading]')).find(el=>el.dataset.reading===channel);const details=card?.querySelector('details');if(details)details.open=true;card?.scrollIntoView({block:'start'});if(!card)this.status('No assignment for '+label(channel)+'. Choose Add sensor assignment in Setup.');}
  }
  private close(force=false){
    if(!force&&(this.dirty()||this.editorDraft)&&!confirm('Leave setup? Your unsaved draft is kept locally; no changes will be saved to the device.'))return;
    this.persist();this.style.display='none';this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=null;
  }
  disconnectedCallback(){this.close(true);}
  private status(message:string){this.message=message;const el=this.shadowRoot?.querySelector('#message');if(el)el.textContent=message;}
  private async request(path:string,init:RequestInit={}){
    const response=await fetch(deviceUrl(path),{...init,signal:AbortSignal.timeout(8000)});
    if(!response.ok){const detail=(await response.text()).trim().slice(0,300);throw new Error(response.status===404?'Install the sensor configuration firmware before loading or saving.':response.status===409?'Device settings changed. Export your draft, then Load from device to check before saving.':`Device returned ${response.status}: ${detail||'request failed'}`);}
    return response.json();
  }
  private async load(){
    if(connection().demo){this.status('Demo mode: edit and export a draft. Connect to the device to save wiring.');return;}
    if(this.dirty()&&!confirm('Load device settings and replace your unsaved draft?'))return;
    this.busy=true;this.render();
    try{this.draft=validateDevice(await this.request('/api/sensor-config'));this.loaded=true;this.baseline=clone(this.draft);this.pendingProfiles.clear();this.pendingWiring.clear();this.invalidFields.clear();this.numericDrafts.clear();this.status('Loaded from device. Changes stay in this draft until you save.');}
    catch(e){this.loaded=false;this.status((e as Error).message);}
    finally{this.busy=false;this.render();void this.refreshInputs();}
  }
  private async save(){
    if(!this.loaded||connection().demo||this.busy)return;
    try{
      const validated=this.validateDraft();if(!await this.review(validated))return;this.busy=true;this.render();
      this.draft=validateDevice(await this.request('/api/sensor-config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(validated)}));
      this.numericDrafts.clear();this.invalidFields.clear();this.baseline=clone(this.draft);this.status('Saved on the device. Assignments remain after restart.');
    }catch(e){const error=e as Error;this.status(error.name==='TimeoutError'||error.name==='AbortError'||error instanceof TypeError?'Save result unknown. Your draft is kept. Export it, then Load from device to check.':error.message);}
    finally{this.busy=false;this.render();}
  }
  private dirty(){return this.invalidFields.size>0||JSON.stringify(this.draft)!==JSON.stringify(this.baseline??defaultDevice());}
  private validateDraft(){
    if(this.invalidFields.size)throw new Error('Correct the highlighted numeric fields before saving or exporting.');
    if(this.draft.sensors.some(s=>this.pendingProfiles.has(s.id)||this.pendingWiring.has(s.id)))throw new Error('Choose a sensor profile and wiring for each new assignment, or remove unfinished assignments before saving or exporting.');
    return validateDevice(this.draft);
  }
  private compatibleProfiles(sensor:DeviceSensors['sensors'][number],type:string|undefined){return this.profiles().filter(p=>p.unit===CHANNEL_UNITS[sensor.channel]&&((type==='mcp9601')===(p.kind==='thermocouple-k')));}
  private addBoard(){
    if(this.draft.boards.length>=6){this.status('Maximum six boards.');return;}
    for(const type of ['ads1115','mcp9601'] as const){
      if(this.draft.boards.filter(b=>b.type===type).length>=(type==='ads1115'?4:2))continue;
      const address=Array.from({length:type==='ads1115'?4:8},(_,n)=>n+(type==='ads1115'?72:96)).find(a=>!this.draft.boards.some(b=>b.connection.address===a));
      if(address!==undefined){this.draft.boards.push({id:'board-'+Date.now(),type,connection:{type:'i2c',bus:'Wire',address}});this.render();return;}
    }
    this.status('No free supported board address.');
  }
  private addSensor(){
    for(const channel of Object.keys(CHANNEL_UNITS).filter(c=>!this.draft.sensors.some(s=>s.channel===c))){
      for(const board of this.draft.boards){
        const input=Array.from({length:board.type==='ads1115'?4:1},(_,n)=>n).find(n=>!this.draft.sensors.some(s=>s.boardId===board.id&&s.input===n));
        const profile=this.profiles().find(p=>p.unit===CHANNEL_UNITS[channel]&&((board.type==='mcp9601')===(p.kind==='thermocouple-k')));
        if(input===undefined||!profile)continue;
        const id='sensor-'+Date.now();this.draft.sensors.push({id,boardId:board.id,input,channel,enabled:false,dividerRatio:1,offset:0,profile:clone(profile)});this.pendingProfiles.add(id);if(board.type==='ads1115')this.pendingWiring.add(id);this.render();
        const card=Array.from(this.shadowRoot!.querySelectorAll<HTMLElement>('[data-reading]')).find(el=>el.dataset.reading===channel);const details=card?.querySelector('details');if(details)details.open=true;card?.scrollIntoView({block:'start'});return;
      }
    }
    this.status('No free input with a compatible reading/profile. Add a supported board or a matching profile.');
  }
  private updateNumber(input:HTMLInputElement){
    const index=Number(input.dataset.sensor),sensor=this.draft.sensors[index],field=input.dataset.field as 'input'|'dividerRatio'|'offset',key=sensor.id+':'+field,value=Number(input.value);
    this.numericDrafts.set(key,input.value);
    const invalid=!input.value.trim()||!Number.isFinite(value)||(field==='dividerRatio'&&(value<0.01||value>1))||(field==='offset'&&Math.abs(value)>10000);
    if(invalid){this.invalidFields.add(key);input.setAttribute('aria-invalid','true');this.status('Enter a finite number; ratio must be 0.01–1 and offset within ±10000.');}
    else{this.invalidFields.delete(key);input.removeAttribute('aria-invalid');sensor[field]=value;if(field==='dividerRatio')this.pendingWiring.delete(sensor.id);}
    this.persist();
    const state=this.shadowRoot!.querySelector('#draftState');if(state)state.textContent=this.dirty()?'Unsaved draft changes':'No draft changes';
    const save=this.shadowRoot!.querySelector<HTMLButtonElement>('#save');if(save)save.disabled=!this.loaded||connection().demo||this.busy||!this.dirty()||this.invalidFields.size>0;
    const enabled=this.shadowRoot!.querySelector<HTMLInputElement>(`[data-sensor="${index}"][data-field="enabled"]`);if(enabled)enabled.disabled=this.pendingProfiles.has(sensor.id)||this.pendingWiring.has(sensor.id)||(sensor.profile.kind==='thermistor-beta'&&!sensor.profile.calibrated);
    this.shadowRoot!.querySelectorAll<HTMLElement>(`[data-offset="${index}"]`).forEach(el=>el.textContent=sensor.offset!==0?' · Offset '+sensor.offset+' '+sensor.profile.unit:'');
  }
  private changeBoard(index:number,type:'ads1115'|'mcp9601'){
    const board=this.draft.boards[index],others=this.draft.boards.filter(b=>b!==board);
    if(others.filter(b=>b.type===type).length>=(type==='ads1115'?4:2)){this.status('Maximum '+(type==='ads1115'?'four ADS1115':'two MCP9601')+' boards.');return;}
    const address=Array.from({length:type==='ads1115'?4:8},(_,n)=>n+(type==='ads1115'?72:96)).find(a=>!others.some(b=>b.connection.address===a));
    if(address===undefined){this.status('No free address for this board type.');return;}
    const incompatible=this.draft.sensors.filter(s=>s.boardId===board.id&&((type==='mcp9601')!==(s.profile.kind==='thermocouple-k')));
    if(incompatible.length&&!confirm('Changing board type removes these draft assignments: '+incompatible.map(s=>label(s.channel)).join(', ')+'. Continue?'))return;
    board.type=type;board.connection.address=address;this.draft.sensors=this.draft.sensors.filter(s=>!incompatible.includes(s));this.status('Board type changed in draft. Review before saving.');
  }
  private async review(next:DeviceSensors):Promise<boolean>{
    const before=this.baseline!;
    const changes:string[]=[];
    const describe=(item:DeviceSensors['boards'][number]|DeviceSensors['sensors'][number])=>'channel' in item
      ? `${label(item.channel)}: ${item.boardId} / input ${item.input}, ${item.profile.name}, ${item.enabled?'Enabled':'Off'}, ratio ${item.dividerRatio}, offset ${item.offset} ${item.profile.unit}`
      : `${item.type.toUpperCase()} (${item.id}), address 0x${item.connection.address.toString(16).toUpperCase()}`;
    for(const kind of ['boards','sensors'] as const){
      for(const item of next[kind]){const previous=before[kind].find(v=>v.id===item.id);if(!previous||JSON.stringify(previous)!==JSON.stringify(item))changes.push(previous?`Change ${describe(previous)} → ${describe(item)}`:`Add ${describe(item)}`);}
      for(const item of before[kind])if(!next[kind].some(v=>v.id===item.id))changes.push(`Remove ${describe(item)}`);
    }
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-labelledby','review-title');
    dialog.innerHTML=`<h2 id="review-title">Review device changes</h2><ul>${changes.map(c=>`<li>${esc(c)}</li>`).join('')}</ul><details><summary>Review all sensor conversion values</summary>${next.sensors.map(s=>`<h3>${esc(label(s.channel))}</h3><dl>${Object.entries(s.profile).map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(Array.isArray(value)?value.join(', '):value)}</dd>`).join('')}</dl>`).join('')}</details><p>${next.sensors.filter(s=>s.enabled).length} enabled sensors. Saving applies this wiring to the board.</p><button id="back">Back to draft</button><button id="apply">Save to device</button>`;
    this.shadowRoot!.append(dialog);dialog.showModal();
    return new Promise(resolve=>{const finish=(value:boolean)=>{dialog.close();dialog.remove();resolve(value);};dialog.querySelector('#back')!.addEventListener('click',()=>finish(false));dialog.querySelector('#apply')!.addEventListener('click',()=>finish(true));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});});
  }
  private profiles(){
    const entries=allProfiles();for(const s of this.draft.sensors)if(!entries.some(p=>p.id===s.profile.id))entries.push(s.profile);return entries;
  }
  private render(){
    const profiles=this.profiles(),presets=wiringPresets(),r=this.shadowRoot!;
    this.invalidFields=new Set([...this.invalidFields].filter(key=>this.draft.sensors.some(sensor=>key.startsWith(sensor.id+':'))));
    const dirty=this.dirty();this.persist();
    const expanded=new Set(Array.from(r.querySelectorAll<HTMLDetailsElement>('details[data-open-id][open]'),el=>el.dataset.openId));
    r.innerHTML=`<style>
      *{box-sizing:border-box} :host{display:none;position:fixed;inset:0;z-index:70;background:#0a0e14;color:#edf2f8;font:16px Arial;overflow:auto;padding:env(safe-area-inset-top) 16px env(safe-area-inset-bottom)}
      [hidden]{display:none!important}.sticky-header{position:sticky;top:0;z-index:3;background:#0a0e14}nav{display:flex;gap:8px;background:#0a0e14;z-index:3;padding:8px 0}nav button{flex:1;margin:0}nav button[aria-current=page]{border-color:#ffbc64;color:#ffbc64}dialog{max-width:550px;width:calc(100% - 32px);background:#151f2e;color:#edf2f8;border:1px solid #425066;border-radius:12px;padding:24px}dialog::backdrop{background:#000a}li{margin:12px 0}.actions{position:sticky;bottom:0;z-index:2;background:#0a0e14;border-top:1px solid #425066;padding:8px 0}.actions p{margin:4px 0;font-size:14px}.summary{font-size:14px}main{max-width:800px;margin:16px auto 48px}h1{font-size:25px}h2{font-size:21px}h3{font-size:18px;margin:0 0 12px}p{line-height:1.5;color:#bac7d7}button,input,select,textarea{font:inherit;min-height:46px;padding:10px;border-radius:8px;border:1px solid #425066;background:#151f2e;color:#edf2f8;max-width:100%}button{cursor:pointer;margin:5px 6px 5px 0}button:disabled{opacity:.4;cursor:default}label{display:block;font-size:14px;color:#c9d2e1}label input:not([type=checkbox]),label select,label textarea{display:block;width:100%;margin-top:5px}input[type=checkbox]{min-height:22px;width:22px;vertical-align:middle}textarea{min-height:90px}article,details{background:#111925;border:1px solid #2e3b50;border-radius:12px;padding:16px;margin:12px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wide{grid-column:1/-1}.row{display:flex;justify-content:space-between;align-items:center;gap:8px}.reading{color:#ffbc64;min-height:24px}#message{color:#ffbc64;line-height:1.5;background:#0a0e14;padding:10px 0;z-index:2}summary{cursor:pointer;min-height:44px;padding:10px 0}a{color:#8ed3ff}.badge{color:#ffbc64;font-size:14px}@media(max-width:420px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
    </style><main><div class="row"><h1>Boards &amp; sensors</h1><button id="close" aria-label="Close boards and sensors">Done</button></div>
    <p>Connect a board input to a sensor, then choose the reading your gauges use. Gauge style and warning limits stay in each gauge’s settings.</p>
    <div class="sticky-header"><p id="message" role="status">${esc(this.storageWarning||this.message|| (connection().demo?'Demo draft • no device settings will be changed.':'Load the device’s settings before saving changes.'))}</p>
    <nav aria-label="Boards and sensors sections">${['overview','setup','library'].map(t=>`<button data-tab="${t}" aria-current="${this.tab===t?'page':'false'}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</nav></div>
    <section ${this.tab==='overview'?'':'hidden'}><h2>${this.baseline?'Your setup':'Example setup'}</h2><p>${this.baseline?'Loaded configuration — draft edits shown':'Example draft — load your device to see its configuration'}. ${dirty?'Unsaved draft changes.':'No draft changes.'}</p>
    ${this.draft.boards.map(b=>`<article><h3>${esc(b.type.toUpperCase())} · 0x${b.connection.address.toString(16).toUpperCase()}</h3><p>${esc(b.id)} · ${this.baseline?'Configured board':'Example board'}</p>${this.draft.sensors.filter(s=>s.boardId===b.id).map((s,i)=>`<p>${b.type==='ads1115'?'A'+s.input:'K input'} → ${esc(label(s.channel))} · ${s.enabled?'Enabled':'Off'}<span data-offset="${i}">${s.offset!==0?' · Offset '+s.offset+' '+esc(s.profile.unit):''}</span></p>`).join('')||'<p>No sensors assigned.</p>'}<button data-edit-board="${esc(b.id)}">Edit assignments</button></article>`).join('')||'<p>No boards configured. Start in Setup.</p>'}
    <button data-go-setup>Configure boards and sensors</button></section>
    <section ${this.tab==='setup'?'':'hidden'}>
    <h2>1. Boards</h2><p>Standard Wire I²C bus. ADS1115 analog inputs must stay within 0–3.3 V. Use a voltage divider for a 5 V sender; select the board’s actual address.</p>
    ${this.draft.boards.map((b,i)=>`<article data-board-card="${esc(b.id)}"><div class="row"><h3>${esc(b.id)}</h3><button data-remove-board="${i}">Remove board</button></div><div class="grid"><label>Board<select data-board="${i}" data-field="type">${options([{id:'ads1115',name:'ADS1115 • four analog inputs'},{id:'mcp9601',name:'MCP9601 / MCP9600 • K thermocouple'}],b.type)}</select></label><label>I²C address<select data-board="${i}" data-field="address">${Array.from({length:b.type==='ads1115'?4:8},(_,n)=>n+(b.type==='ads1115'?72:96)).filter(a=>a===b.connection.address||!this.draft.boards.some(other=>other.id!==b.id&&other.connection.address===a)).map(a=>`<option value="${a}" ${a===b.connection.address?'selected':''}>0x${a.toString(16).toUpperCase()}</option>`).join('')}</select></label></div></article>`).join('')}
    <button id="addBoard">Add board</button><details data-open-id="board-notes"><summary>Board library &amp; wiring notes</summary><p><b>ADS1115:</b> four single-ended analog inputs, 3.3 V supply, gain ±4.096 V. This gain setting does not permit a 5 V pin voltage. Addresses 0x48–0x4B.</p><p><b>MCP9601 / MCP9600:</b> K-type hot junction, addresses 0x60–0x67. Other thermocouple types and buses need additional driver support.</p><p><a href="https://www.ti.com/lit/ds/symlink/ads1115.pdf" target="_blank" rel="noopener noreferrer">ADS1115 datasheet</a> · <a href="https://ww1.microchip.com/downloads/en/DeviceDoc/MCP960X-L0X-RL0X-Data-Sheet-20005426F.pdf" target="_blank" rel="noopener noreferrer">MCP960x datasheet</a></p></details>
    <h2>2. Sensors</h2><p>Choose the board, input and reading, then a matching sensor profile. New assignments start Off.</p>
    ${this.draft.sensors.map((s,i)=>{const b=this.draft.boards.find(b=>b.id===s.boardId);return `<article data-reading="${esc(s.channel)}"><details data-open-id="sensor-${esc(s.id)}"><summary><b>${esc(label(s.channel))}</b> · ${esc(s.boardId)} / ${b?.type==='ads1115'?'A'+s.input:'K input'} · ${s.enabled?'Enabled':'Off'}<span data-offset="${i}">${s.offset!==0?' · Offset '+s.offset+' '+esc(s.profile.unit):''}</span></summary><div class="grid"><label>Board<select data-sensor="${i}" data-field="boardId">${options(this.draft.boards.map(b=>({id:b.id,name:b.id})),s.boardId)}</select></label><label>Input<select data-sensor="${i}" data-field="input">${Array.from({length:b?.type==='ads1115'?4:1},(_,n)=>`<option value="${n}" ${n===s.input?'selected':''}>${b?.type==='ads1115'?'A'+n:'K thermocouple'}</option>`).join('')}</select></label><label>Gauge reading<select data-sensor="${i}" data-field="channel">${options(Object.entries(CHANNEL_UNITS).filter(([id])=>id===s.channel||!this.draft.sensors.some(other=>other.channel===id)).map(([id,u])=>({id,name:label(id)+' ('+u+')'})),s.channel)}</select></label><label>Sensor profile<select data-sensor="${i}" data-field="profile">${this.pendingProfiles.has(s.id)||!profiles.some(p=>p.id===s.profile.id&&p.unit===CHANNEL_UNITS[s.channel]&&((b?.type==='mcp9601')===(p.kind==='thermocouple-k')))?'<option value="" selected>Choose a compatible sensor</option>':''}${options(this.compatibleProfiles(s,b?.type).map(p=>({id:p.id,name:p.name})),this.pendingProfiles.has(s.id)?'':s.profile.id)}</select></label>${b?.type==='ads1115'?`<label>Wiring preset<select data-wiring="${i}"><option value="">${this.pendingWiring.has(s.id)?'Choose Direct / preset or a custom ratio':'Configured ratio '+s.dividerRatio+' — choose to replace'}</option>${options(presets.map(p=>({id:p.id,name:p.name})), '')}</select></label>`:''}<details class="wide" data-open-id="advanced-${esc(s.id)}"><summary>Advanced calibration<span data-offset="${i}">${s.offset!==0?' · Offset '+s.offset+' '+esc(s.profile.unit):''}</span></summary><div class="grid"><label>Input / sender voltage ratio<input data-sensor="${i}" data-field="dividerRatio" type="number" step="any" aria-invalid="${this.invalidFields.has(s.id+':dividerRatio')}" value="${esc(this.numericDrafts.get(s.id+':dividerRatio')??s.dividerRatio)}"></label><label>Calibration offset (${esc(s.profile.unit)})<input data-sensor="${i}" data-field="offset" type="number" step="any" aria-invalid="${this.invalidFields.has(s.id+':offset')}" value="${esc(this.numericDrafts.get(s.id+':offset')??s.offset)}"></label></div></details><label class="wide"><input data-sensor="${i}" data-field="enabled" type="checkbox" ${this.pendingProfiles.has(s.id)||this.pendingWiring.has(s.id)||(s.profile.kind==='thermistor-beta'&&!s.profile.calibrated)?'disabled':''} ${s.enabled?'checked':''}> Enabled</label>${this.pendingProfiles.has(s.id)||this.pendingWiring.has(s.id)?'<p class="wide">Choose a sensor profile and wiring before enabling this input. Advanced accepts a measured custom ratio.</p>':''}</div><p>Equivalent ratio: ${esc(presets.filter(p=>Math.abs(wiringRatio(p)-s.dividerRatio)<1e-6).map(p=>p.name).join(', ')||'Custom')}. Matching ratios do not confirm physical resistor values.</p>${s.offset!==0?`<button data-zero-boost="${i}">Reset offset to 0</button>`:''}<p class="badge">${esc(s.profile.evidence)} • ${s.profile.calibrated?'calibration supplied':'calibration not confirmed'}</p><p>${esc(s.profile.notes)}</p><div class="reading" id="raw-${i}">${connection().demo?'Demo draft • raw hardware readings unavailable':'Live input: waiting for device'}</div><button data-copy="${i}">Customize profile</button><button data-remove="${i}">Remove assignment</button></details></article>`;}).join('')}
    <button id="addSensor">Add sensor assignment</button><button id="refresh">Refresh live inputs</button>
    </section><section ${this.tab==='library'?'':'hidden'}><h2>Reusable library</h2><p>Library items are saved locally. Adding one does not change your device wiring.</p><label>Search local sensors and wiring presets<input id="librarySearch" type="search" value="${esc(this.libraryFilter)}" placeholder="Name, part number or wiring…"></label><p id="libraryCount" role="status"></p>
    <h2>Wiring library</h2><p>Reuse a wiring preset for multiple inputs. Applying it changes the divider ratio only; sensor range and calibration stay separate. Presets are copied into the draft and only saved to the device when you choose Save to device.</p>
    <button id="importPreset">Import wiring preset</button><input id="presetFile" type="file" accept=".json,application/json" hidden>
    ${presets.map(p=>`<article data-library-item="${esc(p.name+' '+('model' in p?p.model:''))}"><h3>${esc(p.name)}</h3><p>Input/sender voltage ratio: ${wiringRatio(p).toFixed(4)}${p.upperOhms===0?' • Direct input, no divider':` • Upper ${p.upperOhms} Ω / lower ${p.lowerOhms} Ω`}</p><button data-export-preset="${esc(p.id)}">Export preset</button></article>`).join('')}
    <details data-open-id="create-wiring"><summary>Create wiring preset</summary><div class="grid"><label>Name<input id="presetName" maxlength="100"></label><label>ID<input id="presetId" maxlength="48" placeholder="my-divider"></label><label>Upper resistor (Ω)<input id="presetUpper" type="number" min="0" value="10000"></label><label>Lower resistor (Ω)<input id="presetLower" type="number" min="1" value="15000"></label></div><p>Upper resistor: sender signal to input. Lower resistor: input to ground. Enter 0 for upper resistance only for a direct input.</p><button id="createPreset">Add to wiring library</button></details>
    <h2>Sensor profiles</h2><p>Profiles contain conversion numbers and wiring notes. Evidence labels are contributor claims; check the part number, source and calibration before using a profile.</p>
    <button id="importProfile">Import sensor profile</button><input id="profileFile" type="file" accept=".json,application/json" hidden><button id="community">Browse community sensors</button><button id="newProfile">Create profile</button>
    <div id="communityResults"></div><div id="editor"></div>
    ${allProfiles().map(p=>`<article data-library-item="${esc(p.name+' '+('model' in p?p.model:''))}"><h3>${esc(p.name)}</h3><p>${esc(p.manufacturer)} ${esc(p.model)} • ${esc(p.kind)} • ${esc(p.unit)}</p><span class="badge">${esc(p.evidence)}</span><p>${esc(p.notes)}</p><button data-edit="${esc(p.id)}">Customize</button><button data-export-profile="${esc(p.id)}">Export for sharing</button></article>`).join('')}
    <p><a href="${REPO_URL}/issues/new?template=sensor-profile.yml" target="_blank" rel="noopener noreferrer">Contribute a sensor profile on GitHub</a>. Export your profile and include datasheets or recorded calibration results.</p></section><div class="actions"><p id="draftState">${dirty?'Unsaved draft changes':this.baseline?'Draft matches loaded settings':'Example draft — not loaded from device'}${connection().demo?' · Demo — no device writes':''}</p><button id="load" ${this.busy?'disabled':''}>Load from device</button><button id="save" ${!this.loaded||connection().demo||this.busy||!dirty?'disabled':''}>Review &amp; save</button><details data-open-id="transfer"><summary>Transfer wiring</summary><button id="export">Export wiring</button><button id="import">Import wiring</button><input id="wiringFile" type="file" accept=".json,application/json" hidden></details><button id="exportBackup" ${this.backupBlocked?'':'hidden'}>Export saved draft backup</button><button id="discardBackup" ${this.backupBlocked?'':'hidden'}>Discard saved backup</button></div></main>`;
    r.querySelectorAll<HTMLDetailsElement>('details[data-open-id]').forEach(el=>el.open=expanded.has(el.dataset.openId));
    r.querySelectorAll<HTMLElement>('[data-tab]').forEach(el=>el.addEventListener('click',()=>{this.tab=el.dataset.tab!;this.render();void this.refreshInputs();}));
    r.querySelector('[data-go-setup]')!.addEventListener('click',()=>{this.tab='setup';this.render();void this.refreshInputs();});
    r.querySelectorAll<HTMLElement>('[data-edit-board]').forEach(el=>el.addEventListener('click',()=>{const id=el.dataset.editBoard;this.tab='setup';this.render();void this.refreshInputs();this.shadowRoot!.querySelector(`[data-board-card="${id}"]`)?.scrollIntoView({block:'start'});}));
    const filter=()=>{const items=Array.from(r.querySelectorAll<HTMLElement>('[data-library-item]'));items.forEach(el=>el.hidden=!el.dataset.libraryItem!.toLowerCase().includes(this.libraryFilter.toLowerCase()));r.querySelector('#libraryCount')!.textContent=items.filter(el=>!el.hidden).length+' local items match';};filter();
    r.querySelector('#librarySearch')!.addEventListener('input',event=>{this.libraryFilter=(event.target as HTMLInputElement).value;filter();});
    if(this.busy)r.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select,textarea').forEach(el=>{if(el.id!=='close')el.disabled=true;});
    r.querySelector('#exportBackup')!.addEventListener('click',()=>{const backup=localStorage.getItem(this.draftKey());if(backup)void exportJson('opengauge-setup-backup.json',backup);});
    r.querySelector('#discardBackup')!.addEventListener('click',()=>{if(!confirm('Permanently discard the saved draft backup?'))return;localStorage.removeItem(this.draftKey());this.backupBlocked=false;this.persist();this.render();});
    r.querySelector('#close')!.addEventListener('click',()=>this.close());
    r.querySelector('#load')!.addEventListener('click',()=>void this.load());r.querySelector('#save')!.addEventListener('click',()=>void this.save());
    r.querySelector('#export')!.addEventListener('click',()=>{try{void exportJson('opengauge-wiring.json',JSON.stringify(this.validateDraft(),null,2));}catch(e){this.status((e as Error).message);}});
    this.importFile('#import','#wiringFile',raw=>{const imported=validateDevice(backupSection(raw,"sensors"));if(this.dirty()&&!confirm('Replace your unsaved draft with imported wiring?'))return;this.pendingProfiles.clear();this.pendingWiring.clear();this.invalidFields.clear();this.numericDrafts.clear();imported.revision=this.draft.revision;this.draft=imported;this.status('Imported into draft. Review before saving. If you have not loaded this device yet, export the draft before loading its settings.');this.render();});
    this.importFile('#importProfile','#profileFile',raw=>{saveProfile(raw);this.status('Added to your local sensor library.');this.render();});
    r.querySelectorAll('[data-board]').forEach(el=>el.addEventListener('change',()=>{const select=el as HTMLSelectElement,b=this.draft.boards[Number(select.dataset.board)];if(select.dataset.field==='address')b.connection.address=Number(select.value);else this.changeBoard(Number(select.dataset.board),select.value as 'ads1115'|'mcp9601');this.render();}));
    this.importFile('#importPreset','#presetFile',raw=>{saveWiringPreset(raw);this.status('Added wiring preset to your local library. Device assignments unchanged.');this.render();});
    r.querySelector('#createPreset')!.addEventListener('click',()=>{try{const value=(id:string)=>(r.querySelector('#'+id) as HTMLInputElement).value;saveWiringPreset({schema:'opengauge-wiring-preset/1',id:value('presetId'),name:value('presetName'),upperOhms:Number(value('presetUpper')),lowerOhms:Number(value('presetLower'))});this.status('Wiring preset added. Select it on each input you want to configure.');this.render();}catch(e){this.status((e as Error).message);}});
    r.querySelectorAll('[data-export-preset]').forEach(el=>el.addEventListener('click',()=>{const p=presets.find(p=>p.id===(el as HTMLElement).dataset.exportPreset)!;void exportJson(p.id+'-wiring.json',JSON.stringify(p,null,2));}));
    r.querySelectorAll('[data-wiring]').forEach(el=>el.addEventListener('change',()=>{try{const select=el as HTMLSelectElement;if(!select.value)return;const i=Number(select.dataset.wiring),preset=presets.find(p=>p.id===select.value);this.draft.sensors[i]=bindingWithPreset(this.draft.sensors[i],preset);this.numericDrafts.delete(this.draft.sensors[i].id+':dividerRatio');this.invalidFields.delete(this.draft.sensors[i].id+':dividerRatio');this.pendingWiring.delete(this.draft.sensors[i].id);this.status('Wiring ratio copied to this draft input. Offset and sensor profile unchanged.');this.render();}catch(e){this.status((e as Error).message);this.render();}}));
    r.querySelectorAll('[data-zero-boost]').forEach(el=>el.addEventListener('click',()=>{const sensor=this.draft.sensors[Number((el as HTMLElement).dataset.zeroBoost)];sensor.offset=0;this.numericDrafts.delete(sensor.id+':offset');this.invalidFields.delete(sensor.id+':offset');this.status('Offset reset to 0 in this draft. Choose Save to device to apply.');this.render();}));
    r.querySelectorAll<HTMLInputElement>('[data-sensor][type=number]').forEach(el=>el.addEventListener('input',()=>this.updateNumber(el)));
    r.querySelectorAll('[data-sensor]').forEach(el=>el.addEventListener('change',()=>{const input=el as HTMLInputElement,s=this.draft.sensors[Number(input.dataset.sensor)],field=input.dataset.field!;if(input.type==='number'){this.updateNumber(input);return;}if(field==='profile'){const profile=profiles.find(p=>p.id===input.value);if(!profile)return;s.profile=clone(profile);if(profile.kind==='thermistor-beta'&&!profile.calibrated)s.enabled=false;this.pendingProfiles.delete(s.id);}else if(field==='enabled')s.enabled=input.checked;else if(field==='input'||field==='dividerRatio'||field==='offset'){const value=Number(input.value);if(!input.value.trim()||!Number.isFinite(value)||(field==='dividerRatio'&&(value<0.01||value>1))){this.status('Enter a finite number; divider ratio must be 0.01–1.');this.render();return;}s[field]=value;if(field==='dividerRatio')this.pendingWiring.delete(s.id);}else if(field==='boardId'){s.boardId=input.value;s.input=0;s.enabled=false;this.pendingProfiles.add(s.id);if(this.draft.boards.find(b=>b.id===s.boardId)?.type==='ads1115')this.pendingWiring.add(s.id);else{this.pendingWiring.delete(s.id);s.dividerRatio=1;}this.status('Board changed. Choose a compatible sensor and confirm wiring before enabling.');}else if(field==='channel'){s.channel=input.value;s.enabled=false;s.offset=0;this.pendingProfiles.add(s.id);}this.render();}));
    r.querySelectorAll('[data-remove-board]').forEach(el=>el.addEventListener('click',()=>{const i=Number((el as HTMLElement).dataset.removeBoard),id=this.draft.boards[i].id;const assigned=this.draft.sensors.filter(s=>s.boardId===id);if(assigned.length&&!confirm('Remove this board and unassign '+assigned.map(s=>label(s.channel)).join(', ')+' from the draft?'))return;this.draft.boards.splice(i,1);this.draft.sensors=this.draft.sensors.filter(s=>s.boardId!==id);this.render();}));
    r.querySelectorAll('[data-remove]').forEach(el=>el.addEventListener('click',()=>{this.draft.sensors.splice(Number((el as HTMLElement).dataset.remove),1);this.render();}));
    r.querySelector('#addBoard')!.addEventListener('click',()=>this.addBoard());
    r.querySelector('#addSensor')!.addEventListener('click',()=>this.addSensor());
    r.querySelector('#refresh')!.addEventListener('click',()=>void this.refreshInputs());
    r.querySelector('#community')!.addEventListener('click',()=>void this.community());
    r.querySelector('#newProfile')!.addEventListener('click',()=>this.editor(allProfiles()[0]));
    r.querySelectorAll('[data-copy]').forEach(el=>el.addEventListener('click',()=>this.editor(this.draft.sensors[Number((el as HTMLElement).dataset.copy)].profile)));
    r.querySelectorAll('[data-edit]').forEach(el=>el.addEventListener('click',()=>this.editor(profiles.find(p=>p.id===(el as HTMLElement).dataset.edit)!)));
    r.querySelectorAll('[data-export-profile]').forEach(el=>el.addEventListener('click',()=>{const p=profiles.find(p=>p.id===(el as HTMLElement).dataset.exportProfile)!;void exportJson(p.id+'.json',JSON.stringify(p,null,2));}));
    this.renderCommunity();if(this.editorDraft)this.editor(this.editorDraft,true);

  }
  private importFile(button:string,input:string,accept:(raw:unknown)=>void){const r=this.shadowRoot!,file=r.querySelector(input) as HTMLInputElement;r.querySelector(button)!.addEventListener('click',()=>file.click());file.addEventListener('change',()=>void(async()=>{try{const f=file.files?.[0];if(!f)return;if(f.size>(button==='#import'?262144:24576))throw new Error('Import file is too large.');accept(JSON.parse(await f.text()));}catch(e){this.status((e as Error).message);}finally{file.value='';}})());}
  private async refreshInputs(){
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    if(this.style.display==='none'||!this.isConnected||!this.baseline||this.tab!=='setup')return;
    const generation=++this.generation;
    try{
      if(connection().demo)throw new Error('Demo draft • raw hardware readings unavailable');
      const raw=await this.request('/api/sensor-inputs');
      if(generation!==this.generation||this.style.display==='none')return;
      if(!raw||!Array.isArray(raw.boards))throw new Error('Invalid device response');
      if(raw.revision!==this.baseline?.revision)this.status('Device settings changed. Export your draft, then Load from device to check.');
      for(const [i,s] of this.draft.sensors.entries()){
        const board=raw.boards.find((b:{id:string})=>b.id===s.boardId),value=board?.inputs?.[s.input];
        const el=this.shadowRoot!.querySelector('#raw-'+i);if(!el)continue;
        if(!board?.present||typeof value!=='number'||!Number.isFinite(value)){el.textContent='Input unavailable';continue;}
        if(board.unit!==(this.draft.boards.find(b=>b.id===s.boardId)?.type==='ads1115'?'V':'°C')){el.textContent='Draft board type differs from the device. Save the configuration before previewing this input.';continue;}
        const preview=s.enabled?convertPinReading(s,value):{value:null,status:'disabled'};
        el.textContent=`Input ${value.toFixed(3)} ${board.unit} → draft ${preview.value===null?preview.status:preview.value.toFixed(1)+' '+s.profile.unit}`;
      }
    }catch(e){if(generation===this.generation)this.shadowRoot!.querySelectorAll('.reading').forEach(el=>el.textContent=(e as Error).message);}
    finally{if(generation===this.generation&&this.style.display!=='none'&&!connection().demo)this.timer=setTimeout(()=>void this.refreshInputs(),1500);}
  }
  private editor(base:SensorProfile,restore=false){
    if(!restore){this.tab='library';this.editorDraft=null;this.render();}
    const p=clone(base);if(!restore){p.id='custom-'+Date.now();p.name=base.name+' (custom)';p.evidence='unverified';p.sources=[];p.calibrated=false;}this.editorDraft=p;this.persist();
    const fields:[keyof SensorProfile,string][]=[['id','Profile ID'],['name','Name'],['manufacturer','Manufacturer'],['model','Part number'],['supplyVoltage','Supply voltage (V)'],['inputMin','Signal at minimum (V)'],['inputMax','Signal at maximum (V)'],['outputMin','Minimum reading'],['outputMax','Maximum reading'],['validMin','Lowest valid signal (V)'],['validMax','Highest valid signal (V)'],['r25','Resistance at 25 °C (Ω)'],['beta','Beta coefficient (K)'],['referenceResistance','Reference resistor (Ω)'],['referenceVoltage','Divider supply (V)'],['pinout','Pinout / wiring'],['notes','Calibration and test notes']];
    const target=this.shadowRoot!.querySelector('#editor')!;
    target.innerHTML=`<article><h3>Create your sensor profile</h3><p>For a thermistor: supply → reference resistor → input node → thermistor → ground. Enter measured or documented values; placeholder values are not calibration.</p><form id="profileEditor"><div class="grid"><label>Conversion<select name="kind">${options([{id:'linear-voltage',name:'Linear voltage'},{id:'thermistor-beta',name:'Thermistor Beta'},{id:'thermocouple-k',name:'K thermocouple'}],p.kind)}</select></label><label>Units<select name="unit">${options([...new Set(Object.values(CHANNEL_UNITS))].map(id=>({id,name:id})),p.unit)}</select></label>${fields.map(([key,name])=>`<label data-param="${key}">${esc(name)}${key==='notes'||key==='pinout'?`<textarea name="${key}">${esc(p[key])}</textarea>`:`<input name="${key}" ${typeof p[key]==='number'?'type="number" step="any"':'type="text"'} value="${esc(p[key])}" ${key==='id'||key==='name'?'required':''}>`}</label>`).join('')}<label>Evidence<select name="evidence">${options([{id:'unverified',name:'Unverified'},{id:'datasheet-backed',name:'Datasheet backed'},{id:'hardware-tested',name:'Hardware tested'}],p.evidence)}</select></label><label>Datasheet / test report links (one per line)<textarea name="sources">${esc(p.sources.join('\n'))}</textarea></label><label class="wide"><input name="calibrated" type="checkbox" ${p.calibrated?'checked':''}> I supplied the calibration values for this sensor.</label></div><button type="submit">Add to local library</button><button id="cancelProfile" type="button">Cancel</button><p id="profileError" role="alert"></p></form></article>`;
    const conversion=target.querySelector('[name=kind]') as HTMLSelectElement;
    const updateFields=()=>{
      const kind=conversion.value;
      for(const key of ['inputMin','inputMax','validMin','validMax']) (target.querySelector(`[data-param=${key}]`) as HTMLElement).hidden=kind!=='linear-voltage';
      for(const key of ['r25','beta','referenceResistance','referenceVoltage']) (target.querySelector(`[data-param=${key}]`) as HTMLElement).hidden=kind!=='thermistor-beta';
      if(kind!=='linear-voltage')(target.querySelector('[name=unit]') as HTMLSelectElement).value='°F';
    };
    conversion.addEventListener('change',updateFields);updateFields();
    target.querySelector('#cancelProfile')!.addEventListener('click',()=>{this.editorDraft=null;this.persist();target.innerHTML='';});
    target.querySelector('form')!.addEventListener('input',()=>{const data=new FormData(target.querySelector('form')!);for(const [key,value] of data)if(key!=='sources'&&key!=='calibrated')(p as unknown as Record<string,unknown>)[key]=typeof base[key as keyof SensorProfile]==='number'?Number(value):String(value);p.sources=String(data.get('sources')??'').split('\n').map(s=>s.trim()).filter(Boolean);p.calibrated=data.get('calibrated')==='on';this.editorDraft=p;this.persist();});
    target.querySelector('form')!.addEventListener('submit',event=>{event.preventDefault();try{const data=new FormData(event.target as HTMLFormElement),raw:Record<string,unknown>={...p};for(const [key,value] of data)raw[key]=typeof p[key as keyof SensorProfile]==='number'?Number(value):String(value);raw.sources=String(data.get('sources')??'').split('\n').map(s=>s.trim()).filter(Boolean);raw.calibrated=data.get('calibrated')==='on';saveProfile(validateProfile(raw));this.editorDraft=null;this.status('Profile saved locally. Select it on the sensor assignment, then save wiring to the device.');this.render();}catch(e){target.querySelector('#profileError')!.textContent=(e as Error).message;}});
    if(!restore)target.scrollIntoView({behavior:'smooth',block:'start'});
  }
  private renderCommunity(){
    const target=this.shadowRoot!.querySelector('#communityResults')!;target.textContent=this.communityMessage;
    for(const {profile,url} of this.communityCards){const card=document.createElement('article'),heading=document.createElement('h3'),info=document.createElement('p'),button=document.createElement('button');heading.textContent=profile.name;info.textContent=profile.evidence+' (contributor claim) • '+profile.notes;button.textContent='Add to local library';button.addEventListener('click',()=>{try{saveProfile(profile);this.status('Imported community profile. Choose it on a sensor assignment.');this.render();}catch(e){this.status((e as Error).message);}});card.append(heading,info,button);if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Read submission and evidence';card.append(a);}target.append(card);}
  }
  private async community(){
    const target=this.shadowRoot!.querySelector('#communityResults')!;target.textContent='Checking community sensor submissions…';
    try{
      const entries=await githubList('issues?state=open&labels=sensor-profile&per_page=100');
      const cards=entries.flatMap(raw=>{const issue=raw as {body?:unknown;html_url?:unknown;pull_request?:unknown};return issue.pull_request?[]:profilesFromIssue(issue.body).map(profile=>({profile,url:repoLink(issue.html_url)}));});
      this.communityCards=cards;this.communityMessage=cards.length?'Contributor submissions • review source and calibration before importing.':'No valid sensor profiles are posted yet.';this.renderCommunity();
    }catch(e){this.communityMessage=(e as Error).message+' Your local library still works offline.';this.renderCommunity();}
  }
}
customElements.define('sensor-settings',SensorSettings);
