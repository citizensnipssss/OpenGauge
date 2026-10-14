import seeds from '../../public/config/sensors/profiles.json';
import defaults from '../../public/config/sensors/default_device.json';
import { validateProfile, validateDevice, type SensorProfile } from './model';
const KEY='opengauge/sensor-library/v1';
export const defaultDevice=()=>validateDevice(structuredClone(defaults));
export const builtins=()=>seeds.map(validateProfile);
export function localProfiles():SensorProfile[] {
  try {const raw=JSON.parse(localStorage.getItem(KEY)??'[]');return Array.isArray(raw)?raw.slice(0,100).map(validateProfile):[];}catch{return [];}
}
export function saveProfile(raw:unknown):SensorProfile {
  const p=validateProfile(raw);
  if(builtins().some(b=>b.id===p.id))throw new Error('Give your profile a new ID to keep the starting profiles intact.');
  const entries=localProfiles();if(entries.some(v=>v.id===p.id))throw new Error('This profile ID already exists. Choose a new ID to keep the existing library profile.');if(entries.length>=100)throw new Error('Local library is full.');
  localStorage.setItem(KEY,JSON.stringify([...entries,p]));return p;
}
export function allProfiles(){return [...builtins(),...localProfiles()];}
export function profilesFromIssue(body:unknown):SensorProfile[] {
  if(typeof body!=='string'||body.length>60000)return [];
  const profiles:SensorProfile[]=[];
  for(const match of body.matchAll(/```json\s*([\s\S]*?)```/gi))try{profiles.push(validateProfile(JSON.parse(match[1])));}catch{/* Invalid contributions are not offered. */}
  return profiles.slice(0,8);
}
