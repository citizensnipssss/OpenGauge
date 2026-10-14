import {sha256} from '@noble/hashes/sha2.js';
import type {DeviceInfo} from './device-info';

export interface FirmwareManifest {
  schemaVersion: 1;
  firmwareVersion: string;
  buildId: string;
  firmwareTarget: string;
  sensorConfigSchema: number;
  filename: string;
  size: number;
  sha256: string;
}
export function parseFirmwareManifest(value: unknown): FirmwareManifest {
  const v=value as FirmwareManifest;
  const token=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9._-]{1,80}$/.test(s);
  if(!v||v.schemaVersion!==1||!token(v.firmwareVersion)||!token(v.buildId)||!token(v.firmwareTarget)||
     !token(v.filename)||!v.filename.endsWith('.bin')||!Number.isInteger(v.size)||v.size<32||v.size>8*1024*1024||
     v.sensorConfigSchema!==1||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))
    throw new Error('Unsupported or incomplete firmware update details. Choose the release’s firmware JSON file.');
  return v;
}
export function validateFirmwarePackage(info:DeviceInfo,manifest:FirmwareManifest,name:string,data:Uint8Array) {
  if(!info.capabilities.firmwareUpload)throw new Error('This device does not support firmware uploads.');
  if(info.firmwareTarget!==manifest.firmwareTarget)throw new Error('This firmware is for a different board.');
  if(info.sensorConfigSchema!==manifest.sensorConfigSchema)throw new Error('This update needs a settings migration; automatic installation is unavailable.');
  if(!name.toLowerCase().endsWith('.bin')||data.length!==manifest.size)throw new Error('Firmware file does not match the release details.');
  if(data[0]!==0xe9)throw new Error('Not an ESP firmware application image.');
  const digest=Array.from(sha256(data),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==manifest.sha256)throw new Error('Firmware checksum failed. Download the file again.');
}
export function firmwareUploadPath(manifest:FirmwareManifest) {
  return '/update?'+new URLSearchParams({target:manifest.firmwareTarget,version:manifest.firmwareVersion,buildId:manifest.buildId,size:String(manifest.size),sha256:manifest.sha256});
}
export function matchesInstalledFirmware(info:DeviceInfo,manifest:FirmwareManifest) {
  return info.firmwareTarget===manifest.firmwareTarget&&info.firmwareVersion===manifest.firmwareVersion&&info.buildId===manifest.buildId;
}
