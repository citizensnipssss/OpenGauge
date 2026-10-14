import type { DashboardConfig, LayoutDefinition } from '../registry/types.ts';
import type { GaugeDesign } from '../design/types.ts';
export const BROWSER_RECORD_KEY = 'opengauge/portable-dashboard/v1';
export interface BrowserRecord { version: 1; config: DashboardConfig | null; designs: GaugeDesign[]; layouts: LayoutDefinition[] }
function checked(raw: unknown): BrowserRecord {
  const r = raw as BrowserRecord;
  if (!r || r.version !== 1 || !Array.isArray(r.designs) || !Array.isArray(r.layouts) || !(r.config === null || r.config && typeof r.config === 'object')) throw new Error('Unsupported or damaged saved dashboard record. Existing data was retained.');
  return r;
}
export function writeBrowserRecord(record: BrowserRecord): void {
  checked(record);
  const text = JSON.stringify(record);
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('Dashboard storage exceeds the 2 MB supported limit.');
  localStorage.setItem(BROWSER_RECORD_KEY, text);
  if (localStorage.getItem(BROWSER_RECORD_KEY) !== text) throw new Error('Dashboard storage could not be verified.');
}
/** Migrate all three old keys in one write; keep them available for recovery. */
export function readBrowserRecord(): BrowserRecord {
  const text = localStorage.getItem(BROWSER_RECORD_KEY);
  if (text) return checked(JSON.parse(text));
  const parse = (key: string, fallback: unknown) => {
    try { return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)); } catch { throw new Error(`Could not migrate ${key}. Existing data was retained.`); }
  };
  const record = checked({ version: 1, config: parse('cummins-gauge-dashboard/config', null), designs: parse('opengauge/designs', []), layouts: parse('opengauge/community-layouts', []) });
  if (record.config || record.designs.length || record.layouts.length) writeBrowserRecord(record);
  return record;
}
export function updateBrowserRecord(update: Partial<Omit<BrowserRecord, 'version'>>): void {
  writeBrowserRecord({ ...readBrowserRecord(), ...update, version: 1 });
}
