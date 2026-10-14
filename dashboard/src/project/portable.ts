import { normalizeDesign, INDICATOR_DEFAULTS } from '../design/defaults.ts';
import type { GaugeDesign } from '../design/types.ts';
import type { DashboardConfig, LayoutDefinition } from '../registry/types.ts';
import { validateLayout } from '../community/layouts.ts';
import { validateDevice, CHANNEL_UNITS } from '../sensors/model.ts';
import type { DeviceSensors } from '../sensors/model.ts';

export const PROJECT_FORMAT = 'opengauge-project';
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
export type SensorIntent = 'active' | 'planned' | 'disabled';
export type HardwareSection = {
  target: 'arduino-nano-esp32';
  configuration: Omit<DeviceSensors, 'revision'>;
  intent: Record<string, SensorIntent>;
};
export type DashboardSection = { config: DashboardConfig; layout: LayoutDefinition; designs: GaugeDesign[] };
export type Project = {
  format: typeof PROJECT_FORMAT; schemaVersion: 1;
  name: string; notes: string;
  hardware?: HardwareSection; dashboard?: DashboardSection;
};
export type ExportChoice = 'complete' | 'dashboard' | 'hardware';
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected a setup object.');
  return v as Record<string, unknown>;
};
const text = (v: unknown, max: number, empty = false): string => {
  if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) throw new Error('Setup text is missing or too long.');
  return v.trim();
};
const finite = (v: unknown, min = -10000, max = 100000): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error('Setup contains an invalid numeric value.');
  return v;
};
const color = (v: unknown): string => {
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error('Colors must be six-digit hex values.');
  return v;
};
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Portable imports must never normalize a missing/unsupported design into a fallback. */
export function validatePortableDesign(raw: unknown): GaugeDesign {
  const r = object(raw);
  if (r.schema !== 'opengauge-design/1') throw new Error('Unsupported gauge design version.');
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(text(r.id, 96))) throw new Error('Invalid gauge design ID.');
  text(r.name, 100);
  const indicator = object(r.indicator);
  if (!Object.hasOwn(INDICATOR_DEFAULTS, String(indicator.type))) throw new Error('Unsupported gauge indicator.');
  const d = normalizeDesign(r);
  if (!d) throw new Error('Invalid gauge design.');
  const check = (actual: unknown, expected: unknown, path: string) => {
    if (expected && typeof expected === 'object') {
      const a = object(actual);
      for (const [key, value] of Object.entries(expected)) {
        if (key === 'builtIn') continue;
        check(a[key], value, `${path}.${key}`);
      }
    } else if (typeof expected === 'number') finite(actual, -2000, 2000);
    else if (typeof actual !== typeof expected) throw new Error(`Missing or invalid gauge part: ${path}.`);
  };
  check(r, d, 'design');
  for (const value of Object.values(d.colors)) color(value);
  color(d.frame.color); color(d.frame.faceColor);
  if (d.indicator.type === 'needle') color(d.indicator.color);
  const allowed = (value: string, list: string[]) => { if (!list.includes(value)) throw new Error('Unsupported gauge part style.'); };
  allowed(d.frame.style, ['chrome', 'black', 'brushed', 'color', 'flat', 'none']);
  allowed(d.frame.shape, ['round', 'square']); allowed(d.frame.face, ['carbon', 'matte', 'gradient', 'none']);
  allowed(d.scale.side, ['start', 'end']); allowed(d.readout.style, ['segment', 'text']);
  if (d.indicator.type === 'bar') {
    allowed(d.indicator.orientation, ['vertical', 'horizontal']);
    finite(d.indicator.width, 1, 1000); finite(d.indicator.height, 1, 1000);
  }
  if (d.indicator.type === 'arc-segments' || d.indicator.type === 'bar') {
    finite(d.indicator.segments, d.indicator.type === 'bar' ? 0 : 1, 100);
    if (!Number.isInteger(d.indicator.segments)) throw new Error('Gauge segment count must be a whole number.');
    finite(d.indicator.fill, 0.01, 1);
  }
  if (d.indicator.type !== 'none') finite(d.indicator.radius, 0, 1000);
  finite(d.readout.size, 0.01, 10);
  return d;
}

export function validateDashboard(raw: unknown): DashboardSection {
  const s = object(raw), layoutRaw = object(s.layout);
  const layout = validateLayout({ schema: 'opengauge-layout/1', layout: layoutRaw });
  layout.layoutId = text(layoutRaw.layoutId, 64);
  layout.drivingRecommended = layoutRaw.drivingRecommended === true;
  const c = object(s.config);
  if (c.schemaVersion !== 1 || c.layoutId !== layout.layoutId) throw new Error('Dashboard layout version or reference does not match.');
  if (!Array.isArray(s.designs) || s.designs.length < 1 || s.designs.length > 100) throw new Error('Include the gauge designs used by this dashboard.');
  const designs = s.designs.map(validatePortableDesign);
  if (new Set(designs.map(d => d.id)).size !== designs.length) throw new Error('Duplicate design IDs.');
  const resolve = (id: unknown): string => {
    const name = text(id, 96);
    if (!designs.some(d => d.id === name)) throw new Error(`Missing gauge design: ${name}.`);
    return name;
  };
  const themeId = resolve(c.themeId);
  if (!Array.isArray(c.slots) || c.slots.length !== layout.slotCount) throw new Error('Dashboard slot count does not match its layout.');
  const ids = new Set<string>();
  const slots = c.slots.map(rawSlot => {
    const slot = object(rawSlot), slotId = text(slot.slotId, 40);
    if (ids.has(slotId) || !layout.portrait.slots.some(g => g.slotId === slotId)) throw new Error('Dashboard references a missing or duplicate slot.');
    ids.add(slotId);
    if (slot.channelId !== null && (typeof slot.channelId !== 'string' || !Object.hasOwn(CHANNEL_UNITS, slot.channelId))) throw new Error(`Unsupported reading: ${String(slot.channelId)}. Choose a supported reading explicitly.`);
    const source = object(slot.overrides);
    const overrides: DashboardConfig['slots'][number]['overrides'] = {};
    for (const key of ['min', 'max', 'warningHigh', 'warningLow'] as const) if (source[key] !== undefined) overrides[key] = finite(source[key]);
    if (overrides.min !== undefined && overrides.max !== undefined && overrides.min >= overrides.max) throw new Error('Gauge scale minimum must be below its maximum.');
    if (source.designId !== undefined) overrides.designId = resolve(source.designId);
    return { slotId, channelId: slot.channelId as string | null, overrides };
  });
  const config: DashboardConfig = { schemaVersion: 1, layoutId: layout.layoutId, themeId, slots };
  if (c.themeOverrides !== undefined) {
    const t = object(c.themeOverrides);
    config.themeOverrides = {};
    for (const k of ['activeColor', 'warningColor', 'digitColor'] as const) if (t[k] !== undefined) config.themeOverrides[k] = color(t[k]);
    if (t.glow !== undefined) config.themeOverrides.glow = finite(t.glow, 0, 1);
  }
  return { config, layout, designs };
}

export function validateHardware(raw: unknown): HardwareSection {
  const h = object(raw);
  if (h.target !== 'arduino-nano-esp32') throw new Error('This release supports the Arduino Nano ESP32 firmware target. Other targets need a capability definition.');
  const config = object(h.configuration), statuses = object(h.intent);
  if (Object.hasOwn(config, 'revision')) throw new Error('Portable hardware settings must not contain a device revision.');
  if (!Array.isArray(config.sensors)) throw new Error('Missing sensor bindings.');
  const intent: Record<string, SensorIntent> = {};
  const sensors = config.sensors.map(rawSensor => {
    const sensor = object(rawSensor), id = text(sensor.id, 48), status = statuses[id];
    if (!['active', 'planned', 'disabled'].includes(String(status))) throw new Error(`Choose an intent for sensor ${id}.`);
    intent[id] = status as SensorIntent;
    if (sensor.enabled !== (status === 'active')) throw new Error(`Sensor ${id} has inconsistent active/planned settings.`);
    return sensor;
  });
  if (Object.keys(statuses).some(id => !Object.hasOwn(intent, id))) throw new Error('Intent references a missing sensor.');
  const { revision: _revision, ...configuration } = validateDevice({ ...config, sensors, revision: 0 });
  return { target: h.target, configuration, intent };
}

export function validateProject(raw: unknown): Project {
  const p = object(raw);
  if (p.format !== PROJECT_FORMAT || p.schemaVersion !== 1) throw new Error('Unsupported setup file version. Use an OpenGauge project version 1 file.');
  if (!p.hardware && !p.dashboard) throw new Error('The setup file has no hardware or dashboard section.');
  return { format: PROJECT_FORMAT, schemaVersion: 1, name: text(p.name, 100), notes: text(p.notes ?? '', 4000, true),
    ...(p.hardware ? { hardware: validateHardware(p.hardware) } : {}), ...(p.dashboard ? { dashboard: validateDashboard(p.dashboard) } : {}) };
}
export function parseProject(textValue: string): Project {
  if (new TextEncoder().encode(textValue).length > MAX_PROJECT_BYTES) throw new Error('Setup files are limited to 2 MB in this release.');
  let raw: unknown;
  try { raw = JSON.parse(textValue); } catch { throw new Error('The setup file is not valid JSON.'); }
  return validateProject(raw);
}
export function exportProject(project: Project, choice: ExportChoice): Project {
  if (!['complete', 'dashboard', 'hardware'].includes(choice)) throw new Error('Choose an export type.');
  if (choice !== 'hardware' && !project.dashboard) throw new Error('Add a dashboard before exporting this selection.');
  if (choice !== 'dashboard' && !project.hardware) throw new Error('Add hardware before exporting this selection.');
  return validateProject({ ...project, hardware: choice === 'dashboard' ? undefined : project.hardware, dashboard: choice === 'hardware' ? undefined : project.dashboard });
}
export function hardwareBytes(hardware: HardwareSection): number {
  // Worst-case revision width at application time, plus NVS string terminator.
  return new TextEncoder().encode(JSON.stringify({ ...hardware.configuration, revision: 2147483646 })).length + 1;
}

/** Preserve installed designs/layouts and remap all colliding imported references. */
export function mergeDashboard(incoming: DashboardSection, existingDesigns: GaugeDesign[], existingLayouts: LayoutDefinition[]): { section: DashboardSection; addedDesigns: GaugeDesign[]; addedLayouts: LayoutDefinition[]; remapped: string[] } {
  const section = validateDashboard(incoming), designs = clone(existingDesigns), addedDesigns: GaugeDesign[] = [], addedLayouts: LayoutDefinition[] = [], remapped: string[] = [];
  const content = (d: GaugeDesign) => { const { id: _id, builtIn: _builtIn, ...rest } = d; return stable(rest); };
  const mapping = new Map<string, string>();
  for (const d of section.designs) {
    const existing = designs.find(v => v.id === d.id);
    if (existing && content(existing) === content(d)) { mapping.set(d.id, existing.id); continue; }
    let id = d.id;
    if (existing) {
      const duplicate = designs.find(v => v.id.startsWith(`${d.id}_import`) && content(v) === content(d));
      if (duplicate) { mapping.set(d.id, duplicate.id); continue; }
      for (let n = 1; designs.some(v => v.id === id); n++) id = `${d.id.slice(0, 75)}_import${n}`;
      remapped.push(`${d.id} → ${id}`);
    }
    const imported = { ...d, id, builtIn: false };
    mapping.set(d.id, id); designs.push(imported); addedDesigns.push(imported);
  }
  section.config.themeId = mapping.get(section.config.themeId)!;
  for (const slot of section.config.slots) if (slot.overrides.designId) slot.overrides.designId = mapping.get(slot.overrides.designId)!;
  section.designs = section.designs.map(d => designs.find(v => v.id === mapping.get(d.id))!);
  const layoutContent = (l: LayoutDefinition) => { const { layoutId: _id, ...rest } = l; return stable(rest); };
  const existing = existingLayouts.find(l => l.layoutId === section.layout.layoutId);
  if (!existing) addedLayouts.push(section.layout);
  else if (layoutContent(existing) !== layoutContent(section.layout)) {
    const base = `community-${section.layout.layoutId.replace(/^community-/, '').slice(0, 38)}-import`;
    const duplicate = existingLayouts.find(l => l.layoutId.startsWith(base) && layoutContent(l) === layoutContent(section.layout));
    let id = duplicate?.layoutId ?? base;
    if (!duplicate) {
      for (let n = 1; existingLayouts.some(l => l.layoutId === id); n++) id = `${base}-${n}`;
      remapped.push(`${section.layout.layoutId} → ${id}`);
      section.layout.layoutId = id; addedLayouts.push(section.layout);
    }
    section.layout.layoutId = id; section.config.layoutId = id;
  }
  return { section, addedDesigns, addedLayouts, remapped };
}
