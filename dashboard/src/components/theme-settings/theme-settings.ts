import type { ThemeConfig, ThemeOverrides } from '../../registry/types';

/**
 * <theme-settings> — whole-dashboard color override panel.
 * Opened from the top bar. Emits 'theme-overrides-saved' with { overrides }.
 */
export class ThemeSettings extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.hidden = true;
  }

  open(theme: ThemeConfig, overrides: ThemeOverrides | undefined) {
    this.hidden = false;
    this.build(theme, overrides ?? {});
  }

  private build(theme: ThemeConfig, overrides: ThemeOverrides) {
    const cur = {
      activeColor:  overrides.activeColor  ?? theme.colors.active,
      warningColor: overrides.warningColor ?? theme.colors.warning,
      digitColor:   overrides.digitColor   ?? theme.colors.digits,
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
          padding:20px; width:min(380px,100%); max-height:100%; overflow-y:auto;
          font-family:Arial,sans-serif; color:#eee; display:flex; flex-direction:column; gap:16px;
        }
        .header { display:flex; justify-content:space-between; align-items:center; }
        .title { font-size:18px; font-weight:700; }
        .subtitle { font-size:13px; color:#9ab; margin-top:2px; }
        .close { background:none; border:none; color:#9ab; font-size:22px; cursor:pointer; min-width:48px; min-height:48px; }
        .section-label { font-size:12px; font-weight:700; color:#ff9700; letter-spacing:1px; text-transform:uppercase; }
        .field { display:flex; flex-direction:column; gap:6px; }
        label { font-size:13px; color:#9ab; }
        .color-row { display:flex; align-items:center; gap:10px; }
        input[type=color] {
          width:48px; height:48px; border:1px solid #2a3038; border-radius:8px;
          background:#0e1216; cursor:pointer; padding:2px;
        }
        input[type=text] {
          flex:1; background:#0e1216; color:#eee; border:1px solid #2a3038; border-radius:8px;
          padding:10px 12px; font-size:15px; font-family:monospace; width:100%;
        }
        input[type=text]:focus { outline:none; border-color:#ff9700; }
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
            <div class="title">Theme Colors</div>
            <div class="subtitle">${theme.name} · overrides only</div>
          </div>
          <button class="close" id="closeBtn" type="button" aria-label="Close">&times;</button>
        </div>

        <div class="section-label">Segment Colors</div>

        <div class="field">
          <label>Active (lit segments, normal)</label>
          <div class="color-row">
            <input type="color" id="clr-active" value="${cur.activeColor}" />
            <input type="text"  id="txt-active" value="${cur.activeColor}" maxlength="7" />
          </div>
        </div>

        <div class="field">
          <label>Warning (lit segments, alert)</label>
          <div class="color-row">
            <input type="color" id="clr-warning" value="${cur.warningColor}" />
            <input type="text"  id="txt-warning" value="${cur.warningColor}" maxlength="7" />
          </div>
        </div>

        <div class="field">
          <label>Digits</label>
          <div class="color-row">
            <input type="color" id="clr-digit" value="${cur.digitColor}" />
            <input type="text"  id="txt-digit" value="${cur.digitColor}" maxlength="7" />
          </div>
        </div>

        <div class="actions">
          <button class="btn danger" id="resetBtn" type="button">Reset to Defaults</button>
          <button class="btn primary" id="saveBtn" type="button">Save</button>
        </div>
      </div>
    `;

    // Sync color picker ↔ text input for each pair
    for (const key of ['active', 'warning', 'digit'] as const) {
      const clr = root.querySelector<HTMLInputElement>(`#clr-${key}`)!;
      const txt = root.querySelector<HTMLInputElement>(`#txt-${key}`)!;
      clr.addEventListener('input', () => { txt.value = clr.value; });
      txt.addEventListener('input', () => {
        if (/^#[0-9a-fA-F]{6}$/.test(txt.value)) clr.value = txt.value;
      });
    }

    root.querySelector('#backdrop')!.addEventListener('click', () => this.close());
    root.querySelector('#closeBtn')!.addEventListener('click', () => this.close());
    root.querySelector('#saveBtn')!.addEventListener('click', () => {
      const get = (id: string) => root.querySelector<HTMLInputElement>(id)!.value;
      this.emit({
        activeColor:  get('#txt-active'),
        warningColor: get('#txt-warning'),
        digitColor:   get('#txt-digit'),
      });
    });
    root.querySelector('#resetBtn')!.addEventListener('click', () => this.emit({}));
  }

  private emit(overrides: ThemeOverrides) {
    this.dispatchEvent(new CustomEvent('theme-overrides-saved', {
      detail: { overrides },
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

customElements.define('theme-settings', ThemeSettings);
