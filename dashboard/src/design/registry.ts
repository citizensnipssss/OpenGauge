import { DEFAULT_DESIGN, normalizeDesign } from './defaults';
import type { GaugeDesign } from './types';
import {readBrowserRecord, updateBrowserRecord} from '../project/browser-record.ts';

// Every JSON in public/config/designs/ is a built-in design — drop a file
// there and it ships in the next build, no code changes.
const builtInFiles = import.meta.glob('../../public/config/designs/*.json', {
  eager: true,
  import: 'default',
});

const ORDER = ['performance_chrome', 'classic_needle', 'smooth_ring', 'bar_graph', 'digital'];

function loadBuiltIns(): GaugeDesign[] {
  const list = Object.values(builtInFiles)
    .map((raw) => normalizeDesign(raw))
    .filter((d): d is GaugeDesign => !!d)
    .map((d) => ({ ...d, builtIn: true }));
  const rank = (id: string) => (ORDER.indexOf(id) + 1 || 999);
  return list.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

/**
 * All gauge designs: built-ins from the app bundle + the user's own from the
 * Theme Maker (localStorage, per browser — like the dashboard config).
 */
export class DesignRegistry {
  private builtIns = loadBuiltIns();
  private user: GaugeDesign[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.user = this.readUser();
  }

  list(): GaugeDesign[] {
    return [...this.builtIns, ...this.user];
  }

  get(id: string | undefined | null): GaugeDesign | undefined {
    if (!id) return undefined;
    return this.user.find((d) => d.id === id) ?? this.builtIns.find((d) => d.id === id);
  }

  /** Never fails — unknown ids fall back to Performance Chrome. */
  resolve(id: string | undefined | null): GaugeDesign {
    return this.get(id) ?? this.builtIns.find((d) => d.id === DEFAULT_DESIGN.id) ?? DEFAULT_DESIGN;
  }

  isBuiltIn(id: string) {
    return this.builtIns.some((d) => d.id === id);
  }

  /** Save (create or replace) a user design. Built-in ids are never overwritten. */
  save(design: GaugeDesign): GaugeDesign {
    let d = { ...design, builtIn: false };
    if (this.isBuiltIn(d.id)) d = { ...d, id: this.uniqueId(d.name) };
    const next = [...this.user];
    const i = next.findIndex((u) => u.id === d.id);
    if (i >= 0) next[i] = d;
    else next.push(d);
    this.writeUser(next);
    return d;
  }

  remove(id: string) {
    this.writeUser(this.user.filter((d) => d.id !== id));
  }

  /** A slug id from a name that isn't taken yet. */
  uniqueId(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'design';
    let id = base;
    for (let n = 2; this.get(id); n++) id = `${base}_${n}`;
    return id;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private readUser(): GaugeDesign[] {
      const raw = readBrowserRecord().designs;
      return raw
        .map((r) => normalizeDesign(r))
        .filter((d): d is GaugeDesign => !!d && !this.isBuiltIn(d.id));
  }

  reload() { this.user = this.readUser(); this.listeners.forEach(fn=>fn()); }

  private writeUser(next: GaugeDesign[]) {
    updateBrowserRecord({designs: next});
    this.user = next;
    this.listeners.forEach((fn) => fn());
  }
}
