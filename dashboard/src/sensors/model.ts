export const CHANNEL_UNITS: Record<string,string> = {fuel_pressure:'PSI',boost:'PSI',oil_pressure:'PSI',trans_temp:'°F',egt:'°F',coolant_temp:'°F',iat:'°F',rpm:'RPM',speed:'MPH',voltage:'V',engine_load:'%'};
export type Evidence = 'unverified'|'datasheet-backed'|'hardware-tested';
export type SensorProfile = {
  schema:'opengauge-sensor/1'; id:string; name:string; manufacturer:string; model:string;
  kind:'linear-voltage'|'thermistor-beta'|'thermocouple-k'; unit:string; evidence:Evidence;
  supplyVoltage:number; notes:string; sources:string[]; pinout:string; calibrated:boolean;
  inputMin:number; inputMax:number; outputMin:number; outputMax:number; validMin:number; validMax:number;
  r25:number; beta:number; referenceResistance:number; referenceVoltage:number;
};
export type Board = {id:string;type:'ads1115'|'mcp9601';connection:{type:'i2c';bus:'Wire';address:number}};
export type SensorBinding = {id:string;boardId:string;input:number;channel:string;enabled:boolean;dividerRatio:number;offset:number;profile:SensorProfile};
export type DeviceSensors = {schemaVersion:1;revision:number;boards:Board[];sensors:SensorBinding[]};
const object=(raw:unknown):Record<string,unknown>=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Expected an object.');return raw as Record<string,unknown>;};
const text=(v:unknown,max:number,empty=false):string=>{if(typeof v!=='string'||v.length>max||(!empty&&!v.trim()))throw new Error('Missing or oversized profile text.');return v.trim();};
const number=(v:unknown,min:number,max:number):number=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('Sensor values are outside supported limits.');return v;};
const id=(v:unknown)=>{const s=text(v,48);if(!/^[a-z0-9][a-z0-9-]*$/.test(s))throw new Error('IDs use lowercase letters, digits and hyphens.');return s;};
export function validateProfile(raw:unknown):SensorProfile {
  const p=object(raw);
  if(p.schema!=='opengauge-sensor/1')throw new Error('Select an OpenGauge sensor profile JSON file.');
  if(!['linear-voltage','thermistor-beta','thermocouple-k'].includes(String(p.kind)))throw new Error('Unsupported conversion type.');
  if(!['unverified','datasheet-backed','hardware-tested'].includes(String(p.evidence)))throw new Error('Invalid evidence level.');
  if(!Object.values(CHANNEL_UNITS).includes(String(p.unit)))throw new Error('Unsupported units.');
  if(typeof p.calibrated!=='boolean')throw new Error('Calibration status is required.');
  if(!Array.isArray(p.sources)||p.sources.length>8)throw new Error('Sources must be a short list of links.');
  const sources=p.sources.map(s=>{const url=text(s,400);if(!/^https?:\/\//i.test(url))throw new Error('Sources must be HTTP or HTTPS links.');const parsed=new URL(url);if(parsed.username||parsed.password)throw new Error('Source links cannot contain credentials.');return parsed.href;});
  if(p.evidence!=='unverified'&&!sources.length)throw new Error('Documented/tested profiles need a datasheet or test report link.');
  const profile:SensorProfile={schema:'opengauge-sensor/1',id:id(p.id),name:text(p.name,100),manufacturer:text(p.manufacturer,80,true),model:text(p.model,80,true),kind:p.kind as SensorProfile['kind'],unit:String(p.unit),evidence:p.evidence as Evidence,supplyVoltage:number(p.supplyVoltage,0,24),notes:text(p.notes,1000,true),sources,pinout:text(p.pinout,400,true),calibrated:p.calibrated,
    inputMin:number(p.inputMin,0,24),inputMax:number(p.inputMax,0,24),outputMin:number(p.outputMin,-10000,100000),outputMax:number(p.outputMax,-10000,100000),validMin:number(p.validMin,0,24),validMax:number(p.validMax,0,24),r25:number(p.r25,1,10000000),beta:number(p.beta,1,10000),referenceResistance:number(p.referenceResistance,1,10000000),referenceVoltage:number(p.referenceVoltage,0.1,5.5)};
  if(profile.inputMin>=profile.inputMax||profile.outputMin>=profile.outputMax||profile.validMin>=profile.validMax)throw new Error('Each minimum must be smaller than its maximum.');
  if(profile.kind==='linear-voltage'&&(profile.validMin>profile.inputMin||profile.validMax<profile.inputMax))throw new Error('Valid signal limits must include the conversion endpoints.');
  if(profile.kind!=='linear-voltage'&&profile.unit!=='°F')throw new Error('Temperature profiles output °F in this firmware.');
  return profile;
}
export function validateDevice(raw:unknown):DeviceSensors {
  const d=object(raw); if(d.schemaVersion!==1)throw new Error('Unsupported device configuration version.');
  const revision=number(d.revision,0,2147483646);if(!Number.isInteger(revision))throw new Error('Invalid revision.');
  if(!Array.isArray(d.boards)||d.boards.length>6||!Array.isArray(d.sensors)||d.sensors.length>11)throw new Error('Maximum: 4 ADS1115 boards, 2 MCP9601 boards and 11 sensors.');
  const boardIds=new Set<string>(),addresses=new Set<number>(); let ads=0,mcp=0;
  const boards:Board[]=d.boards.map(raw=>{const b=object(raw),c=object(b.connection),boardId=id(b.id);if(boardIds.has(boardId))throw new Error('Board IDs must be unique.');boardIds.add(boardId);
    if(c.type!=='i2c'||c.bus!=='Wire')throw new Error('This firmware supports the standard Wire I²C bus.');
    const address=number(c.address,8,119);if(!Number.isInteger(address)||addresses.has(address))throw new Error('I²C addresses must be unique.');addresses.add(address);
    if(b.type==='ads1115'){ads++;if(address<0x48||address>0x4b)throw new Error('ADS1115 address must be 0x48–0x4B.');}else if(b.type==='mcp9601'){mcp++;if(address<0x60||address>0x67)throw new Error('MCP9601 address must be 0x60–0x67.');}else throw new Error('Unsupported board driver.');
    return {id:boardId,type:b.type,connection:{type:'i2c',bus:'Wire',address}};
  });
  if(ads>4||mcp>2)throw new Error('Too many boards of this type.');
  const sensorIds=new Set<string>(),channels=new Set<string>(),inputs=new Set<string>();
  const sensors:SensorBinding[]=d.sensors.map(raw=>{const s=object(raw),sensorId=id(s.id),boardId=id(s.boardId),board=boards.find(b=>b.id===boardId);if(!board)throw new Error('A sensor references a missing board.');
    if(sensorIds.has(sensorId))throw new Error('Sensor IDs must be unique.');sensorIds.add(sensorId);
    if(typeof s.enabled!=='boolean'||typeof s.channel!=='string'||!CHANNEL_UNITS[s.channel])throw new Error('Choose a supported gauge reading.');
    const input=number(s.input,0,board.type==='ads1115'?3:0);if(!Number.isInteger(input))throw new Error('Input must be a whole channel number.');
    const key=`${boardId}:${input}`;if(inputs.has(key)||channels.has(s.channel))throw new Error('Each board input and gauge reading can be assigned only once.');inputs.add(key);channels.add(s.channel);
    const profile=validateProfile(s.profile);
    if((board.type==='mcp9601')!==(profile.kind==='thermocouple-k'))throw new Error('Profile is not compatible with that board.');
    if(profile.unit!==CHANNEL_UNITS[s.channel])throw new Error('Sensor units must match the chosen gauge reading.');
    if(s.enabled&&profile.kind==='thermistor-beta'&&!profile.calibrated)throw new Error('Calibrate the thermistor profile before enabling it.');
    const dividerRatio=number(s.dividerRatio,0.01,1);
    if(s.enabled&&board.type==='ads1115'&&(profile.kind==='linear-voltage'?profile.inputMax:profile.referenceVoltage)*dividerRatio>3.3)throw new Error('The expected ADS1115 input exceeds 3.3 V. Check the voltage divider.');
    return {id:sensorId,boardId,input,channel:s.channel,enabled:s.enabled,dividerRatio,offset:number(s.offset,-10000,10000),profile};
  });
  return {schemaVersion:1,revision,boards,sensors};
}
export function convertReading(p:SensorProfile,input:number,offset=0):{value:number|null;status:'good'|'fault'|'unavailable'} {
  if(!Number.isFinite(input))return {value:null,status:'fault'};
  let value:number;
  if(p.kind==='linear-voltage'){
    if(input<p.validMin||input>p.validMax)return {value:null,status:'fault'};
    value=p.outputMin+(input-p.inputMin)/(p.inputMax-p.inputMin)*(p.outputMax-p.outputMin);
    value=Math.max(p.outputMin,Math.min(p.outputMax,value+offset));
  }else if(p.kind==='thermistor-beta'){
    if(!p.calibrated)return {value:null,status:'unavailable'};
    if(input<=0||input>=p.referenceVoltage)return {value:null,status:'fault'};
    const resistance=p.referenceResistance*input/(p.referenceVoltage-input);
    value=(1/(1/298.15+Math.log(resistance/p.r25)/p.beta)-273.15)*9/5+32+offset;
  }else value=input*9/5+32+offset;
  if(!Number.isFinite(value)||value<p.outputMin||value>p.outputMax)return {value:null,status:'fault'};
  return {value,status:'good'};
}
export function convertPinReading(binding:SensorBinding,input:number){
  if(!binding.enabled)return {value:null,status:'unavailable' as const};
  if(binding.profile.kind==='thermocouple-k')return convertReading(binding.profile,input,binding.offset);
  if(!Number.isFinite(input)||input<0||input>3.3||!Number.isFinite(binding.dividerRatio)||binding.dividerRatio<0.01||binding.dividerRatio>1)return {value:null,status:'fault' as const};
  return convertReading(binding.profile,input/binding.dividerRatio,binding.offset);
}
