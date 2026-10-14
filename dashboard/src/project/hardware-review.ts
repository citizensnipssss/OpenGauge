import { validateDevice } from '../sensors/model.ts';
import type { DeviceSensors, Board, SensorBinding } from '../sensors/model.ts';
import { stable } from './portable.ts';

export type HardwareChange = { item: string; before: string; after: string; detail: string };
const boardLabel = (b: Board) => `${b.type.toUpperCase()} · ${b.connection.bus} · 0x${b.connection.address.toString(16).toUpperCase()}`;
const bindingLabel = (s: SensorBinding) => `${s.channel} · ${s.boardId} / ${s.profile.kind === 'thermocouple-k' ? 'TC' : `A${s.input}`} · ${s.enabled ? 'active' : 'off'}`;
const calibration = (s: SensorBinding) => `${s.profile.name}; divider ${s.dividerRatio}; offset ${s.offset}; ${s.profile.inputMin}–${s.profile.inputMax} V → ${s.profile.outputMin}–${s.profile.outputMax} ${s.profile.unit}`;
export function hardwareChanges(current: unknown, proposed: Omit<DeviceSensors, 'revision'>): HardwareChange[] {
  const before = validateDevice(current), after = validateDevice({ ...proposed, revision: before.revision });
  const changes: HardwareChange[] = [];
  for (const id of new Set([...before.boards, ...after.boards].map(b => b.id))) {
    const a = before.boards.find(b => b.id === id), b = after.boards.find(b => b.id === id);
    if (stable(a ?? null) !== stable(b ?? null)) changes.push({ item: `Board ${id}`, before: a ? boardLabel(a) : 'Not configured', after: b ? boardLabel(b) : 'Removed', detail: '' });
  }
  for (const id of new Set([...before.sensors, ...after.sensors].map(s => s.id))) {
    const a = before.sensors.find(s => s.id === id), b = after.sensors.find(s => s.id === id);
    if (stable(a ?? null) !== stable(b ?? null)) changes.push({ item: `Sensor ${id}`, before: a ? `${bindingLabel(a)}. ${calibration(a)}` : 'Not configured', after: b ? `${bindingLabel(b)}. ${calibration(b)}` : 'Removed', detail: a && b && stable(a.profile) !== stable(b.profile) ? 'Sensor profile changes. Check the complete values below.' : '' });
  }
  return changes;
}
