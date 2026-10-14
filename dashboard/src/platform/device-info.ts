export interface DeviceInfo {
  schemaVersion: 1;
  firmwareVersion: string;
  firmwareTarget: string;
  chipModel: string;
  buildId?: string;
  sensorConfigSchema: number;
  capabilities: { firmwareUpload: boolean; sensorConfig: boolean };
}

export function parseDeviceInfo(value: unknown): DeviceInfo {
  const v = value as DeviceInfo;
  if (!v || v.schemaVersion !== 1 ||
      !['firmwareVersion', 'firmwareTarget', 'chipModel'].every(key =>
        typeof v[key as keyof DeviceInfo] === 'string' && (v[key as keyof DeviceInfo] as string).length > 0) ||
      (v.buildId !== undefined && (typeof v.buildId !== 'string' || !v.buildId.length)) ||
      !Number.isInteger(v.sensorConfigSchema) || v.sensorConfigSchema < 1 ||
      typeof v.capabilities?.firmwareUpload !== 'boolean' || typeof v.capabilities?.sensorConfig !== 'boolean') {
    throw new Error('Device information is unsupported or incomplete.');
  }
  return v;
}
