import { exportJson } from '../../platform/export';
import '../pc-gauge/pc-gauge';
import type { PcGauge } from '../pc-gauge/pc-gauge';
import type { GaugeDefinition } from '../../registry/types';
import type { GaugeDesign, IndicatorType } from '../../design/types';
import type { DesignRegistry } from '../../design/registry';
import { INDICATOR_DEFAULTS, normalizeDesign } from '../../design/defaults';

type Kind = 'color' | 'range' | 'select' | 'toggle';
interface Ctl {
  label: string;
  path: string;
  kind: Kind;
  min?: number;
  max?: number;
  step?: number;
  options?: [string, string][];
  show?: (d: GaugeDesign) => boolean;
}
interface Section { id: string; title: string; ctls: Ctl[]; show?: (d: GaugeDesign) => boolean }

const t = (d: GaugeDesign) => d.indicator.type;
const isArc = (d: GaugeDesign) => t(d) === 'arc-segments' || t(d) === 'arc-smooth' || t(d) === 'needle';

const INDICATOR_OPTIONS: [IndicatorType, string][] = [
  ['arc-segments', 'Segmented arc'],
  ['arc-smooth', 'Smooth arc'],
  ['needle', 'Needle'],
  ['bar', 'Bar graph'],
  ['none', 'Digital only'],
];

const SECTIONS: Section[] = [
  {
    id: 'shape', title: 'Shape', ctls: [
      { label: 'Gauge type', path: 'indicator.type', kind: 'select', options: INDICATOR_OPTIONS },
      { label: 'Start angle', path: 'indicator.startDeg', kind: 'range', min: -180, max: 0, step: 1, show: isArc },
      { label: 'End angle', path: 'indicator.endDeg', kind: 'range', min: 0, max: 180, step: 1, show: isArc },
      { label: 'Radius', path: 'indicator.radius', kind: 'range', min: 120, max: 450, step: 1, show: isArc },
      { label: 'Thickness', path: 'indicator.thickness', kind: 'range', min: 4, max: 140, step: 1,
        show: (d) => t(d) === 'arc-segments' || t(d) === 'arc-smooth' },
      { label: 'Segments', path: 'indicator.segments', kind: 'range', min: 4, max: 90, step: 1,
        show: (d) => t(d) === 'arc-segments' },
      { label: 'Segment size', path: 'indicator.fill', kind: 'range', min: 0.15, max: 1, step: 0.01,
        show: (d) => t(d) === 'arc-segments' || (t(d) === 'bar' && (d.indicator as { segments: number }).segments >= 2) },
      { label: 'Rounded ends', path: 'indicator.roundCaps', kind: 'toggle', show: (d) => t(d) === 'arc-smooth' },
      // Needle
      { label: 'Needle color', path: 'indicator.color', kind: 'color', show: (d) => t(d) === 'needle' },
      { label: 'Needle length', path: 'indicator.length', kind: 'range', min: 80, max: 450, step: 1, show: (d) => t(d) === 'needle' },
      { label: 'Needle width', path: 'indicator.width', kind: 'range', min: 4, max: 70, step: 1, show: (d) => t(d) === 'needle' },
      { label: 'Needle tail', path: 'indicator.tail', kind: 'range', min: 0, max: 160, step: 1, show: (d) => t(d) === 'needle' },
      { label: 'Hub size', path: 'indicator.hubRadius', kind: 'range', min: 0, max: 110, step: 1, show: (d) => t(d) === 'needle' },
      { label: 'Warning zone band', path: 'indicator.zoneBand', kind: 'toggle', show: (d) => t(d) === 'needle' },
      // Bar
      { label: 'Direction', path: 'indicator.orientation', kind: 'select',
        options: [['vertical', 'Vertical (fills up)'], ['horizontal', 'Horizontal (fills right)']], show: (d) => t(d) === 'bar' },
      { label: 'Left', path: 'indicator.x', kind: 'range', min: 0, max: 1000, step: 1, show: (d) => t(d) === 'bar' },
      { label: 'Top', path: 'indicator.y', kind: 'range', min: 0, max: 1000, step: 1, show: (d) => t(d) === 'bar' },
      { label: 'Width', path: 'indicator.width', kind: 'range', min: 10, max: 1000, step: 1, show: (d) => t(d) === 'bar' },
      { label: 'Height', path: 'indicator.height', kind: 'range', min: 10, max: 1000, step: 1, show: (d) => t(d) === 'bar' },
      { label: 'Blocks (0 = solid)', path: 'indicator.segments', kind: 'range', min: 0, max: 60, step: 1, show: (d) => t(d) === 'bar' },
      { label: 'Corner rounding', path: 'indicator.radius', kind: 'range', min: 0, max: 80, step: 1, show: (d) => t(d) === 'bar' },
    ],
  },
  {
    id: 'colors', title: 'Colors', ctls: [
      { label: 'Lit', path: 'colors.active', kind: 'color' },
      { label: 'Warning', path: 'colors.warning', kind: 'color' },
      { label: 'Digits', path: 'colors.digits', kind: 'color' },
      { label: 'Unlit / track', path: 'colors.off', kind: 'color' },
      { label: 'Text & numbers', path: 'colors.text', kind: 'color' },
      { label: 'Major ticks', path: 'colors.tickMajor', kind: 'color' },
      { label: 'Minor ticks', path: 'colors.tickMinor', kind: 'color' },
      { label: 'Glow', path: 'glow', kind: 'toggle' },
    ],
  },
  {
    id: 'frame', title: 'Frame & face', ctls: [
      { label: 'Bezel', path: 'frame.style', kind: 'select',
        options: [['chrome', 'Chrome'], ['brushed', 'Brushed metal'], ['black', 'Black'], ['color', 'Colored metal'], ['flat', 'Flat ring'], ['none', 'None']] },
      { label: 'Shape', path: 'frame.shape', kind: 'select', options: [['round', 'Round'], ['square', 'Square']] },
      { label: 'Bezel color', path: 'frame.color', kind: 'color',
        show: (d) => d.frame.style === 'color' || d.frame.style === 'flat' },
      { label: 'Face', path: 'frame.face', kind: 'select',
        options: [['carbon', 'Carbon fiber'], ['matte', 'Matte'], ['gradient', 'Gradient'], ['none', 'None (see-through)']] },
      { label: 'Face color', path: 'frame.faceColor', kind: 'color', show: (d) => d.frame.face !== 'none' },
    ],
  },
  {
    id: 'scale', title: 'Scale (ticks & numbers)', show: (d) => t(d) !== 'none', ctls: [
      { label: 'Show scale', path: 'scale.show', kind: 'toggle' },
      { label: 'Side', path: 'scale.side', kind: 'select', options: [['start', 'Left / top'], ['end', 'Right / bottom']],
        show: (d) => t(d) === 'bar' && d.scale.show },
      { label: 'Distance from gauge', path: 'scale.offset', kind: 'range', min: -60, max: 150, step: 1, show: (d) => d.scale.show },
      { label: 'Major tick length', path: 'scale.majorLength', kind: 'range', min: 0, max: 90, step: 1, show: (d) => d.scale.show },
      { label: 'Minor tick length', path: 'scale.minorLength', kind: 'range', min: 0, max: 70, step: 1, show: (d) => d.scale.show },
      { label: 'Number distance', path: 'scale.labelGap', kind: 'range', min: 0, max: 140, step: 1, show: (d) => d.scale.show },
      { label: 'Number size', path: 'scale.labelSize', kind: 'range', min: 0, max: 90, step: 1, show: (d) => d.scale.show },
    ],
  },
  {
    id: 'readout', title: 'Digital readout', ctls: [
      { label: 'Show readout', path: 'readout.show', kind: 'toggle' },
      { label: 'Style', path: 'readout.style', kind: 'select', options: [['segment', 'LCD segments'], ['text', 'Bold text']],
        show: (d) => d.readout.show },
      { label: 'Size', path: 'readout.size', kind: 'range', min: 0.2, max: 2.6, step: 0.01, show: (d) => d.readout.show },
      { label: 'Left / right', path: 'readout.x', kind: 'range', min: 0, max: 1000, step: 1, show: (d) => d.readout.show },
      { label: 'Up / down', path: 'readout.y', kind: 'range', min: 0, max: 1000, step: 1, show: (d) => d.readout.show },
      { label: 'Background box', path: 'readout.box', kind: 'toggle', show: (d) => d.readout.show },
      { label: 'Turn warning color', path: 'readout.warnColor', kind: 'toggle', show: (d) => d.readout.show },
    ],
  },
  {
    id: 'label', title: 'Label & units', ctls: [
      { label: 'Show label', path: 'label.show', kind: 'toggle' },
      { label: 'Label size', path: 'label.size', kind: 'range', min: 10, max: 120, step: 1, show: (d) => d.label.show },
      { label: 'Label left / right', path: 'label.x', kind: 'range', min: 0, max: 1000, step: 1, show: (d) => d.label.show },
      { label: 'Label up / down', path: 'label.y', kind: 'range', min: 0, max: 1000, step: 1, show: (d) => d.label.show },
      { label: 'Accent line', path: 'label.accentLine', kind: 'toggle', show: (d) => d.label.show },
      { label: 'Show units', path: 'unit.show', kind: 'toggle' },
      { label: 'Units size', path: 'unit.size', kind: 'range', min: 10, max: 100, step: 1, show: (d) => d.unit.show },
      { label: 'Units left / right', path: 'unit.x', kind: 'range', min: 0, max: 1000, step: 1, show: (d) => d.unit.show },
      { label: 'Units up / down', path: 'unit.y', kind: 'range', min: 0, max: 1000, step: 1, show: (d) => d.unit.show },
    ],
  },
];

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * <theme-maker> — visual editor for gauge designs. Live preview on one side,
 * part controls on the other (stacked on phones). Saves into the
 * DesignRegistry; can export/import designs as .json files.
 *
 * Events: 'maker-close', 'maker-use' { designId }.
 */
export class ThemeMaker extends HTMLElement {
  private registry!: DesignRegistry;
  private gauges: GaugeDefinition[] = [];
  private design!: GaugeDesign;
  /** id the design is saved under, once saved. */
  private savedId: string | null = null;
  private dirty = false;
  private previewDef!: GaugeDefinition;
  private previewValue = 0;
  private sweeping = true;
  private sweepStart = 0;
  private raf = 0;
  private renderQueued = false;
  private openSections = new Set(['shape']);
  private gauge!: PcGauge;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  open(registry: DesignRegistry, gauges: GaugeDefinition[], startId?: string) {
    this.registry = registry;
    this.gauges = gauges;
    const start = startId ? registry.get(startId) : undefined;
    if (start && !start.builtIn) {
      this.design = clone(start);
      this.savedId = start.id;
    } else {
      // New design, or a copy of a built-in
      const base = clone(start ?? registry.resolve(null));
      this.design = { ...base, id: '', name: start ? `${start.name} copy` : 'My gauge', builtIn: false };
      this.savedId = null;
    }
    this.previewDef = gauges.find((g) => g.id === 'boost') ?? gauges[0];
    this.previewValue = this.previewDef.demoValue;
    this.dirty = !this.savedId;
    this.build();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
  }

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private build() {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host {
          display:flex; flex-direction:column; width:100dvw; height:100dvh; background:#0b0e12;
          color:#eee; font-family:Arial, sans-serif;
        }
        header {
          display:flex; align-items:center; gap:8px; flex-wrap:wrap;
          padding: max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left));
          border-bottom:1px solid #23282f; background:#0f1318;
        }
        .btn {
          background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:10px;
          min-height:44px; padding:0 14px; font:600 15px Arial, sans-serif; cursor:pointer; white-space:nowrap;
        }
        .btn:hover, .btn:active { border-color:#ff9700; }
        .btn.primary { background:#ff9700; color:#000; border-color:#ff9700; }
        .btn.danger { color:#ff8080; }
        .actions { display:contents; }
        .btn.armed { background:#5a1e1e; border-color:#ca3d3d; color:#fff; }
        #name {
          flex:1 1 140px; min-width:0; min-height:44px; background:#0e1216; color:#eee;
          border:1px solid #2a3038; border-radius:10px; padding:0 12px; font-size:16px;
        }
        #name:focus { outline:none; border-color:#ff9700; }
        .body { flex:1; min-height:0; display:grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 420px); }
        .stage { display:flex; flex-direction:column; min-height:0; padding:12px; gap:10px; }
        .preview { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; }
        .preview pc-gauge { display:block; height:100%; max-height:100%; aspect-ratio:1/1; max-width:100%; }
        .sim { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .sim select { min-height:40px; background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:8px; padding:0 8px; font-size:15px; }
        .sim input[type=range] { flex:1; min-width:120px; accent-color:#ff9700; }
        .sim label { font-size:13px; color:#9ab; display:flex; align-items:center; gap:6px; }
        .panel { overflow-y:auto; border-left:1px solid #23282f; padding:8px 12px max(16px, env(safe-area-inset-bottom)); }
        details { border-bottom:1px solid #1d2228; }
        summary {
          list-style:none; cursor:pointer; padding:14px 4px; font-weight:700; font-size:14px;
          letter-spacing:1px; color:#ff9700; text-transform:uppercase; display:flex; justify-content:space-between;
        }
        summary::-webkit-details-marker { display:none; }
        summary::after { content:'+'; color:#6b7785; }
        details[open] summary::after { content:'−'; }
        .ctl { display:grid; grid-template-columns: 1fr auto; align-items:center; gap:4px 10px; padding:6px 4px 10px; }
        .ctl > span { font-size:14px; color:#c9d0d6; }
        .ctl output { font-size:13px; color:#9ab; font-variant-numeric:tabular-nums; }
        .ctl input[type=range] { grid-column:1 / -1; width:100%; accent-color:#ff9700; height:28px; }
        .ctl select {
          grid-column:1 / -1; min-height:44px; background:#181c22; color:#eee; border:1px solid #2a3038;
          border-radius:8px; padding:0 10px; font-size:15px;
        }
        .ctl input[type=color] { width:56px; height:40px; border:1px solid #2a3038; border-radius:8px; background:#0e1216; padding:2px; }
        .ctl input[type=checkbox] { width:26px; height:26px; accent-color:#ff9700; }
        .toast {
          position:fixed; left:50%; bottom:max(20px, env(safe-area-inset-bottom)); transform:translateX(-50%);
          background:#0d2e12; color:#3dca5c; border:1px solid #1e5a28; padding:10px 16px; border-radius:10px;
          font-size:14px; opacity:0; transition:opacity .2s; pointer-events:none;
        }
        .toast.show { opacity:1; }
        .toast.err { background:#2e0d0d; color:#ff8080; border-color:#5a1e1e; }
        input[type=file] { display:none; }
        @media (max-width: 520px), (orientation: portrait) {
          .body { grid-template-columns: 1fr; grid-template-rows: minmax(170px, 32dvh) minmax(0,1fr); }
          .panel { border-left:none; border-top:1px solid #23282f; }
          header { flex-shrink:0; }
          .actions { display:flex; flex:1 0 100%; gap:8px; overflow-x:auto; padding-bottom:4px; }
          .actions .btn { flex-shrink:0; }
          .ctl input[type=range] { height:44px; }
          .ctl select, .sim select { min-height:44px; font-size:16px; }
          .sim label { min-height:44px; font-size:14px; }
          #name { flex-basis:100px; }
        }
        @media (orientation:landscape) and (min-width:521px) {
          .body { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
        }
      </style>
      <header>
        <button class="btn" id="backBtn" type="button">‹ Back</button>
        <input id="name" type="text" value="${esc(this.design.name)}" aria-label="Design name" maxlength="40" />
        <button class="btn" id="saveBtn" type="button">Save</button>
        <div class="actions">
        <button class="btn primary" id="useBtn" type="button">Use on dashboard</button>
        <button class="btn" id="exportBtn" type="button">Export</button>
        <button class="btn" id="importBtn" type="button">Import</button>
        <button class="btn danger" id="deleteBtn" type="button" ${this.savedId ? '' : 'hidden'}>Delete</button>
        </div>
        <input type="file" id="importFile" accept=".json,application/json" />
      </header>
      <div class="body">
        <div class="stage">
          <div class="preview"><pc-gauge></pc-gauge></div>
          <div class="sim">
            <select id="simGauge" aria-label="Preview gauge">
              ${this.gauges.map((g) => `<option value="${g.id}" ${g.id === this.previewDef.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
            </select>
            <input id="simValue" type="range" aria-label="Preview value" />
            <label><input id="simSweep" type="checkbox" ${this.sweeping ? 'checked' : ''}/> Sweep</label>
          </div>
        </div>
        <div class="panel" id="panel"></div>
      </div>
      <div class="toast" id="toast"></div>
    `;

    this.gauge = root.querySelector('pc-gauge') as PcGauge;
    this.wireHeader();
    this.wireSim();
    this.buildPanel();
    this.renderPreview();
    this.startSweep();
  }

  private wireHeader() {
    const root = this.shadowRoot!;
    const nameInput = root.querySelector('#name') as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      this.design.name = nameInput.value.trim() || 'My gauge';
      this.dirty = true;
      this.resetBack();
    });

    const back = root.querySelector('#backBtn') as HTMLButtonElement;
    back.addEventListener('click', () => {
      // Two taps to throw away unsaved work
      if (this.dirty && !back.classList.contains('armed')) {
        back.classList.add('armed');
        back.textContent = 'Discard changes?';
        return;
      }
      this.emit('maker-close');
    });

    root.querySelector('#saveBtn')!.addEventListener('click', () => {
      try {this.save();this.toast('Saved');} catch(error) {this.toast((error as Error).message,true);}
    });
    root.querySelector('#useBtn')!.addEventListener('click', () => {
      try {const d = this.save();this.emit('maker-use', { designId: d.id });} catch(error) {this.toast((error as Error).message,true);}
    });

    root.querySelector('#exportBtn')!.addEventListener('click', () => {
      const { builtIn: _b, ...out } = { ...this.design, id: this.savedId ?? this.registry.uniqueId(this.design.name) };
      void exportJson(`${out.id}.gauge.json`, JSON.stringify(out, null, 2));
    });

    const file = root.querySelector('#importFile') as HTMLInputElement;
    root.querySelector('#importBtn')!.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        const d = normalizeDesign(JSON.parse(await f.text()));
        if (!d) throw new Error('not a design');
        // Imported designs are new until saved; an existing id of yours gets replaced on save
        this.design = { ...d, builtIn: false };
        this.savedId = this.registry.get(d.id) && !this.registry.isBuiltIn(d.id) ? d.id : null;
        this.dirty = true;
        this.build();
        this.toast(`Loaded “${d.name}” — tap Save to keep it`);
      } catch {
        this.toast('That file isn’t a gauge design', true);
      }
    });

    const del = root.querySelector('#deleteBtn') as HTMLButtonElement;
    del.addEventListener('click', () => {
      if (!this.savedId) return;
      if (!del.classList.contains('armed')) {
        del.classList.add('armed');
        del.textContent = 'Tap again to delete';
        setTimeout(() => { del.classList.remove('armed'); del.textContent = 'Delete'; }, 3000);
        return;
      }
      try {this.registry.remove(this.savedId);this.emit('maker-close');} catch(error) {this.toast((error as Error).message,true);}
    });
  }

  private resetBack() {
    const back = this.shadowRoot!.querySelector('#backBtn') as HTMLButtonElement;
    back.classList.remove('armed');
    back.textContent = '‹ Back';
  }

  private wireSim() {
    const root = this.shadowRoot!;
    const sel = root.querySelector('#simGauge') as HTMLSelectElement;
    const slider = root.querySelector('#simValue') as HTMLInputElement;
    const sweep = root.querySelector('#simSweep') as HTMLInputElement;

    const syncSlider = () => {
      const { min, max } = this.previewDef.scale;
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(this.previewDef.precision > 0 ? 0.1 : 1);
      slider.value = String(this.previewValue);
    };
    syncSlider();

    sel.addEventListener('change', () => {
      this.previewDef = this.gauges.find((g) => g.id === sel.value) ?? this.previewDef;
      this.previewValue = this.previewDef.demoValue;
      syncSlider();
      this.renderPreview();
    });
    slider.addEventListener('input', () => {
      this.sweeping = false;
      sweep.checked = false;
      this.previewValue = Number(slider.value);
      this.gauge.value = this.previewValue;
    });
    sweep.addEventListener('change', () => {
      this.sweeping = sweep.checked;
      if (this.sweeping) this.startSweep();
    });
  }

  /** Slow min→max→min sweep so warning colors and the full arc are visible. */
  private startSweep() {
    cancelAnimationFrame(this.raf);
    this.sweepStart = performance.now();
    const slider = this.shadowRoot!.querySelector('#simValue') as HTMLInputElement;
    const tick = (now: number) => {
      if (!this.sweeping || !this.isConnected) return;
      const { min, max } = this.previewDef.scale;
      const phase = ((now - this.sweepStart) / 6000) * Math.PI * 2;
      const v = min + (max - min) * (0.5 - 0.5 * Math.cos(phase));
      this.previewValue = Number(v.toFixed(this.previewDef.precision));
      this.gauge.value = this.previewValue;
      slider.value = String(this.previewValue);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private renderPreview() {
    this.gauge.configure(this.previewDef, this.design);
    this.gauge.value = this.previewValue;
  }

  private queueRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderPreview();
    });
  }

  private buildPanel() {
    const panel = this.shadowRoot!.querySelector('#panel') as HTMLDivElement;
    const scroll = panel.scrollTop;
    const d = this.design;
    panel.innerHTML = SECTIONS.filter((s) => !s.show || s.show(d)).map((s) => `
      <details data-section="${s.id}" ${this.openSections.has(s.id) ? 'open' : ''}>
        <summary>${s.title}</summary>
        ${s.ctls.filter((c) => !c.show || c.show(d)).map((c) => this.ctlHtml(c)).join('')}
      </details>`).join('');
    panel.scrollTop = scroll;

    panel.querySelectorAll('details').forEach((det) => {
      det.addEventListener('toggle', () => {
        const id = det.dataset.section!;
        if (det.open) this.openSections.add(id); else this.openSections.delete(id);
      });
    });
    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]').forEach((inp) => {
      const path = inp.dataset.path!;
      const kind = inp.dataset.kind as Kind;
      inp.addEventListener('input', () => {
        if (kind === 'range') {
          const v = Number(inp.value);
          setPath(this.design as unknown as Record<string, unknown>, path, v);
          const out = inp.parentElement!.querySelector('output');
          if (out) out.textContent = this.fmt(v, Number((inp as HTMLInputElement).step));
          this.changed(path === 'indicator.segments');
        } else if (kind === 'color') {
          setPath(this.design as unknown as Record<string, unknown>, path, inp.value);
          this.changed(false);
        }
      });
      inp.addEventListener('change', () => {
        if (kind === 'toggle') {
          setPath(this.design as unknown as Record<string, unknown>, path, (inp as HTMLInputElement).checked);
          this.changed(true);
        } else if (kind === 'select') {
          if (path === 'indicator.type') this.switchIndicator(inp.value as IndicatorType);
          else setPath(this.design as unknown as Record<string, unknown>, path, inp.value);
          this.changed(true);
        }
      });
    });
  }

  /** Change gauge type; keep arc geometry when going between arc types. */
  private switchIndicator(type: IndicatorType) {
    const prev = this.design.indicator as unknown as Record<string, unknown>;
    const next = clone(INDICATOR_DEFAULTS[type]) as unknown as Record<string, unknown>;
    for (const k of ['startDeg', 'endDeg', 'radius']) {
      if (k in prev && k in next) next[k] = prev[k];
    }
    this.design.indicator = next as unknown as GaugeDesign['indicator'];
    // Move readout / label / units to a sensible spot for the new shape —
    // the user can fine-tune from there.
    const d = this.design;
    switch (type) {
      case 'needle':
        d.readout = { ...d.readout, x: 500, y: 705, size: 0.42 };
        d.unit = { ...d.unit, x: 500, y: 625 };
        d.label = { ...d.label, x: 500, y: 830, size: 40 };
        break;
      case 'bar':
        d.readout = { ...d.readout, style: 'text', x: 290, y: 470, size: 0.75, box: false };
        d.unit = { ...d.unit, x: 290, y: 585, size: 34 };
        d.label = { ...d.label, x: 290, y: 300, size: 50 };
        d.scale = { ...d.scale, side: 'start', offset: 14, labelGap: 20 };
        break;
      case 'none':
        d.readout = { ...d.readout, show: true, style: 'text', x: 500, y: 455, size: 1.55, box: false };
        d.unit = { ...d.unit, x: 500, y: 650, size: 46 };
        d.label = { ...d.label, x: 500, y: 810, size: 64 };
        break;
      default: // arcs
        d.readout = { ...d.readout, x: 500, y: 488, size: 1 };
        d.unit = { ...d.unit, x: 500, y: 625 };
        d.label = { ...d.label, x: 500, y: 790, size: 48 };
        d.scale = { ...d.scale, offset: 18, labelGap: 31 };
    }
  }

  private changed(rebuildPanel: boolean) {
    this.dirty = true;
    this.resetBack();
    if (rebuildPanel) this.buildPanel();
    this.queueRender();
  }

  private fmt(v: number, step: number) {
    return step < 1 ? v.toFixed(2) : String(Math.round(v));
  }

  private ctlHtml(c: Ctl): string {
    const v = getPath(this.design, c.path);
    const attrs = `data-path="${c.path}" data-kind="${c.kind}"`;
    switch (c.kind) {
      case 'range':
        return `<label class="ctl"><span>${c.label}</span><output>${this.fmt(Number(v), c.step ?? 1)}</output>
          <input type="range" ${attrs} min="${c.min}" max="${c.max}" step="${c.step ?? 1}" value="${v}" /></label>`;
      case 'color':
        return `<label class="ctl"><span>${c.label}</span><input type="color" ${attrs} value="${v}" /></label>`;
      case 'toggle':
        return `<label class="ctl"><span>${c.label}</span><input type="checkbox" ${attrs} ${v ? 'checked' : ''} /></label>`;
      case 'select':
        return `<label class="ctl"><span>${c.label}</span><select ${attrs}>
          ${c.options!.map(([val, lbl]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${lbl}</option>`).join('')}
        </select></label>`;
    }
  }

  private save(): GaugeDesign {
    const id = this.savedId ?? this.registry.uniqueId(this.design.name);
    const saved = this.registry.save({ ...this.design, id });
    this.savedId = saved.id;
    this.design = clone(saved);
    this.dirty = false;
    this.resetBack();
    (this.shadowRoot!.querySelector('#deleteBtn') as HTMLButtonElement).hidden = false;
    return saved;
  }

  private toast(msg: string, err = false) {
    const el = this.shadowRoot!.querySelector('#toast') as HTMLDivElement;
    el.textContent = msg;
    el.className = `toast show${err ? ' err' : ''}`;
    setTimeout(() => { el.className = 'toast'; }, 2200);
  }
}

customElements.define('theme-maker', ThemeMaker);
