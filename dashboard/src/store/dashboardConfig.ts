import type { DashboardConfig, DashboardSlotConfig, GaugeDefinition, LayoutRegistry } from '../registry/types';

const STORAGE_KEY = 'cummins-gauge-dashboard/config';

export interface Registries {
  layouts: LayoutRegistry;
  gauges: GaugeDefinition[];
}

function slotIdsForLayout(layoutId: string, layouts: LayoutRegistry): string[] | null {
  const layout = layouts.layouts.find((l) => l.layoutId === layoutId);
  if (!layout) return null;
  // Portrait/landscape geometries for a given layout always share slot IDs.
  return layout.portrait.slots.map((s) => s.slotId);
}

// CONFIG_FORMAT.md "Import/export" validation rules — unknown fields are
// dropped rather than rejected; unknown layoutId/channelId invalidate the
// whole config or just that slot, respectively.
export function validateConfig(raw: unknown, registries: Registries): DashboardConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<DashboardConfig>;

  if (c.schemaVersion !== 1) return null;
  if (typeof c.layoutId !== 'string') return null;
  if (typeof c.themeId !== 'string') return null;
  if (!Array.isArray(c.slots)) return null;

  const knownSlotIds = slotIdsForLayout(c.layoutId, registries.layouts);
  if (!knownSlotIds) return null;

  const knownChannelIds = new Set(registries.gauges.map((g) => g.id));

  const slots: DashboardSlotConfig[] = knownSlotIds.map((slotId) => {
    const found = c.slots!.find((s) => s && (s as DashboardSlotConfig).slotId === slotId) as
      | DashboardSlotConfig
      | undefined;
    const channelId =
      found && typeof found.channelId === 'string' && knownChannelIds.has(found.channelId) ? found.channelId : null;
    const overrides = found && typeof found.overrides === 'object' && found.overrides ? found.overrides : {};
    return { slotId, channelId, overrides };
  });

  return {
    schemaVersion: 1,
    layoutId: c.layoutId,
    themeId: c.themeId,
    themeOverrides: c.themeOverrides,
    slots,
  };
}

/**
 * Central dashboard configuration store — localStorage-backed for now.
 * Kept behind this class (not scattered fetch/localStorage calls) so
 * Phase 3 device-side persistence can be added without reworking callers.
 */
export class DashboardConfigStore {
  private config: DashboardConfig | null = null;
  private registries: Registries;

  constructor(registries: Registries) {
    this.registries = registries;
  }

  get current(): DashboardConfig | null {
    return this.config;
  }

  load(): DashboardConfig | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      this.config = validateConfig(JSON.parse(raw), this.registries);
      return this.config;
    } catch {
      return null;
    }
  }

  save(config: DashboardConfig) {
    this.config = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  startNew(layoutId: string, themeId: string): DashboardConfig {
    const slotIds = slotIdsForLayout(layoutId, this.registries.layouts) ?? [];
    const config: DashboardConfig = {
      schemaVersion: 1,
      layoutId,
      themeId,
      slots: slotIds.map((slotId) => ({ slotId, channelId: null, overrides: {} })),
    };
    this.save(config);
    return config;
  }

  assignChannel(slotId: string, channelId: string | null): DashboardConfig {
    if (!this.config) throw new Error('No active dashboard config');
    const slots = this.config.slots.map((s) => (s.slotId === slotId ? { ...s, channelId } : s));
    const next = { ...this.config, slots };
    this.save(next);
    return next;
  }

  updateSlotOverrides(slotId: string, overrides: DashboardSlotConfig['overrides']): DashboardConfig {
    if (!this.config) throw new Error('No active dashboard config');
    const slots = this.config.slots.map((s) => (s.slotId === slotId ? { ...s, overrides } : s));
    const next = { ...this.config, slots };
    this.save(next);
    return next;
  }

  updateThemeOverrides(themeOverrides: DashboardConfig['themeOverrides']): DashboardConfig {
    if (!this.config) throw new Error('No active dashboard config');
    const next = { ...this.config, themeOverrides };
    this.save(next);
    return next;
  }

  exportJson(): string {
    if (!this.config) throw new Error('No active dashboard config');
    return JSON.stringify(this.config, null, 2);
  }

  importJson(text: string): DashboardConfig | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const validated = validateConfig(parsed, this.registries);
    if (validated) this.save(validated);
    return validated;
  }

  clear() {
    this.config = null;
    localStorage.removeItem(STORAGE_KEY);
  }
}
