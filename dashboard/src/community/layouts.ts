import type { LayoutDefinition, LayoutOrientationGeometry, SizeClass } from '../registry/types';
import {readBrowserRecord, updateBrowserRecord} from '../project/browser-record.ts';
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected a layout object.');
  return v as Record<string, unknown>;
};
const integer = (v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error('Layout grid numbers are invalid.');
  return v;
};
const text = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('Layout text is missing or too long.');
  return v.trim();
};

/** Copy only geometry and text, never executable content or CSS. */
export function validateLayout(raw: unknown): LayoutDefinition {
  const file = record(raw);
  if (file.schema !== 'opengauge-layout/1') throw new Error('Use an OpenGauge layout JSON file (opengauge-layout/1).');
  const value = record(file.layout);
  const id = text(value.layoutId, 64);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Layout ID must use lowercase letters, numbers and hyphens.');
  const layoutId = id.startsWith('community-') ? id : `community-${id}`;
  if (layoutId.length>64) throw new Error('Layout ID is too long. Use 54 characters or fewer before the community prefix.');
  const count = integer(value.slotCount, 1, 11);
  const geometry = (rawGeometry: unknown): LayoutOrientationGeometry => {
    const g = record(rawGeometry);
    const columns = integer(g.columns, 1, 16), rows = integer(g.rows, 1, 16);
    if (!Array.isArray(g.slots) || g.slots.length !== count) throw new Error('Slot count does not match the geometry.');
    const occupied = new Set<string>(), ids = new Set<string>();
    const slots = g.slots.map((item) => {
      const s = record(item), slotId = text(s.slotId, 40);
      if (!/^slot-[a-z0-9-]+$/.test(slotId) || ids.has(slotId)) throw new Error('Slot IDs must be unique.');
      ids.add(slotId);
      const x = integer(s.x, 0, columns-1), y = integer(s.y, 0, rows-1);
      const w = integer(s.w, 1, columns-x), h = integer(s.h, 1, rows-y);
      if (w !== h) throw new Error('Gauge slots must be square.');
      for (let cx=x; cx<x+w; cx++) for (let cy=y; cy<y+h; cy++) {
        const cell = `${cx},${cy}`;
        if (occupied.has(cell)) throw new Error('Gauge slots overlap.');
        occupied.add(cell);
      }
      const allowed = ['hero','large','normal','mini','compact','diagnostic'];
      const sizeClass: SizeClass = allowed.includes(String(s.sizeClass)) ? s.sizeClass as SizeClass : 'normal';
      return {slotId,x,y,w,h,sizeClass};
    });
    return {columns,rows,slots};
  };
  const portrait = geometry(value.portrait), landscape = geometry(value.landscape);
  if (portrait.slots.map(s=>s.slotId).sort().join('|') !== landscape.slots.map(s=>s.slotId).sort().join('|')) throw new Error('Both orientations must use the same slot IDs.');
  return {
    layoutId,
    name:text(value.name,80), rationale:text(value.rationale,400), slotCount:count,
    drivingRecommended:false, portrait,landscape,
  };
}

export function storedLayouts(): LayoutDefinition[] {
  try {
    const list = readBrowserRecord().layouts;
    if (!Array.isArray(list)) return [];
    return list.slice(0,50).flatMap((layout) => {
      try { return [validateLayout({schema:'opengauge-layout/1',layout})]; } catch { return []; }
    });
  } catch { return []; }
}
export function saveLayout(layout: LayoutDefinition) {
  const list = storedLayouts();
  if (list.some(l=>l.layoutId===layout.layoutId)) throw new Error('This layout ID is already saved. Change its ID to import a new variation.');
  if (list.length>=50) throw new Error('The saved layout limit is 50.');
  updateBrowserRecord({layouts:[...list,validateLayout({schema:'opengauge-layout/1',layout})]});
}
export function issueLayout(body: string): LayoutDefinition | null {
  const block = body.match(/```json\s*([\s\S]*?)```/i);
  if (!block || block[1].length>50000) return null;
  try { return validateLayout(JSON.parse(block[1])); } catch { return null; }
}
