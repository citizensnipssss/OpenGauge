/** Existing import screens restore one section at a time, with their normal review. */
export function backupSection(value:unknown,section:'dashboard'|'sensors'):unknown {
  const v=value as Record<string,unknown> | null;
  if(v?.format!=='opengauge-device-backup')return value;
  if(v.schemaVersion!==1||!v.dashboard||typeof v.dashboard!=='object'||Array.isArray(v.dashboard)||
    !v.sensors||typeof v.sensors!=='object'||Array.isArray(v.sensors))throw new Error('Unsupported or incomplete OpenGauge settings backup.');
  return v[section];
}
