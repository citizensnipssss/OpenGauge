import '../dashboard-slot/dashboard-slot';
import '../channel-picker/channel-picker';
import '../gauge-settings/gauge-settings';
import '../theme-settings/theme-settings';
import type { DashboardSlot } from '../dashboard-slot/dashboard-slot';
import type { ChannelPicker } from '../channel-picker/channel-picker';
import type { GaugeSettings } from '../gauge-settings/gauge-settings';
import type { ThemeSettings } from '../theme-settings/theme-settings';
import type {
  DashboardConfig,
  GaugeDefinition,
  LayoutDefinition,
  LayoutOrientationGeometry,
  LayoutRegistry,
  ThemeConfig,
  ThemeOverrides,
} from '../../registry/types';
import { LayoutFitController } from '../../layout/layoutEngine';
import { TelemetryStore } from '../../telemetry/TelemetryStore';
import { SimulatorProvider } from '../../telemetry/SimulatorProvider';
import { WebSocketProvider } from '../../telemetry/WebSocketProvider';
import type { SimulatorScenario, TelemetryProvider } from '../../telemetry/types';

export interface DashboardViewDeps {
  gauges: GaugeDefinition[];
  theme: ThemeConfig;
  layoutRegistry: LayoutRegistry;
}

const SCENARIOS: { id: SimulatorScenario; label: string }[] = [
  { id: 'idle',         label: 'Idle' },
  { id: 'cruise',       label: 'Cruise' },
  { id: 'hard_pull',    label: 'Hard Pull' },
  { id: 'cool_down',    label: 'Cool Down' },
  { id: 'sensor_fault', label: 'Sensor Fault' },
  { id: 'disconnect',   label: 'Disconnect' },
];

/** Merge themeOverrides onto a ThemeConfig without mutating the registry copy. */
function applyThemeOverrides(theme: ThemeConfig, overrides: ThemeOverrides | undefined): ThemeConfig {
  if (!overrides || Object.keys(overrides).length === 0) return theme;
  return {
    ...theme,
    colors: {
      active:  overrides.activeColor  ?? theme.colors.active,
      warning: overrides.warningColor ?? theme.colors.warning,
      digits:  overrides.digitColor   ?? theme.colors.digits,
    },
  };
}

/**
 * <dashboard-view> — the live/editable dashboard: composes <dashboard-slot>
 * per the current layout+config, keeps them fitted via LayoutFitController,
 * and hosts the top bar (Layout/Theme/Colors/Scenario/Export/Import),
 * <channel-picker>, <gauge-settings>, and <theme-settings>.
 * Owns TelemetryStore + SimulatorProvider for Phase 2.
 */
export class DashboardView extends HTMLElement {
  private deps!: DashboardViewDeps;
  private config!: DashboardConfig;
  private layout!: LayoutDefinition;
  private fitController?: LayoutFitController;
  private grid!: HTMLDivElement;
  private slotEls = new Map<string, DashboardSlot>();
  private picker!: ChannelPicker;
  private gaugeSettings!: GaugeSettings;
  private themeSettings!: ThemeSettings;
  private store = new TelemetryStore();
  private provider: TelemetryProvider;
  private isSimulator: boolean;
  private scenarioSelect!: HTMLSelectElement;
  private connIndicator!: HTMLSpanElement;
  private connUnsub?: () => void;
  private topbar!: HTMLDivElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // On the ESP32 the page is served from a non-localhost host.
    // Use WebSocket to device; keep simulator for local dev.
    const host = window.location.hostname;
    this.isSimulator = (host === 'localhost' || host === '127.0.0.1');
    if (this.isSimulator) {
      this.provider = new SimulatorProvider(this.store);
    } else {
      const wsUrl = `ws://${host}:81/`;
      this.provider = new WebSocketProvider(this.store, wsUrl);
    }
  }

  configure(deps: DashboardViewDeps, config: DashboardConfig) {
    this.deps = deps;
    this.config = config;
    const layout = deps.layoutRegistry.layouts.find((l) => l.layoutId === config.layoutId);
    if (!layout) throw new Error(`Unknown layoutId: ${config.layoutId}`);
    this.layout = layout;
    this.build();
  }

  /** Called after a channel assignment, override save, or import — only content changes. */
  updateConfig(config: DashboardConfig) {
    this.config = config;
    this.renderAllContent();
  }

  disconnectedCallback() {
    this.provider.stop();
    this.connUnsub?.();
    this.fitController?.destroy();
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
  }

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** Current theme with any user color overrides applied. */
  private get effectiveTheme(): ThemeConfig {
    return applyThemeOverrides(this.deps.theme, this.config.themeOverrides);
  }

  private build() {
    this.provider.stop();
    this.connUnsub?.();

    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host { display:block; position:relative; width:100dvw; height:100dvh; background:#0b0e12; overflow:hidden; }
        .topbar {
          position:absolute; top:0; left:0; right:0; z-index:20;
          display:flex; gap:8px; align-items:center; flex-wrap:wrap;
          padding: max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) 10px
                   max(10px, env(safe-area-inset-left));
          background:#0b0e12ee;
          border-bottom:1px solid #23282f;
          transition: transform 0.35s ease, opacity 0.35s ease;
          will-change: transform, opacity;
        }
        .topbar.hidden {
          transform: translateY(-110%);
          opacity: 0;
          pointer-events: none;
        }
        .topbar button {
          background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:8px;
          padding:8px 14px; min-height:44px; font-family:Arial, sans-serif; cursor:pointer;
        }
        .topbar button:hover { border-color:#ff9700; }
        .title { font-weight:700; color:#eee; font-family:Arial, sans-serif; margin-right:auto; }
        select {
          background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:8px;
          padding:8px 10px; min-height:44px; font-family:Arial, sans-serif; cursor:pointer;
          font-size:14px;
        }
        select:hover { border-color:#ff9700; }
        .conn {
          font-family:Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:1px;
          padding:4px 10px; border-radius:6px; white-space:nowrap;
        }
        .conn.connected    { background:#0d2e12; color:#3dca5c; border:1px solid #1e5a28; }
        .conn.disconnected { background:#2e0d0d; color:#ca3d3d; border:1px solid #5a1e1e; }
        .conn.stale        { background:#2a230a; color:#c8a020; border:1px solid #5a4a10; }
        .conn.connecting   { background:#0d1a2e; color:#4a90ca; border:1px solid #1e3a5a; }
        .grid-wrap {
          position:absolute; inset:0;
          padding: 10px max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom))
                   max(10px, env(safe-area-inset-left));
          transition: padding-top 0.35s ease;
        }
        .grid-wrap.bar-visible { padding-top: var(--topbar-h, 64px); }
        .grid { width:100%; height:100%; }
        /* Corner button to recall the bar when hidden */
        .recall-btn {
          position:absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right));
          z-index:10; width:36px; height:36px; border-radius:50%;
          background:rgba(24,28,34,0.72); border:1px solid #2a3038;
          color:#9ab; font-size:18px; line-height:1; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          transition: opacity 0.35s ease;
          backdrop-filter: blur(4px);
        }
        .recall-btn.bar-visible { opacity:0; pointer-events:none; }
        input[type=file] { display:none; }
      </style>
      <div class="topbar">
        <div class="title">${this.layout.name}</div>
        <span class="conn connecting" id="connIndicator">CONNECTING</span>
        ${this.isSimulator ? `<select id="scenarioSelect">
          ${SCENARIOS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}
        </select>` : ''}
        <button id="fullscreenBtn" type="button" title="Fullscreen">⛶</button>
        <button id="layoutBtn"  type="button">Layout</button>
        <button id="themeBtn"   type="button">Theme</button>
        <button id="colorsBtn"  type="button">Colors</button>
        <button id="exportBtn"  type="button">Export</button>
        <button id="importBtn"  type="button">Import</button>
        <button id="updateBtn"  type="button">Update</button>
        <input type="file" id="importFile" accept="application/json" />
      </div>

      <!-- Update panel -->
      <div id="updatePanel" style="
        display:none; position:absolute; inset:0; z-index:30;
        background:rgba(0,0,0,0.85); align-items:center; justify-content:center;
      ">
        <div style="
          background:#0f1318; border:1px solid #2a3038; border-radius:12px;
          padding:28px; max-width:340px; width:90%; font-family:Arial,sans-serif; color:#eee;
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
            <span style="font-weight:700; font-size:16px; letter-spacing:2px;">UPDATE</span>
            <button id="updateCloseBtn" style="
              background:none; border:none; color:#666; font-size:22px; cursor:pointer; padding:0 4px;
            ">✕</button>
          </div>
          <div id="updateStatus" style="color:#666; font-size:13px; margin-bottom:18px;">Checking for updates…</div>
          <div id="updateActions" style="display:flex; flex-direction:column; gap:10px;"></div>
        </div>
      </div>
      <div class="grid-wrap bar-visible" id="gridWrap"><div class="grid"></div></div>
      <button class="recall-btn bar-visible" id="recallBtn" type="button" title="Show controls">&#9776;</button>
      <channel-picker></channel-picker>
      <gauge-settings></gauge-settings>
      <theme-settings></theme-settings>
    `;

    this.grid           = root.querySelector('.grid') as HTMLDivElement;
    this.picker         = root.querySelector('channel-picker') as ChannelPicker;
    this.gaugeSettings  = root.querySelector('gauge-settings') as GaugeSettings;
    this.themeSettings  = root.querySelector('theme-settings') as ThemeSettings;
    this.scenarioSelect = root.querySelector('#scenarioSelect') as HTMLSelectElement;
    this.connIndicator  = root.querySelector('#connIndicator') as HTMLSpanElement;
    this.topbar         = root.querySelector('.topbar') as HTMLDivElement;
    const gridWrap      = root.querySelector('#gridWrap') as HTMLDivElement;

    // Measure topbar height after first paint and keep --topbar-h in sync
    const updateTopbarHeight = () => {
      const h = this.topbar.getBoundingClientRect().height;
      if (h > 0) gridWrap.style.setProperty('--topbar-h', `${h}px`);
    };
    // Use ResizeObserver so it stays correct if the bar wraps on narrow screens
    const tbRo = new ResizeObserver(updateTopbarHeight);
    tbRo.observe(this.topbar);

    const recallBtn = root.querySelector('#recallBtn') as HTMLButtonElement;

    // Auto-hide topbar — show on any interaction, hide after 3s idle
    const showTopbar = () => {
      this.topbar.classList.remove('hidden');
      gridWrap.classList.add('bar-visible');
      recallBtn.classList.add('bar-visible');
      if (this.hideTimer !== null) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.topbar.classList.add('hidden');
        gridWrap.classList.remove('bar-visible');
        recallBtn.classList.remove('bar-visible');
      }, 3000);
    };
    // Corner button brings bar back when hidden
    recallBtn.addEventListener('click', showTopbar);
    // Any interaction with the topbar itself resets the timer
    this.topbar.addEventListener('pointerdown', showTopbar);
    // Kick off the initial hide countdown
    showTopbar();

    if (this.isSimulator) {
      this.scenarioSelect = root.querySelector('#scenarioSelect') as HTMLSelectElement;
      this.scenarioSelect.addEventListener('change', () => {
        (this.provider as SimulatorProvider).setScenario(this.scenarioSelect.value as SimulatorScenario);
      });
    }

    const fsBtn = root.querySelector('#fullscreenBtn') as HTMLButtonElement;
    const updateFsIcon = () => {
      fsBtn.textContent = document.fullscreenElement ? '✕' : '⛶';
      fsBtn.title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    };
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }
    });
    document.addEventListener('fullscreenchange', updateFsIcon);

    root.querySelector('#layoutBtn')!.addEventListener('click', () => this.emit('edit-layout'));
    root.querySelector('#themeBtn')!.addEventListener('click',  () => this.emit('edit-theme'));
    root.querySelector('#colorsBtn')!.addEventListener('click', () => {
      this.themeSettings.open(this.deps.theme, this.config.themeOverrides);
    });
    root.querySelector('#exportBtn')!.addEventListener('click', () => this.emit('export-requested'));
    const fileInput = root.querySelector('#importFile') as HTMLInputElement;
    root.querySelector('#importBtn')!.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      this.emit('import-requested', { text });
      fileInput.value = '';
    });

    // Update panel
    const updatePanel   = root.querySelector('#updatePanel')   as HTMLDivElement;
    const updateStatus  = root.querySelector('#updateStatus')  as HTMLDivElement;
    const updateActions = root.querySelector('#updateActions') as HTMLDivElement;

    const closeUpdatePanel = () => { updatePanel.style.display = 'none'; };
    root.querySelector('#updateCloseBtn')!.addEventListener('click', closeUpdatePanel);

    root.querySelector('#updateBtn')!.addEventListener('click', async () => {
      updatePanel.style.display = 'flex';
      updateStatus.textContent = 'Checking for updates…';
      updateActions.innerHTML = '';

      try {
        const res = await fetch('https://api.github.com/repos/citizensnipssss/OpenGauge/releases/latest');
        if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
        const release = await res.json();
        const tag = release.tag_name as string;
        const assets = release.assets as { name: string; browser_download_url: string }[];

        const firmwareAsset  = assets.find(a => a.name.endsWith('.bin'));
        const dashboardAsset = assets.find(a => a.name.endsWith('.zip'));

        updateStatus.innerHTML = `Latest release: <strong style="color:#ff9700">${tag}</strong>`;

        const btnStyle = `
          background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:8px;
          padding:12px 16px; font-family:Arial,sans-serif; font-size:13px; cursor:pointer;
          text-align:left; width:100%;
        `;

        if (firmwareAsset) {
          const btn = document.createElement('button');
          btn.style.cssText = btnStyle;
          btn.textContent = `Install Firmware (${firmwareAsset.name})`;
          btn.addEventListener('click', async () => {
            btn.textContent = 'Downloading…';
            btn.style.color = '#ff9700';
            try {
              const blob = await (await fetch(firmwareAsset.browser_download_url)).blob();
              const formData = new FormData();
              formData.append('file', blob, firmwareAsset.name);
              const uploadRes = await fetch(`http://${window.location.host}/upload?path=/firmware.bin`, {
                method: 'POST', body: formData,
              });
              btn.textContent = uploadRes.ok ? '✓ Firmware uploaded — device rebooting' : '✕ Upload failed';
              btn.style.color = uploadRes.ok ? '#00e060' : '#e03030';
            } catch {
              btn.textContent = '✕ Download failed — check internet connection';
              btn.style.color = '#e03030';
            }
          });
          updateActions.appendChild(btn);
        }

        if (dashboardAsset) {
          const btn = document.createElement('button');
          btn.style.cssText = btnStyle;
          btn.textContent = `Install Dashboard (${dashboardAsset.name})`;
          btn.addEventListener('click', async () => {
            btn.textContent = 'Downloading…';
            btn.style.color = '#ff9700';
            try {
              const blob = await (await fetch(dashboardAsset.browser_download_url)).blob();
              const formData = new FormData();
              formData.append('file', blob, dashboardAsset.name);
              const uploadRes = await fetch(`http://${window.location.host}/upload?path=/dashboard.zip`, {
                method: 'POST', body: formData,
              });
              btn.textContent = uploadRes.ok ? '✓ Dashboard uploaded — refresh to apply' : '✕ Upload failed';
              btn.style.color = uploadRes.ok ? '#00e060' : '#e03030';
            } catch {
              btn.textContent = '✕ Download failed — check internet connection';
              btn.style.color = '#e03030';
            }
          });
          updateActions.appendChild(btn);
        }

        if (!firmwareAsset && !dashboardAsset) {
          updateStatus.textContent = 'No installable assets found in latest release.';
        }

      } catch {
        updateStatus.textContent = '✕ Could not reach GitHub. Check your internet connection.';
      }
    });

    // Channel picker
    root.addEventListener('slot-activated', (e) => {
      const { slotId } = (e as CustomEvent).detail;
      this.openPickerFor(slotId);
    });
    root.addEventListener('channel-selected', (e) => {
      const { slotId, channelId } = (e as CustomEvent).detail;
      this.emit('channel-assigned', { slotId, channelId });
    });

    // Gauge settings (long-press)
    root.addEventListener('slot-long-pressed', (e) => {
      const { slotId } = (e as CustomEvent).detail;
      const slotConfig = this.config.slots.find((s) => s.slotId === slotId);
      const def = this.deps.gauges.find((g) => g.id === slotConfig?.channelId);
      if (!def) return; // no gauge assigned — do nothing on long-press
      this.gaugeSettings.open(slotId, def, slotConfig!.overrides);
    });
    root.addEventListener('overrides-saved', (e) => {
      const { slotId, overrides } = (e as CustomEvent).detail;
      this.emit('slot-overrides-changed', { slotId, overrides });
    });

    // Theme color overrides
    root.addEventListener('theme-overrides-saved', (e) => {
      const { overrides } = (e as CustomEvent).detail;
      this.emit('theme-overrides-changed', { overrides });
    });

    // Connection status indicator
    this.connUnsub = this.store.subscribeConnection((status) => {
      const labels: Record<string, string> = {
        connecting: 'CONNECTING', connected: 'SIM', stale: 'STALE', disconnected: 'OFFLINE',
      };
      this.connIndicator.textContent = labels[status] ?? status.toUpperCase();
      this.connIndicator.className = `conn ${status}`;
    });

    this.slotEls.clear();
    this.fitController?.destroy();
    this.fitController = new LayoutFitController(
      this.grid,
      this.layout,
      this.deps.layoutRegistry.fitPolicy,
      'fit-all',
      (_result, geometry) => this.positionSlots(geometry),
    );

    this.provider.start();
  }

  private positionSlots(geometry: LayoutOrientationGeometry) {
    const theme = this.effectiveTheme;
    for (const slotGeom of geometry.slots) {
      let el = this.slotEls.get(slotGeom.slotId);
      if (!el) {
        el = document.createElement('dashboard-slot') as DashboardSlot;
        this.slotEls.set(slotGeom.slotId, el);
        this.grid.appendChild(el);
        const slotConfig = this.config.slots.find((s) => s.slotId === slotGeom.slotId);
        const gaugeDef = this.deps.gauges.find((g) => g.id === slotConfig?.channelId) ?? null;
        el.setContent(gaugeDef, theme, this.store, slotConfig?.overrides ?? {});
      }
      el.setGeometry(slotGeom);
    }
  }

  private renderAllContent() {
    const theme = this.effectiveTheme;
    for (const slotConfig of this.config.slots) {
      const el = this.slotEls.get(slotConfig.slotId);
      if (!el) continue;
      const gaugeDef = this.deps.gauges.find((g) => g.id === slotConfig.channelId) ?? null;
      el.setContent(gaugeDef, theme, this.store, slotConfig.overrides);
    }
  }

  private openPickerFor(slotId: string) {
    const assignedElsewhere = new Set(
      this.config.slots.filter((s) => s.slotId !== slotId && s.channelId).map((s) => s.channelId as string),
    );
    const current = this.config.slots.find((s) => s.slotId === slotId)?.channelId ?? null;
    this.picker.open(this.deps.gauges, assignedElsewhere, slotId, current);
  }
}

customElements.define('dashboard-view', DashboardView);
