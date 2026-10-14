import '../sensor-settings/sensor-settings';
import type { SensorSettings } from '../sensor-settings/sensor-settings';
import '../device-settings/device-settings';
import '../release-browser/release-browser';
import type { ReleaseBrowser } from '../release-browser/release-browser';
import type { DeviceSettings } from '../device-settings/device-settings';
import { connection, websocketUrl, deviceUrl, isNative } from '../../platform/connection';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import '../dashboard-slot/dashboard-slot';
import '../channel-picker/channel-picker';
import '../gauge-settings/gauge-settings';
import '../theme-settings/theme-settings';
import '../update-panel/update-panel';
import type { DashboardSlot } from '../dashboard-slot/dashboard-slot';
import type { ChannelPicker } from '../channel-picker/channel-picker';
import type { GaugeSettings } from '../gauge-settings/gauge-settings';
import type { ThemeSettings } from '../theme-settings/theme-settings';
import type { UpdatePanel } from '../update-panel/update-panel';
import type {
  DashboardConfig,
  GaugeDefinition,
  LayoutDefinition,
  LayoutOrientationGeometry,
  LayoutRegistry,
  ThemeOverrides,
} from '../../registry/types';
import { LayoutFitController } from '../../layout/layoutEngine';
import type { DesignRegistry } from '../../design/registry';
import type { GaugeDesign } from '../../design/types';
import { TelemetryStore } from '../../telemetry/TelemetryStore';
import { SimulatorProvider } from '../../telemetry/SimulatorProvider';
import { WebSocketProvider } from '../../telemetry/WebSocketProvider';
import type { SimulatorScenario, TelemetryProvider } from '../../telemetry/types';

export interface DashboardViewDeps {
  gauges: GaugeDefinition[];
  designs: DesignRegistry;
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

/** Merge the Colors panel overrides onto a design without mutating the registry copy. */
function applyThemeOverrides(design: GaugeDesign, overrides: ThemeOverrides | undefined): GaugeDesign {
  if (!overrides || Object.keys(overrides).length === 0) return design;
  return {
    ...design,
    colors: {
      ...design.colors,
      active:  overrides.activeColor  ?? design.colors.active,
      warning: overrides.warningColor ?? design.colors.warning,
      digits:  overrides.digitColor   ?? design.colors.digits,
    },
  };
}

/**
 * <dashboard-view> — the live/editable dashboard: composes <dashboard-slot>
 * per the current layout+config, keeps them fitted via LayoutFitController,
 * and hosts the slim status bar, the always-visible menu (Layout/Theme/
 * Colors/Export/Import/Update/Fullscreen), <channel-picker>,
 * <gauge-settings>, <theme-settings>, and <update-panel>.
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
  private updatePanel!: UpdatePanel;
  private store = new TelemetryStore();
  private provider: TelemetryProvider;
  private isSimulator: boolean;
  private connIndicator!: HTMLSpanElement;
  private connUnsub?: () => void;
  private topbar!: HTMLDivElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private onKeyDown?: (e: KeyboardEvent) => void;
  private onFullscreenChange?: () => void;
  private appListener?: Promise<PluginListenerHandle>;
  private onVisibility = () => {
    if (document.hidden) this.provider.stop(); else this.provider.start();
  };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // On the ESP32 the page is served from a non-localhost host.
    // Use WebSocket to device; keep simulator for local dev.
    this.isSimulator = connection().demo;
    if (this.isSimulator) {
      this.provider = new SimulatorProvider(this.store);
    } else {
      const wsUrl = websocketUrl();
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
    document.addEventListener('visibilitychange', this.onVisibility);
    if (isNative()) {
      this.appListener = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) this.provider.start(); else this.provider.stop();
      });
      // Native HTTP makes the local-network permission request explicit;
      // only WebSocket messages determine telemetry connection status.
      if (!this.isSimulator) {
        void fetch(deviceUrl('/api/sensors'), { signal: AbortSignal.timeout(5000) }).catch(() => {});
      }
    }
  }

  /** Called after a channel assignment, override save, or import — only content changes. */
  updateConfig(config: DashboardConfig) {
    this.config = config;
    this.renderAllContent();
  }

  disconnectedCallback() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.appListener?.then((listener) => listener.remove());
    this.provider.stop();
    this.connUnsub?.();
    this.fitController?.destroy();
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
    if (this.onFullscreenChange) document.removeEventListener('fullscreenchange', this.onFullscreenChange);
  }

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** The dashboard-wide design (themeId) — what the Colors panel edits. */
  private get dashboardDesign(): GaugeDesign {
    return this.deps.designs.resolve(this.config.themeId);
  }

  /** Design for one slot: its own pick, else the dashboard's, plus color overrides. */
  private designFor(slot: DashboardConfig['slots'][number] | undefined): GaugeDesign {
    const base = this.deps.designs.resolve(slot?.overrides.designId ?? this.config.themeId);
    return applyThemeOverrides(base, this.config.themeOverrides);
  }

  private build() {
    this.provider.stop();
    this.connUnsub?.();

    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host { display:block; position:relative; width:100dvw; height:100dvh; background:#0b0e12; overflow:hidden; }
        /* Slim status bar: name + connection + fullscreen. Never wraps. */
        .topbar {
          position:absolute; top:0; left:0; right:0; z-index:20;
          display:flex; gap:8px; align-items:center; flex-wrap:nowrap;
          padding: max(8px, env(safe-area-inset-top)) calc(max(8px, env(safe-area-inset-right)) + 56px) 8px
                   max(12px, env(safe-area-inset-left));
          min-height:60px;
          background:#0b0e12ee;
          border-bottom:1px solid #23282f;
          transition: transform 0.35s ease, opacity 0.35s ease;
          will-change: transform, opacity;
        }
        .topbar.hidden { transform: translateY(-110%); opacity: 0; pointer-events: none; }
        .title {
          font-weight:700; color:#eee; font-family:Arial, sans-serif; font-size:16px;
          margin-right:auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .icon-btn {
          background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:10px;
          width:44px; height:44px; flex-shrink:0; font-size:18px; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
        }
        .icon-btn:hover, .icon-btn:active { border-color:#ff9700; }
        .conn {
          font-family:Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:1px;
          padding:4px 10px; border-radius:6px; white-space:nowrap; flex-shrink:0;
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
        .grid-wrap.bar-visible { padding-top: var(--topbar-h, 60px); }
        .grid { width:100%; height:100%; }

        /* Menu button — always on screen, top-right, so nav is one tap away. */
        .menu-btn {
          position:absolute; z-index:25;
          top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right));
          width:48px; height:44px; border-radius:10px;
          background:rgba(24,28,34,0.85); border:1px solid #2a3038; color:#eee;
          font-size:22px; line-height:1; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          backdrop-filter: blur(4px);
        }
        .menu-btn:hover, .menu-btn:active { border-color:#ff9700; }

        /* Slide-in menu */
        .drawer-backdrop {
          position:absolute; inset:0; z-index:40; background:rgba(0,0,0,.55);
          opacity:0; pointer-events:none; transition:opacity .25s ease;
        }
        .drawer {
          position:absolute; top:0; right:0; bottom:0; z-index:41;
          width:min(320px, 86vw); background:#0f1318; border-left:1px solid #2a3038;
          transform:translateX(100%); transition:transform .25s ease;
          display:flex; flex-direction:column; overflow-y:auto;
          padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
                   max(12px, env(safe-area-inset-bottom)) 12px;
          font-family:Arial, sans-serif; color:#eee;
        }
        :host(.menu-open) .drawer-backdrop { opacity:1; pointer-events:auto; }
        :host(.menu-open) .drawer { transform:translateX(0); }
        .drawer-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
        .drawer-head span { font-weight:700; letter-spacing:2px; font-size:15px; color:#9ab; }
        .drawer-close { background:none; border:none; color:#9ab; font-size:28px; min-width:48px; min-height:48px; cursor:pointer; }
        .section { font-size:11px; letter-spacing:2px; color:#6b7785; margin:16px 4px 6px; }
        .item {
          display:flex; align-items:center; gap:14px; width:100%; min-height:56px; padding:0 14px;
          background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:10px;
          font:600 16px Arial, sans-serif; text-align:left; cursor:pointer; margin-bottom:8px; flex-shrink:0;
        }
        .item:hover, .item:active { border-color:#ff9700; }
        .item .ic { width:24px; text-align:center; font-size:20px; color:#ff9700; flex-shrink:0; }
        .item .chev { margin-left:auto; color:#6b7785; font-size:20px; }
        .hint { font-size:13px; color:#9ab; line-height:1.5; padding:0 4px; }
        .drawer select {
          width:100%; min-height:52px; background:#181c22; color:#eee; border:1px solid #2a3038;
          border-radius:10px; padding:0 12px; font-size:16px; flex-shrink:0;
        }
        input[type=file] { display:none; }
        button { touch-action:manipulation; }
        button:focus-visible, select:focus-visible { outline:2px solid #ff9700; outline-offset:3px; }
        [hidden] { display:none !important; }
        @media (max-width:600px), (max-height:500px) and (max-width:1024px), (pointer:coarse) {
          .topbar { padding-top:calc(env(safe-area-inset-top,0px) + 8px); }
          .topbar.hidden { transform:none; opacity:1; pointer-events:auto; }
          .grid-wrap { padding-top:var(--topbar-h,60px); }
          .menu-btn { top:calc(env(safe-area-inset-top,0px) + 8px); width:48px; height:48px; }
          .icon-btn { width:48px; height:48px; }
          .conn { font-size:13px; padding:8px 10px; }
          .drawer { top:auto; left:0; width:100%; max-height:85dvh; border-radius:24px 24px 0 0; border:1px solid #2a3038; transform:translateY(100%); padding:16px max(16px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom,0px) + 16px) max(16px,env(safe-area-inset-left)); overscroll-behavior:contain; }
          .drawer-head { position:sticky; top:-16px; background:#0f1318; z-index:1; }
          .section { font-size:12px; color:#9aabba; }
        }
        @media (prefers-reduced-motion:reduce) {
          .topbar, .grid-wrap, .drawer, .drawer-backdrop { transition:none; }
        }
      </style>
      <div class="topbar">
        <div class="title"></div>
        <span class="conn connecting" id="connIndicator">CONNECTING</span>
        <button class="icon-btn" id="fullscreenBtn" type="button" title="Fullscreen">⛶</button>
      </div>
      <div class="grid-wrap bar-visible" id="gridWrap"><div class="grid"></div></div>
      <button class="menu-btn" id="menuBtn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="dashboardMenu">&#9776;</button>

      <div class="drawer-backdrop" id="drawerBackdrop"></div>
      <nav class="drawer" id="dashboardMenu" aria-label="Menu" inert>
        <div class="drawer-head">
          <span>MENU</span>
          <button class="drawer-close" id="drawerClose" type="button" aria-label="Close menu">&times;</button>
        </div>

        <div class="section">DASHBOARD</div>
        <button class="item" data-action="layout" type="button"><span class="ic">▦</span>Layout<span class="chev">›</span></button>
        <button class="item" data-action="theme"  type="button"><span class="ic">◐</span>Theme<span class="chev">›</span></button>
        <button class="item" data-action="colors" type="button"><span class="ic">●</span>Colors<span class="chev">›</span></button>
        <button class="item" data-action="maker"  type="button"><span class="ic">✎</span>Theme Maker<span class="chev">›</span></button>
        <div class="hint">Tap a gauge to change what it shows.<br>Press and hold a gauge for its style and limits.</div>

        <div class="section">SETTINGS FILE</div>
        <button class="item" data-action="export" type="button"><span class="ic">⇪</span>Export settings</button>
        <button class="item" data-action="import" type="button"><span class="ic">⇩</span>Import settings</button>
        <button class="item" data-action="export-layout" type="button"><span class="ic">⇪</span>Export layout for sharing</button>

        <div class="section">DEVICE</div>
        <button class="item" data-action="sensors" type="button"><span class="ic">⚙</span>Boards &amp; sensors<span class="chev">›</span></button>
        <button class="item" data-action="browse" type="button"><span class="ic">✦</span>Releases &amp; community<span class="chev">›</span></button>
        ${isNative() ? `<button class="item" data-action="connection" type="button"><span class="ic">⚡</span>Device connection<span class="chev">›</span></button>` : ''}
        <button class="item" data-action="update" type="button"><span class="ic">⟳</span>Update<span class="chev">›</span></button>
        <button class="item" data-action="fullscreen" type="button"><span class="ic">⛶</span><span id="fsLabel">Fullscreen</span></button>

        ${this.isSimulator ? `
        <div class="section">SIMULATOR</div>
        <select id="scenarioSelect">
          ${SCENARIOS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}
        </select>` : ''}
      </nav>
      <input type="file" id="importFile" accept="application/json,.json" />

      <channel-picker></channel-picker>
      <gauge-settings></gauge-settings>
      <theme-settings></theme-settings>
      <update-panel></update-panel>
      <sensor-settings></sensor-settings>
      <device-settings></device-settings>
      <release-browser></release-browser>
    `;

    this.grid           = root.querySelector('.grid') as HTMLDivElement;
    root.querySelector('.title')!.textContent = this.layout.name;
    root.addEventListener('configure-sensor', event => (root.querySelector('sensor-settings') as SensorSettings).open((event as CustomEvent).detail.channel));
    root.addEventListener('browse-releases', () => (root.querySelector('release-browser') as ReleaseBrowser).open());
    this.picker         = root.querySelector('channel-picker') as ChannelPicker;
    this.gaugeSettings  = root.querySelector('gauge-settings') as GaugeSettings;
    this.themeSettings  = root.querySelector('theme-settings') as ThemeSettings;
    this.updatePanel    = root.querySelector('update-panel') as UpdatePanel;
    this.connIndicator  = root.querySelector('#connIndicator') as HTMLSpanElement;
    this.topbar         = root.querySelector('.topbar') as HTMLDivElement;
    const gridWrap      = root.querySelector('#gridWrap') as HTMLDivElement;

    // Keep --topbar-h in sync with the bar's real height
    const updateTopbarHeight = () => {
      const h = this.topbar.getBoundingClientRect().height;
      if (h > 0) gridWrap.style.setProperty('--topbar-h', `${h}px`);
    };
    const tbRo = new ResizeObserver(updateTopbarHeight);
    tbRo.observe(this.topbar);

    // Auto-hide status bar after 3s idle. The menu button stays on screen,
    // and the bar never hides while the menu is open.
    const hideTopbar = () => {
      if (window.matchMedia('(max-width:600px), (max-height:500px) and (max-width:1024px), (pointer:coarse)').matches || isNative()) return;
      if (this.classList.contains('menu-open') || this.store.connectionStatus !== 'connected') return;
      this.topbar.classList.add('hidden');
      gridWrap.classList.remove('bar-visible');
    };
    const showTopbar = () => {
      this.topbar.classList.remove('hidden');
      gridWrap.classList.add('bar-visible');
      if (this.hideTimer !== null) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(hideTopbar, 3000);
    };
    this.topbar.addEventListener('pointerdown', showTopbar);
    showTopbar();

    // Menu open/close
    const drawer = root.querySelector('.drawer') as HTMLElement;
    const menuButton = root.querySelector('#menuBtn') as HTMLButtonElement;
    const openMenu = () => {
      drawer.inert = false;
      menuButton.setAttribute('aria-expanded', 'true');
      this.classList.add('menu-open'); showTopbar();
      (root.querySelector('#drawerClose') as HTMLButtonElement).focus();
    };
    const closeMenu = () => {
      drawer.inert = true;
      menuButton.setAttribute('aria-expanded', 'false');
      this.classList.remove('menu-open'); showTopbar();
      menuButton.focus();
    };
    root.querySelector('#menuBtn')!.addEventListener('click', () => {
      if (this.classList.contains('menu-open')) closeMenu(); else openMenu();
    });
    root.querySelector('#drawerClose')!.addEventListener('click', closeMenu);
    root.querySelector('#drawerBackdrop')!.addEventListener('click', closeMenu);
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
    this.onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('keydown', this.onKeyDown);

    if (this.isSimulator) {
      const scenarioSelect = root.querySelector('#scenarioSelect') as HTMLSelectElement;
      scenarioSelect.addEventListener('change', () => {
        (this.provider as SimulatorProvider).setScenario(scenarioSelect.value as SimulatorScenario);
      });
    }

    // Fullscreen (status bar button + menu item)
    const fsBtn = root.querySelector('#fullscreenBtn') as HTMLButtonElement;
    const fsLabel = root.querySelector('#fsLabel') as HTMLSpanElement;
    const supportsFullscreen = !isNative() && !!document.fullscreenEnabled;
    fsBtn.hidden = !supportsFullscreen;
    (root.querySelector('[data-action="fullscreen"]') as HTMLButtonElement).hidden = !supportsFullscreen;
    const toggleFullscreen = () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
      }
    };
    if (this.onFullscreenChange) document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.onFullscreenChange = () => {
      const fs = !!document.fullscreenElement;
      fsBtn.textContent = fs ? '✕' : '⛶';
      fsBtn.title = fs ? 'Exit fullscreen' : 'Fullscreen';
      fsLabel.textContent = fs ? 'Exit fullscreen' : 'Fullscreen';
    };
    fsBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);

    // Menu actions
    const fileInput = root.querySelector('#importFile') as HTMLInputElement;
    const actions: Record<string, () => void> = {
      layout:     () => this.emit('edit-layout'),
      theme:      () => this.emit('edit-theme'),
      colors:     () => this.themeSettings.open(this.dashboardDesign, this.config.themeOverrides),
      maker:      () => this.emit('open-maker'),
      export:     () => this.emit('export-requested'),
      'export-layout': () => this.emit('export-layout', { layout:this.layout }),
      import:     () => fileInput.click(),
      update:     () => this.updatePanel.open(this.config),
      sensors: () => (root.querySelector('sensor-settings') as SensorSettings).open(),
      browse:     () => (root.querySelector('release-browser') as ReleaseBrowser).open(),
      connection: () => (root.querySelector('device-settings') as DeviceSettings).open(),
      fullscreen: toggleFullscreen,
    };
    root.querySelectorAll<HTMLButtonElement>('.item[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeMenu();
        actions[btn.dataset.action!]?.();
      });
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      this.emit('import-requested', { text });
      fileInput.value = '';
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
      this.gaugeSettings.open(
        slotId, def, slotConfig!.overrides,
        this.deps.designs.list().map((d) => ({ id: d.id, name: d.name })),
        this.dashboardDesign.name,
      );
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
        connecting: 'CONNECTING', connected: this.isSimulator ? 'SIM' : 'LIVE', stale: 'STALE', disconnected: 'OFFLINE',
      };
      this.connIndicator.textContent = labels[status] ?? status.toUpperCase();
      this.connIndicator.className = `conn ${status}`;
      if(status !== 'connected') showTopbar();
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
    for (const slotGeom of geometry.slots) {
      let el = this.slotEls.get(slotGeom.slotId);
      if (!el) {
        el = document.createElement('dashboard-slot') as DashboardSlot;
        this.slotEls.set(slotGeom.slotId, el);
        this.grid.appendChild(el);
        const slotConfig = this.config.slots.find((s) => s.slotId === slotGeom.slotId);
        const gaugeDef = this.deps.gauges.find((g) => g.id === slotConfig?.channelId) ?? null;
        el.setContent(gaugeDef, this.designFor(slotConfig), this.store, slotConfig?.overrides ?? {});
      }
      el.setGeometry(slotGeom);
    }
  }

  private renderAllContent() {
    for (const slotConfig of this.config.slots) {
      const el = this.slotEls.get(slotConfig.slotId);
      if (!el) continue;
      const gaugeDef = this.deps.gauges.find((g) => g.id === slotConfig.channelId) ?? null;
      el.setContent(gaugeDef, this.designFor(slotConfig), this.store, slotConfig.overrides);
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
