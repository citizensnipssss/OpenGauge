import type { GaugeDefinition, WarningMode } from '../../registry/types';
import type { DashboardSlotConfig } from '../../registry/types';

/**
 * <gauge-settings> — per-slot override panel.
 * Opened by dashboard-slot on long-press. Emits 'overrides-saved' with
 * { slotId, overrides } when the user saves.
 */
export class GaugeSettings extends HTMLElement {
  private slotId = '';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.hidden = true;
  }

  open(slotId: string, def: GaugeDefinition, overrides: DashboardSlotConfig['overrides']) {
    this.slotId = slotId;
    this.hidden = false;
    this.build(def, overrides);
  }

  private build(def: GaugeDefinition, overrides: DashboardSlotConfig['overrides']) {
    const mode: WarningMode = def.warning.mode;
    const hasHigh = mode === 'high_segments' || mode === 'outside_band_all_lit';
    const hasLow  = mode === 'low_all_lit'   || mode === 'outside_band_all_lit';

    const cur = {
      min:         overrides.min         ?? def.scale.min,
      max:         overrides.max         ?? def.scale.max,
      warningHigh: overrides.warningHigh ?? def.warning.high,
      warningLow:  overrides.warningLow  ?? def.warning.low,
    };

    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host {
          position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
          padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
                   max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
          z-index:1100;
        }
        .backdrop { position:absolute; inset:0; background:rgba(0,0,0,.65); }
        .panel {
          position:relative; background:#14181d; border:1px solid #2a3038; border-radius:16px;
          padding:20px; width:min(420px,100%); max-height:100%; overflow-y:auto;
          font-family:Arial,sans-serif; color:#eee; display:flex; flex-direction:column; gap:16px;
        }
        .header { display:flex; justify-content:space-between; align-items:center; }
        .title { font-size:18px; font-weight:700; }
        .subtitle { font-size:13px; color:#9ab; margin-top:2px; }
        .close { background:none; border:none; color:#9ab; font-size:22px; cursor:pointer; min-width:48px; min-height:48px; }
        .section-label { font-size:12px; font-weight:700; color:#ff9700; letter-spacing:1px; text-transform:uppercase; }
        .row { display:flex; gap:12px; }
        .field { display:flex; flex-direction:column; gap:6px; flex:1; }
        label { font-size:13px; color:#9ab; }
        input[type=number] {
          background:#0e1216; color:#eee; border:1px solid #2a3038; border-radius:8px;
          padding:10px 12px; font-size:16px; font-family:Arial,sans-serif; width:100%;
          -moz-appearance:textfield;
        }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; }
        input[type=number]:focus { outline:none; border-color:#ff9700; }
        .actions { display:flex; gap:10px; }
        .btn {
          flex:1; padding:13px; border-radius:10px; border:1px solid #2a3038;
          background:#181c22; color:#eee; font-family:Arial,sans-serif; font-size:15px;
          cursor:pointer; min-height:48px;
        }
        .btn:hover { border-color:#ff9700; }
        .btn.primary { background:#ff9700; color:#000; border-color:#ff9700; font-weight:700; }
        .btn.primary:hover { background:#ffad33; }
        .btn.danger { background:#2e0d0d; color:#e88; border-color:#5a1e1e; }
        .btn.danger:hover { border-color:#ca3d3d; }
      </style>
      <div class="backdrop" id="backdrop"></div>
      <div class="panel">
        <div class="header">
          <div>
            <div class="title">${def.label}</div>
            <div class="subtitle">Override defaults · ${def.unit}</div>
          </div>
          <button class="close" id="closeBtn" type="button" aria-label="Close">&times;</button>
        </div>

        <div class="section-label">Scale Range</div>
        <div class="row">
          <div class="field">
            <label for="inp-min">Minimum (${def.unit})</label>
            <input id="inp-min" type="number" value="${cur.min}" step="any" />
          </div>
          <div class="field">
            <label for="inp-max">Maximum (${def.unit})</label>
            <input id="inp-max" type="number" value="${cur.max}" step="any" />
          </div>
        </div>

        ${hasHigh ? `
        <div class="section-label">Warning Threshold</div>
        <div class="row">
          <div class="field">
            <label for="inp-warn-high">${hasLow ? 'High warning' : 'Warning at or above'} (${def.unit})</label>
            <input id="inp-warn-high" type="number" value="${cur.warningHigh ?? ''}" step="any" placeholder="none" />
          </div>
        </div>` : ''}

        ${hasLow ? `
        <div class="section-label">${hasHigh ? '' : 'Warning Threshold'}</div>
        <div class="row">
          <div class="field">
            <label for="inp-warn-low">${hasHigh ? 'Low warning' : 'Warning at or below'} (${def.unit})</label>
            <input id="inp-warn-low" type="number" value="${cur.warningLow ?? ''}" step="any" placeholder="none" />
          </div>
        </div>` : ''}

        <div class="actions">
          <button class="btn danger" id="resetBtn" type="button">Reset to Defaults</button>
          <button class="btn primary" id="saveBtn" type="button">Save</button>
        </div>
      </div>
    `;

    root.querySelector('#backdrop')!.addEventListener('click', () => this.close());
    root.querySelector('#closeBtn')!.addEventListener('click', () => this.close());
    root.querySelector('#saveBtn')!.addEventListener('click', () => this.save(root, hasHigh, hasLow));
    root.querySelector('#resetBtn')!.addEventListener('click', () => this.saveOverrides({}));
  }

  private save(root: ShadowRoot, hasHigh: boolean, hasLow: boolean) {
    const val = (id: string) => {
      const el = root.querySelector<HTMLInputElement>(id);
      const v = parseFloat(el?.value ?? '');
      return isNaN(v) ? undefined : v;
    };
    const overrides: DashboardSlotConfig['overrides'] = {
      min: val('#inp-min'),
      max: val('#inp-max'),
      ...(hasHigh ? { warningHigh: val('#inp-warn-high') } : {}),
      ...(hasLow  ? { warningLow:  val('#inp-warn-low')  } : {}),
    };
    // Strip undefined keys
    (Object.keys(overrides) as (keyof typeof overrides)[]).forEach((k) => {
      if (overrides[k] === undefined) delete overrides[k];
    });
    this.saveOverrides(overrides);
  }

  private saveOverrides(overrides: DashboardSlotConfig['overrides']) {
    this.dispatchEvent(new CustomEvent('overrides-saved', {
      detail: { slotId: this.slotId, overrides },
      bubbles: true,
      composed: true,
    }));
    this.close();
  }

  close() {
    this.hidden = true;
    this.shadowRoot!.innerHTML = '';
  }
}

customElements.define('gauge-settings', GaugeSettings);
