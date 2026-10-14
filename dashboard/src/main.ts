import { exportJson } from './platform/export';
import { storedLayouts } from './community/layouts';
import './components/layout-picker/layout-picker';
import './components/theme-picker/theme-picker';
import './components/dashboard-view/dashboard-view';
import './components/theme-maker/theme-maker';
import type { LayoutPicker } from './components/layout-picker/layout-picker';
import type { ThemePicker } from './components/theme-picker/theme-picker';
import type { DashboardView } from './components/dashboard-view/dashboard-view';
import type { ThemeMaker } from './components/theme-maker/theme-maker';
import { loadGaugeRegistry } from './registry/gauges';
import { DesignRegistry } from './design/registry';
import { loadLayoutRegistry } from './registry/layouts';
import { DashboardConfigStore } from './store/dashboardConfig';
import type { DashboardConfig } from './registry/types';
import {PROJECT_FORMAT, parseProject, validateDashboard, mergeDashboard} from './project/portable.ts';
import {readBrowserRecord, writeBrowserRecord, BROWSER_RECORD_KEY} from './project/browser-record.ts';

const shellStyle = document.createElement('style');
shellStyle.textContent = `
  *, *::before, *::after { box-sizing:border-box; }
  html, body { margin:0; padding:0; background:#0b0e12; width:100dvw; height:100dvh; overflow:hidden; font-family:-apple-system, BlinkMacSystemFont, Arial, sans-serif; -webkit-text-size-adjust:100%; }
  button, select { touch-action:manipulation; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid #ff9700; outline-offset:3px; }
  #app { width:100dvw; height:100dvh; }
  .screen {
    width:100dvw; height:100dvh; overflow-y:auto; box-sizing:border-box; display:flex; flex-direction:column;
    gap:16px;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
             max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  }
  .screen h1 { color:#eee; font-family:Arial, sans-serif; font-size:clamp(20px, 4vw, 28px); margin:0; }
  .screen-head { display:flex; align-items:center; gap:12px; }
  .back-btn {
    background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:10px;
    min-height:48px; padding:0 16px; font:600 16px Arial, sans-serif; cursor:pointer; flex-shrink:0;
  }
  .back-btn:hover, .back-btn:active { border-color:#ff9700; }
`;
document.head.appendChild(shellStyle);

const app = document.getElementById('app')!;

function mountScreen(el: HTMLElement) {
  app.innerHTML = '';
  app.appendChild(el);
}

async function main() {
  const [gauges, layoutRegistry] = await Promise.all([
    loadGaugeRegistry(),
    loadLayoutRegistry(),
  ]);
  const designs = new DesignRegistry();
  const store = new DashboardConfigStore({ gauges, layouts: layoutRegistry });
  const deps = { gauges, designs, layoutRegistry };

  /** Screen with a title and an optional Back button. */
  function makeScreen(title: string, onBack: (() => void) | null): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    const head = document.createElement('div');
    head.className = 'screen-head';
    if (onBack) {
      const back = document.createElement('button');
      back.className = 'back-btn';
      back.type = 'button';
      back.textContent = '‹ Back';
      back.addEventListener('click', onBack);
      head.appendChild(back);
    }
    const h1 = document.createElement('h1');
    h1.textContent = title;
    head.appendChild(h1);
    wrap.appendChild(head);
    return wrap;
  }

  /** Back to the dashboard if one exists — otherwise null (first-run setup). */
  function backToDashboard(): (() => void) | null {
    const current = store.current;
    return current ? () => showDashboard(current) : null;
  }

  function showLayoutPicker() {
    const current = store.current;
    const wrap = makeScreen('Choose a layout', backToDashboard());
    const picker = document.createElement('layout-picker') as LayoutPicker;
    wrap.appendChild(picker);
    mountScreen(wrap);
    picker.configure(layoutRegistry.layouts);
    picker.addEventListener('layout-selected', async (e) => {
      const { layoutId } = (e as CustomEvent).detail;
      // Existing dashboard: keep its theme and go straight back.
      if (current) {
        const preview = store.previewLayout(layoutId);
        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'background:#141c28;color:#edf3fb;border:1px solid #52627a;border-radius:14px;padding:24px;max-width:540px;width:calc(100% - 32px)';
        const title = document.createElement('h2');title.textContent='Review layout change';dialog.append(title);
        const name = (id:string|null) => gauges.find(g=>g.id===id)?.label ?? 'Empty';
        const list = document.createElement('ul');
        for(const s of preview.slots){const row=document.createElement('li');row.textContent=s.slotId+' → '+name(s.channelId);list.append(row);}
        dialog.append(list);
        if(preview.dropped.length){const warning=document.createElement('p');warning.textContent='These gauges will not fit: '+preview.dropped.map(s=>name(s.channelId)).join(', ')+'. Their slot settings will be removed.';dialog.append(warning);}
        const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.className='back-btn';
        const apply=document.createElement('button');apply.textContent='Apply layout';apply.className='back-btn';
        dialog.append(cancel,apply);document.body.append(dialog);
        const approved = await new Promise<boolean>(resolve=>{cancel.onclick=()=>dialog.close('cancel');apply.onclick=()=>dialog.close('apply');dialog.onclose=()=>resolve(dialog.returnValue==='apply');dialog.showModal();});
        dialog.remove();
        if(approved) showDashboard(store.startNew(layoutId, current.themeId));
      }
      else showThemePicker(layoutId);
    });
  }

  function showThemePicker(layoutId: string) {
    const onBack = store.current ? backToDashboard() : () => showLayoutPicker();
    const wrap = makeScreen('Choose a theme', onBack);
    const picker = document.createElement('theme-picker') as ThemePicker;
    wrap.appendChild(picker);
    mountScreen(wrap);
    picker.configure(designs.list(), store.current?.themeId);
    picker.addEventListener('theme-selected', (e) => {
      const { themeId } = (e as CustomEvent).detail;
      const config = store.startNew(layoutId, themeId);
      showDashboard(config);
    });
    picker.addEventListener('open-maker', (e) => {
      const { designId } = (e as CustomEvent).detail as { designId?: string };
      showThemeMaker(layoutId, designId);
    });
  }

  /** Theme Maker — Back returns to the theme list; "Use" applies the design. */
  function showThemeMaker(layoutId: string, designId?: string) {
    const maker = document.createElement('theme-maker') as ThemeMaker;
    mountScreen(maker);
    maker.open(designs, gauges, designId);
    maker.addEventListener('maker-close', () => showThemePicker(layoutId));
    maker.addEventListener('maker-use', (e) => {
      const { designId: id } = (e as CustomEvent).detail;
      showDashboard(store.startNew(layoutId, id));
    });
  }

  function showDashboard(config: DashboardConfig) {
    const view = document.createElement('dashboard-view') as DashboardView;
    mountScreen(view);
    view.configure(deps, config);
    view.addEventListener('layouts-updated', () => {
      layoutRegistry.layouts = [...layoutRegistry.layouts.filter(l=>!l.layoutId.startsWith('community-')), ...storedLayouts()];
    });
    view.addEventListener('export-layout', (event) => {
      const { layout } = (event as CustomEvent).detail;
      void exportJson(`${layout.layoutId}.layout.json`, JSON.stringify({schema:'opengauge-layout/1',layout},null,2));
    });

    view.addEventListener('channel-assigned', (e) => {
      const { slotId, channelId } = (e as CustomEvent).detail;
      const next = store.assignChannel(slotId, channelId);
      view.updateConfig(next);
    });
    view.addEventListener('edit-layout', () => showLayoutPicker());
    view.addEventListener('edit-theme', () => showThemePicker(store.current?.layoutId ?? config.layoutId));
    view.addEventListener('open-maker', () => showThemeMaker(store.current?.layoutId ?? config.layoutId, store.current?.themeId));
    view.addEventListener('export-requested', () => {
      try {
        const config = store.current!;
        const layout = layoutRegistry.layouts.find(l=>l.layoutId===config.layoutId);
        const ids = new Set([config.themeId,...config.slots.flatMap(s=>s.overrides.designId?[s.overrides.designId]:[])]);
        const resolved = [...ids].map(id=>{const d=designs.get(id);if(!d)throw new Error(`Missing gauge design: ${id}.`);return d;});
        const dashboard = validateDashboard({config,layout,designs:resolved});
        void exportJson('OpenGauge-dashboard.opengauge.json',JSON.stringify({format:PROJECT_FORMAT,schemaVersion:1,name:'My OpenGauge dashboard',notes:'',dashboard},null,2));
      } catch(error) { window.alert((error as Error).message); }
    });
    view.addEventListener('import-requested', (e) => {
      const { text } = (e as CustomEvent).detail;
      try {
        const raw = JSON.parse(text);
        if(raw?.format===PROJECT_FORMAT) {
          const project = parseProject(text);
          if(!project.dashboard)throw new Error('This file contains hardware only. Use the configurator to edit it.');
          const merge = mergeDashboard(project.dashboard,designs.list(),layoutRegistry.layouts);
          const question=`Import dashboard from "${project.name}"?\n${merge.section.config.slots.length} slots, ${merge.section.designs.length} designs.\nThis replaces your dashboard layout.\n${project.hardware?'Hardware settings are included in the file but will not be applied.\n':''}${merge.remapped.length?`Existing IDs will be preserved: ${merge.remapped.join(', ')}\n`:''}No settings will be sent to the device.`;
          if(!window.confirm(question))return;
          const old=readBrowserRecord();
          writeBrowserRecord({...old,config:merge.section.config,designs:[...old.designs,...merge.addedDesigns],layouts:[...old.layouts,...merge.addedLayouts]});
          layoutRegistry.layouts=[...layoutRegistry.layouts,...merge.addedLayouts];
          designs.reload();const imported=store.load();if(!imported)throw new Error('Imported dashboard could not be loaded.');
          showDashboard(imported);return;
        }
      } catch(error) { window.alert((error as Error).message);return; }
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

  window.addEventListener('storage',event=>{
    if(event.key!==BROWSER_RECORD_KEY)return;
    try {
      for(const layout of readBrowserRecord().layouts)if(!layoutRegistry.layouts.some(l=>l.layoutId===layout.layoutId))layoutRegistry.layouts.push(layout);
      designs.reload();const config=store.load();if(config)showDashboard(config);
    } catch(error) { window.alert((error as Error).message); }
  });

  const existing = store.load();
  if (existing) {
    showDashboard(existing);
  } else {
    showLayoutPicker();
  }
}

main().catch(error=>{app.textContent=`OpenGauge could not load saved settings: ${error.message}. Existing browser data was retained.`;});
