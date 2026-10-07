import '../pc-gauge/pc-gauge';
import type { PcGauge } from '../pc-gauge/pc-gauge';
import type { GaugeDefinition, LayoutSlotGeometry, ThemeConfig, DashboardSlotConfig } from '../../registry/types';
import type { TelemetryStore } from '../../telemetry/TelemetryStore';

/** Merge slot overrides onto a GaugeDefinition without mutating the registry copy. */
function applyOverrides(def: GaugeDefinition, overrides: DashboardSlotConfig['overrides']): GaugeDefinition {
  if (!overrides || Object.keys(overrides).length === 0) return def;
  return {
    ...def,
    scale: {
      min: overrides.min ?? def.scale.min,
      max: overrides.max ?? def.scale.max,
    },
    warning: {
      ...def.warning,
      ...(overrides.warningHigh !== undefined ? { high: overrides.warningHigh } : {}),
      ...(overrides.warningLow  !== undefined ? { low:  overrides.warningLow  } : {}),
    },
  };
}

/**
 * <dashboard-slot> — one grid cell: either an empty "+" tile or a
 * configured <pc-gauge>. Sizing/positioning is owned by the parent grid
 * (dashboard-view + layoutEngine) via grid-column/grid-row; this element
 * just fills whatever box it's given.
 * - Short tap: opens channel picker
 * - Long press (500ms): opens gauge settings (if a gauge is assigned)
 */
export class DashboardSlot extends HTMLElement {
  private slotId = '';
  private store: TelemetryStore | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.style.display = 'block';

    // Long-press detection — pointer events work for both touch and mouse
    this.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.pressTimer = setTimeout(() => {
        this.pressTimer = null;
        this.dispatchEvent(new CustomEvent('slot-long-pressed', {
          detail: { slotId: this.slotId }, bubbles: true, composed: true,
        }));
      }, 500);
    });

    const cancelPress = () => {
      if (this.pressTimer !== null) {
        clearTimeout(this.pressTimer);
        this.pressTimer = null;
      }
    };

    this.addEventListener('pointerup', cancelPress);
    this.addEventListener('pointercancel', cancelPress);
    this.addEventListener('pointermove', cancelPress);

    this.addEventListener('click', () => {
      // Only fire tap if long-press did not already fire
      if (this.pressTimer !== null || document.getSelection()?.toString()) return;
      this.dispatchEvent(new CustomEvent('slot-activated', {
        detail: { slotId: this.slotId }, bubbles: true, composed: true,
      }));
    });
  }

  // Cheap: called on every layout refit (resize/rotation). Does not touch
  // gauge content, so resizing never re-renders the <pc-gauge> SVG.
  setGeometry(geometry: LayoutSlotGeometry) {
    this.slotId = geometry.slotId;
    this.style.gridColumn = `${geometry.x + 1} / span ${geometry.w}`;
    this.style.gridRow    = `${geometry.y + 1} / span ${geometry.h}`;
  }

  // Expensive: only called when this slot's channel assignment, overrides,
  // or the active theme changes.
  setContent(
    gaugeDef: GaugeDefinition | null,
    theme: ThemeConfig | null,
    store: TelemetryStore | null = null,
    overrides: DashboardSlotConfig['overrides'] = {},
  ) {
    this.store = store;
    this.render(gaugeDef ? applyOverrides(gaugeDef, overrides) : null, theme);
  }

  private render(gaugeDef: GaugeDefinition | null, theme: ThemeConfig | null) {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host { display:block; width:100%; height:100%; aspect-ratio:1/1; cursor:pointer; user-select:none; }
        .empty {
          width:100%; height:100%; border-radius:16px; border:2px dashed #3a4048;
          background:#14181d; color:#5c6672; display:flex; align-items:center; justify-content:center;
          font-size:clamp(28px, 8cqw, 48px); font-family:Arial, sans-serif; transition:border-color .15s, color .15s;
        }
        .empty:hover, .empty:active { border-color:#ff9700; color:#ff9700; }
        pc-gauge { display:block; width:100%; height:100%; }
      </style>
    `;
    if (gaugeDef && theme) {
      const gauge = document.createElement('pc-gauge') as PcGauge;
      root.appendChild(gauge);
      gauge.configure(gaugeDef, theme);
      if (this.store) gauge.connectStore(this.store);
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '+';
      root.appendChild(empty);
    }
  }
}

customElements.define('dashboard-slot', DashboardSlot);
