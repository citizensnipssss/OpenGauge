import '../pc-gauge/pc-gauge';
import type { PcGauge } from '../pc-gauge/pc-gauge';
import type { GaugeDefinition } from '../../registry/types';
import type { GaugeDesign } from '../../design/types';

/** Sample gauge used for previews — boost with a value in the warning zone. */
const PREVIEW_DEF: GaugeDefinition = {
  id: 'preview', label: 'BOOST', unit: 'PSI', precision: 0,
  scale: { min: -15, max: 40 }, warning: { mode: 'high_segments', high: 30 },
  telemetryKey: 'preview', demoValue: 33,
};

/**
 * <theme-picker> — step 2 of Layout → Theme → PIDs. Shows every gauge design
 * (built-in + Theme Maker) as a live mini gauge. Emits 'theme-selected'
 * { themeId } and 'open-maker' { designId? } for the Theme Maker.
 */
export class ThemePicker extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  configure(designs: GaugeDesign[], currentId?: string) {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host { display:block; }
        .option-grid {
          display:grid;
          grid-template-columns: repeat(auto-fill, minmax(min(170px, 100%), 1fr));
          gap: clamp(10px, 2.5vw, 18px);
        }
        .card {
          background:#14181d; border:1px solid #2a3038; border-radius:14px;
          padding:12px; display:flex; flex-direction:column; gap:8px; cursor:pointer;
          color:#eee; font-family:Arial, sans-serif; text-align:left; position:relative;
        }
        .card:hover, .card:active { border-color:#ff9700; }
        .card.current { border-color:#ff9700; box-shadow:0 0 0 1px #ff9700 inset; }
        .preview { width:100%; aspect-ratio:1/1; pointer-events:none; }
        pc-gauge { display:block; width:100%; height:100%; }
        .name { font-size:16px; font-weight:700; }
        .meta { font-size:12px; color:#9ab; }
        .edit {
          position:absolute; top:8px; right:8px; background:rgba(24,28,34,.9); color:#eee;
          border:1px solid #2a3038; border-radius:8px; min-width:48px; min-height:44px; font-size:14px; cursor:pointer;
        }
        .edit:hover { border-color:#ff9700; }
        .new {
          border-style:dashed; align-items:center; justify-content:center; min-height:200px;
          color:#ff9700; font-size:16px; font-weight:700;
        }
        .new .plus { font-size:44px; line-height:1; }
        @media (max-width:600px) {
          .option-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
          .card { padding:10px; padding-top:52px; }
          .name { font-size:15px; overflow-wrap:anywhere; }
        }
      </style>
      <div class="option-grid"></div>
    `;
    const grid = root.querySelector('.option-grid')!;
    const emit = (name: string, detail: unknown) =>
      this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));

    for (const design of designs) {
      const card = document.createElement('div');
      card.className = `card${design.id === currentId ? ' current' : ''}`;
      card.setAttribute('role', 'button');
      card.tabIndex = 0;

      const preview = document.createElement('div');
      preview.className = 'preview';
      const gauge = document.createElement('pc-gauge') as PcGauge;
      preview.appendChild(gauge);
      card.appendChild(preview);
      gauge.configure(PREVIEW_DEF, design);

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = design.name;
      card.appendChild(name);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = design.builtIn ? 'Built-in' : 'My design';
      card.appendChild(meta);

      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.type = 'button';
      edit.textContent = design.builtIn ? 'Copy' : 'Edit';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        emit('open-maker', { designId: design.id });
      });
      card.appendChild(edit);

      const pick = () => emit('theme-selected', { themeId: design.id });
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
      grid.appendChild(card);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'card new';
    add.innerHTML = '<span class="plus">+</span><span>New design</span>';
    add.addEventListener('click', () => emit('open-maker', {}));
    grid.appendChild(add);
  }
}

customElements.define('theme-picker', ThemePicker);
