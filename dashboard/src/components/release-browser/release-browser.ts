import { githubList, REPO_URL, repoLink } from '../../community/github';
import { issueLayout, validateLayout, saveLayout, storedLayouts } from '../../community/layouts';
import type { LayoutDefinition } from '../../registry/types';

type Tab = 'releases' | 'community';
type Cache = { checked: number; items: Record<string,unknown>[] };
export class ReleaseBrowser extends HTMLElement {
  private tab: Tab = 'releases';
  private busy = false;
  constructor() {
    super(); this.attachShadow({mode:'open'});
    this.shadowRoot!.innerHTML = `
      <style>
        * { box-sizing:border-box; } :host { display:none; position:fixed; inset:0; z-index:70; background:#0b0e12; color:#eee; font:16px -apple-system,BlinkMacSystemFont,Arial,sans-serif; }
        .page { height:100%; max-width:760px; margin:auto; display:flex; flex-direction:column; padding:calc(env(safe-area-inset-top,0px) + 12px) max(16px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom,0px) + 12px) max(16px,env(safe-area-inset-left)); }
        header { display:flex; align-items:center; gap:12px; } h2 { margin:0; font-size:20px; } h3 { margin:0 0 8px; font-size:18px; }
        button,a { min-height:48px; border:1px solid #36404c; background:#181e26; border-radius:12px; color:#eee; padding:12px 16px; font:inherit; touch-action:manipulation; cursor:pointer; } a { display:inline-flex; align-items:center; text-decoration:none; margin:6px 6px 0 0; overflow-wrap:anywhere; }
        button:focus-visible,a:focus-visible { outline:2px solid #ff9700; outline-offset:2px; } button:disabled { opacity:.5; cursor:default; }
        nav { display:flex; gap:8px; margin:18px 0 10px; } nav button { flex:1; } nav button[aria-pressed=true] { background:#ff9700; color:#111; border-color:#ff9700; }
        .toolbar { display:flex; gap:8px; flex-wrap:wrap; } p { color:#b6c2ce; line-height:1.5; margin:10px 0; } #status { font-size:14px; min-height:22px; } #content { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding-bottom:12px; }
        article { padding:18px; margin:12px 0; background:#131920; border:1px solid #2a3542; border-radius:16px; } pre { white-space:pre-wrap; overflow-wrap:anywhere; font:14px Arial; line-height:1.5; color:#bac7d4; } .meta { font-size:14px; } .preview { display:grid; gap:4px; height:100px; width:100px; margin:12px 0; } .cell { background:#ff9700; border-radius:4px; }
      </style>
      <div class="page"><header><button id="back">‹ Back</button><h2>Releases &amp; community</h2></header>
        <nav aria-label="Browse"><button id="releases" aria-pressed="true">Releases</button><button id="community" aria-pressed="false">Layouts</button></nav>
        <div class="toolbar"><button id="check">Check releases</button><button id="import" hidden>Import layout JSON</button></div>
        <p id="status" role="status" aria-live="polite"></p><div id="content"></div><input id="file" type="file" accept=".json,application/json" hidden>
      </div>`;
    const root=this.shadowRoot!;
    root.querySelector('#back')!.addEventListener('click',()=>this.style.display='none');
    for (const tab of ['releases','community'] as Tab[]) root.querySelector(`#${tab}`)!.addEventListener('click',()=>{
      if (this.busy) return;
      this.tab=tab; this.render();
    });
    root.querySelector('#check')!.addEventListener('click',()=>void this.refresh());
    const input=root.querySelector('#file') as HTMLInputElement;
    root.querySelector('#import')!.addEventListener('click',()=>input.click());
    input.addEventListener('change',async()=>{
      const file=input.files?.[0]; input.value=''; if (!file) return;
      try {
        if (file.size>50000) throw new Error('Layout files must be smaller than 50 KB.');
        this.install(validateLayout(JSON.parse(await file.text())));
      } catch (error) { this.status((error as Error).message); }
    });
  }
  open() { this.style.display='block'; this.render(); }
  private status(message: string) { this.shadowRoot!.querySelector('#status')!.textContent=message; }
  private cache(): Cache | null {
    try {
      const raw=JSON.parse(localStorage.getItem(`opengauge/browse-${this.tab}`)??'null');
      if (raw && Number.isFinite(raw.checked) && Array.isArray(raw.items)) return {checked:raw.checked,items:raw.items.filter((i:unknown)=>i && typeof i==='object').slice(0,100)};
    } catch { /* Invalid cache. */ }
    return null;
  }
  private async refresh() {
    if (this.busy) return; this.busy=true;
    const root=this.shadowRoot!;
    for (const id of ['check','releases','community']) (root.querySelector(`#${id}`) as HTMLButtonElement).disabled=true;
    this.status('Checking GitHub…');
    try {
      const items=await githubList(this.tab==='releases' ? 'releases?per_page=20' : 'issues?labels=community-layout&state=all&per_page=100&sort=updated');
      localStorage.setItem(`opengauge/browse-${this.tab}`,JSON.stringify({checked:Date.now(),items}));
      this.render();
    } catch (error) { this.status(`${(error as Error).message} Use internet Wi-Fi or cellular, then try again. Previously saved results remain available.`); }
    finally { this.busy=false; for (const id of ['check','releases','community']) (root.querySelector(`#${id}`) as HTMLButtonElement).disabled=false; }
  }
  private link(parent: HTMLElement, label: string, url: unknown) {
    const safe=repoLink(url); if (!safe) return;
    const a=document.createElement('a'); a.textContent=label; a.href=safe; a.target='_blank'; a.rel='noopener noreferrer'; parent.appendChild(a);
  }
  private paragraph(parent:HTMLElement,text:string, className='') { const p=document.createElement('p'); p.textContent=text; p.className=className; parent.appendChild(p); }
  private render() {
    const root=this.shadowRoot!, content=root.querySelector('#content') as HTMLElement; content.replaceChildren();
    for (const tab of ['releases','community']) root.querySelector(`#${tab}`)!.setAttribute('aria-pressed',String(this.tab===tab));
    root.querySelector('#check')!.textContent=this.tab==='releases'?'Check releases':'Refresh community';
    (root.querySelector('#import') as HTMLButtonElement).hidden=this.tab!=='community';
    const cache=this.cache();
    this.status(cache?`Saved results · checked ${new Date(cache.checked).toLocaleString()}`:'Connect to the internet and tap Check or Refresh.');
    if (this.tab==='releases') {
      this.paragraph(content,'Check while online. Save update files to Files before joining OpenGauge Wi-Fi.');
      const help=document.createElement('details');
      const summary=document.createElement('summary'); summary.textContent='Which update do I need?'; help.appendChild(summary);
      this.paragraph(help,'iPhone app: TestFlight or App Store. ESP32 firmware and browser dashboard: Device → Update. Firmware needs the matching .bin and firmware .json. New firmware reports its version and board target; older firmware needs a separately verified first upgrade.');
      content.appendChild(help);
      this.link(content,'All releases',`${REPO_URL}/releases`);
      const releases=(cache?.items??[]).filter(r=>!r.draft);
      if (cache && !releases.length) this.paragraph(content,'No published releases found.');
      for (const release of releases) {
        const article=document.createElement('article');
        const h=document.createElement('h3'); h.textContent=String(release.name||release.tag_name||'Release').slice(0,120); article.appendChild(h);
        this.paragraph(article,`${String(release.tag_name??'')} ${release.prerelease?'· Pre-release':''}`, 'meta');
        const notes=document.createElement('pre'); notes.textContent=String(release.body??'No release notes.').slice(0,6000).replace(/^#{1,6}\s*/gm,'').replace(/\*\*|`/g,'').replace(/^- /gm,'• '); article.appendChild(notes);
        this.link(article,'Release details',release.html_url);
        if (Array.isArray(release.assets)) for (const raw of release.assets.slice(0,20)) {
          if (!raw || typeof raw!=='object') continue;
          const asset=raw as Record<string,unknown>;
          this.link(article,`Download ${String(asset.name??'file').slice(0,100)}`,asset.browser_download_url);
        }
        content.appendChild(article);
      }
    } else {
      this.paragraph(content,'Browse layouts shared through OpenGauge GitHub issues. Preview the arrangement, then save it to your phone. Saved layouts appear under Menu → Layout.');
      this.link(content,'Community on GitHub',`${REPO_URL}/issues?q=label%3Acommunity-layout`);
      this.link(content,'Share a layout',`${REPO_URL}/issues/new?template=community-layout.yml`);
      let count=0;
      for (const issue of cache?.items??[]) {
        if (issue.pull_request || typeof issue.body!=='string') continue;
        const layout=issueLayout(issue.body); if (!layout) continue; count++;
        const article=document.createElement('article'), h=document.createElement('h3'); h.textContent=layout.name; article.appendChild(h);
        this.paragraph(article,layout.rationale);
        const preview=document.createElement('div'); preview.className='preview'; preview.setAttribute('aria-label',`${layout.slotCount} gauge portrait preview`);
        preview.style.gridTemplateColumns=`repeat(${layout.portrait.columns},1fr)`; preview.style.gridTemplateRows=`repeat(${layout.portrait.rows},1fr)`;
        for (const slot of layout.portrait.slots) { const cell=document.createElement('span'); cell.className='cell'; cell.style.gridColumn=`${slot.x+1}/span ${slot.w}`; cell.style.gridRow=`${slot.y+1}/span ${slot.h}`; preview.appendChild(cell); }
        article.appendChild(preview); this.link(article,'View community post',issue.html_url);
        const button=document.createElement('button'); const saved=storedLayouts().some(l=>l.layoutId===layout.layoutId); button.textContent=saved?'Saved on this phone':'Save layout'; button.disabled=saved; button.addEventListener('click',()=>this.install(layout)); article.appendChild(button); content.appendChild(article);
      }
      if (!count) this.paragraph(content,cache?'No valid community layouts are listed yet. Import a shared JSON file, or be the first to share one.':'Tap Refresh community to browse shared layouts.');
      for (const layout of storedLayouts()) { const article=document.createElement('article'); this.paragraph(article,`${layout.name} · saved on this phone`); content.appendChild(article); }
    }
  }
  private install(layout: LayoutDefinition) {
    try { saveLayout(layout); this.render(); this.status('Layout saved. Tap Back, then Menu → Layout to choose it.'); this.dispatchEvent(new CustomEvent('layouts-updated',{bubbles:true,composed:true})); }
    catch(error) { this.status((error as Error).message); }
  }
}
customElements.define('release-browser',ReleaseBrowser);
