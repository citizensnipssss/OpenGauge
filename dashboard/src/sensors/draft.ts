import {validateDevice,validateProfile,CHANNEL_UNITS,type DeviceSensors} from './model';

/** Restore editable work without requiring finished driver/unit compatibility. */
export function restoreSetupDraft(raw:unknown):DeviceSensors{
  if(!raw||typeof raw!=='object')throw new Error('Invalid draft');
  const d=raw as DeviceSensors;
  if(!Array.isArray(d.sensors)||d.sensors.length>11)throw new Error('Invalid draft assignments');
  const base=validateDevice({...d,sensors:[]});
  const ids=new Set<string>();
  const sensors=d.sensors.map(s=>{
    if(!s||typeof s!=='object'||typeof s.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,47}$/.test(s.id)||ids.has(s.id))throw new Error('Invalid draft sensor ID');
    ids.add(s.id);
    if(!base.boards.some(b=>b.id===s.boardId)||!Number.isInteger(s.input)||s.input<0||s.input>3||typeof s.channel!=='string'||!Object.hasOwn(CHANNEL_UNITS,s.channel)||typeof s.enabled!=='boolean'||!Number.isFinite(s.dividerRatio)||s.dividerRatio<0.01||s.dividerRatio>1||!Number.isFinite(s.offset)||Math.abs(s.offset)>10000)throw new Error('Invalid draft assignment');
    return {id:s.id,boardId:s.boardId,input:s.input,channel:s.channel,enabled:s.enabled,dividerRatio:s.dividerRatio,offset:s.offset,profile:validateProfile(s.profile)};
  });
  return {...base,sensors};
}
