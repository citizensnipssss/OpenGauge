import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout, issueLayout, saveLayout, storedLayouts } from '../src/community/layouts.ts';
import { repoLink, githubList } from '../src/community/github.ts';
const geometry = {columns:2,rows:1,slots:[{slotId:'slot-1',x:0,y:0,w:1,h:1,sizeClass:'normal'},{slotId:'slot-2',x:1,y:0,w:1,h:1,sizeClass:'normal'}]};
const file=()=>({schema:'opengauge-layout/1',layout:{layoutId:'test-dual',name:'Test dual',rationale:'Stationary testing',slotCount:2,drivingRecommended:true,portrait:structuredClone(geometry),landscape:structuredClone(geometry)}});
test('community layout imports are normalized, persisted and never replace built-ins',()=>{
  const data=new Map(); Object.assign(globalThis,{localStorage:{getItem:(k:string)=>data.get(k),setItem:(k:string,v:string)=>data.set(k,v)}});
  const value=validateLayout(file());
  assert.equal(value.layoutId,'community-test-dual'); assert.equal(value.drivingRecommended,false);
  saveLayout(value); assert.equal(storedLayouts().length,1); assert.throws(()=>saveLayout(value));
  assert.equal(issueLayout('```json\n'+JSON.stringify(file())+'\n```')?.name,'Test dual');
  assert.equal(issueLayout('```json\n{"script":"bad"}\n```'),null);
});
test('reject overlapping, out-of-bounds, mismatched and oversized grids',()=>{
  const overlap=file(); overlap.layout.portrait.slots[1].x=0; assert.throws(()=>validateLayout(overlap));
  const bounds=file(); bounds.layout.portrait.slots[1].w=2; assert.throws(()=>validateLayout(bounds));
  const mismatch=file(); mismatch.layout.landscape.slots[1].slotId='slot-3'; assert.throws(()=>validateLayout(mismatch));
  const huge=file(); huge.layout.portrait.columns=100000; assert.throws(()=>validateLayout(huge));
});
test('release links are limited to the repository and failed GitHub checks report errors',async()=>{
  assert.equal(repoLink('javascript:alert(1)'),null);
  assert.equal(repoLink('https://github.com.evil.test/citizensnipssss/OpenGauge/releases'),null);
  assert.equal(repoLink('https://github.com/another/repo/releases'),null);
  assert.equal(repoLink('https://github.com/citizensnipssss/OpenGauge/releases/tag/v1.3'),'https://github.com/citizensnipssss/OpenGauge/releases/tag/v1.3');
  const original=globalThis.fetch;
  try { globalThis.fetch=async()=>new Response('{}',{status:403}); await assert.rejects(githubList('releases'),/request limit/); }
  finally { globalThis.fetch=original; }
});
