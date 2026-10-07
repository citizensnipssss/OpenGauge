import './components/layout-picker/layout-picker';
import './components/theme-picker/theme-picker';
import './components/dashboard-view/dashboard-view';
import type { LayoutPicker } from './components/layout-picker/layout-picker';
import type { ThemePicker } from './components/theme-picker/theme-picker';
import type { DashboardView } from './components/dashboard-view/dashboard-view';
import { loadGaugeRegistry, loadTheme } from './registry/gauges';
import { loadLayoutRegistry } from './registry/layouts';
import { DashboardConfigStore } from './store/dashboardConfig';
import type { DashboardConfig } from './registry/types';

const shellStyle = document.createElement('style');
shellStyle.textContent = `
  *, *::before, *::after { box-sizing:border-box; }
  html, body { margin:0; padding:0; background:#0b0e12; width:100dvw; height:100dvh; overflow:hidden; }
  #app { width:100dvw; height:100dvh; }
  .screen {
    width:100dvw; height:100dvh; overflow-y:auto; box-sizing:border-box; display:flex; flex-direction:column;
    gap:16px;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
             max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  }
  .screen h1 { color:#eee; font-family:Arial, sans-serif; font-size:clamp(20px, 4vw, 28px); margin:0; }
`;
document.head.appendChild(shellStyle);

const app = document.getElementById('app')!;

function mountScreen(el: HTMLElement) {
  app.innerHTML = '';
  app.appendChild(el);
}

async function main() {
  const [gauges, theme, layoutRegistry] = await Promise.all([
    loadGaugeRegistry(),
    loadTheme(),
    loadLayoutRegistry(),
  ]);
  const store = new DashboardConfigStore({ gauges, layouts: layoutRegistry });
  const deps = { gauges, theme, layoutRegistry };

  function showLayoutPicker() {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    const h1 = document.createElement('h1');
    h1.textContent = 'Choose a layout';
    wrap.appendChild(h1);
    const picker = document.createElement('layout-picker') as LayoutPicker;
    wrap.appendChild(picker);
    mountScreen(wrap);
    picker.configure(layoutRegistry.layouts);
    picker.addEventListener('layout-selected', (e) => {
      const { layoutId } = (e as CustomEvent).detail;
      showThemePicker(layoutId);
    });
  }

  function showThemePicker(layoutId: string) {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    const h1 = document.createElement('h1');
    h1.textContent = 'Choose a theme';
    wrap.appendChild(h1);
    const picker = document.createElement('theme-picker') as ThemePicker;
    wrap.appendChild(picker);
    mountScreen(wrap);
    picker.configure([theme]);
    picker.addEventListener('theme-selected', (e) => {
      const { themeId } = (e as CustomEvent).detail;
      const config = store.startNew(layoutId, themeId);
      showDashboard(config);
    });
  }

  function showDashboard(config: DashboardConfig) {
    const view = document.createElement('dashboard-view') as DashboardView;
    mountScreen(view);
    view.configure(deps, config);

    view.addEventListener('channel-assigned', (e) => {
      const { slotId, channelId } = (e as CustomEvent).detail;
      const next = store.assignChannel(slotId, channelId);
      view.updateConfig(next);
    });
    view.addEventListener('edit-layout', () => showLayoutPicker());
    view.addEventListener('edit-theme', () => showThemePicker(config.layoutId));
    view.addEventListener('export-requested', () => {
      const json = store.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cummins-gauge-dashboard-config.json';
      a.click();
      URL.revokeObjectURL(url);
    });
    view.addEventListener('import-requested', (e) => {
      const { text } = (e as CustomEvent).detail;
      const imported = store.importJson(text);
      if (imported) {
        showDashboard(imported);
      } else {
        window.alert('That file is not a valid dashboard configuration.');
      }
    });
    view.addEventListener('slot-overrides-changed', (e) => {
      const { slotId, overrides } = (e as CustomEvent).detail;
      const next = store.updateSlotOverrides(slotId, overrides);
      view.updateConfig(next);
    });
    view.addEventListener('theme-overrides-changed', (e) => {
      const { overrides } = (e as CustomEvent).detail;
      const next = store.updateThemeOverrides(overrides);
      view.updateConfig(next);
    });
  }

  const existing = store.load();
  if (existing) {
    showDashboard(existing);
  } else {
    showLayoutPicker();
  }
}

main();
