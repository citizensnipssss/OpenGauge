import type { SensorBinding } from './model';
export type WiringPreset={schema:'opengauge-wiring-preset/1';id:string;name:string;upperOhms:number;lowerOhms:number};
const KEY='opengauge/wiring-presets/v1';
const seeds:WiringPreset[]=[
 {schema:'opengauge-wiring-preset/1',id:'divider-10k-15k',name:'10 kΩ upper / 15 kΩ lower',upperOhms:10000,lowerOhms:15000},
 {schema:'opengauge-wiring-preset/1',id:'direct',name:'Direct input — no divider',upperOhms:0,lowerOhms:10000},
];
export function validateWiringPreset(raw:unknown):WiringPreset{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Select a wiring preset JSON file.');
 const p=raw as Record<string,unknown>;
 if(p.schema!=='opengauge-wiring-preset/1'||Object.keys(p).some(k=>!['schema','id','name','upperOhms','lowerOhms'].includes(k)))throw Error('Unsupported wiring preset format.');
 if(typeof p.id!=='string'||! /^[a-z0-9][a-z0-9-]{0,47}$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100)throw Error('Supply a name and an ID using lowercase letters, numbers and hyphens.');
 if(typeof p.upperOhms!=='number'||!Number.isFinite(p.upperOhms)||p.upperOhms<0||p.upperOhms>10000000||typeof p.lowerOhms!=='number'||!Number.isFinite(p.lowerOhms)||p.lowerOhms<=0||p.lowerOhms>10000000)throw Error('Upper resistance must be nonnegative; lower resistance must be positive.');
 const ratio=p.lowerOhms/(p.upperOhms+p.lowerOhms);
 if(ratio<0.01||ratio>1)throw Error('Divider ratio must be between 0.01 and 1.');
 return {schema:'opengauge-wiring-preset/1',id:p.id,name:p.name.trim(),upperOhms:p.upperOhms,lowerOhms:p.lowerOhms};
}
export function wiringRatio(raw:unknown){const p=validateWiringPreset(raw);return p.lowerOhms/(p.upperOhms+p.lowerOhms);}
export function wiringPresets():WiringPreset[]{
 let entries:WiringPreset[]=[];
 try{const raw=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(raw)||raw.length>100)throw Error();entries=raw.map(validateWiringPreset);if(new Set(entries.map(p=>p.id)).size!==entries.length||entries.some(p=>seeds.some(s=>s.id===p.id)))throw Error();}catch{entries=[];}
 return [...seeds.map(p=>({...p})),...entries];
}
export function saveWiringPreset(raw:unknown):WiringPreset{
 const p=validateWiringPreset(raw),entries=wiringPresets();
 if(entries.some(v=>v.id===p.id))throw Error('This preset ID already exists. Use a new ID.');
 const custom=entries.filter(p=>!seeds.some(s=>s.id===p.id));
 if(custom.length>=100)throw Error('Wiring preset library is full.');
 localStorage.setItem(KEY,JSON.stringify([...custom,p]));return p;
}
export function bindingWithPreset(binding:SensorBinding,preset:unknown):SensorBinding{
 if(binding.profile.kind==='thermocouple-k')throw Error('Thermocouple inputs do not use analog divider presets.');
 const dividerRatio=wiringRatio(preset);
 const maximum=binding.profile.kind==='linear-voltage'?binding.profile.inputMax:binding.profile.referenceVoltage;
 if(binding.enabled&&maximum*dividerRatio>3.3)throw Error('This wiring would exceed the supported 3.3 V input.');
 return {...binding,dividerRatio};
}
