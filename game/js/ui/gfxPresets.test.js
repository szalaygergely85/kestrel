import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPresets, resolveQuality, knobsFor, saveQuality, dropStaleOverrides } from './gfxPresets.js';
const data = JSON.parse(readFileSync(new URL('../../../content/settings/gfx-presets.json', import.meta.url)));
await loadPresets(data);
assert.deepEqual(['low','medium','high','ultra'].map(n=>knobsFor(n).rays),[1,2,2,4]);
assert.equal(knobsFor('low').grid,'240x90');
assert.equal(knobsFor('low').shadowQuality,'low');
const resolve = opts => resolveQuality({...opts,warn:()=>{}});
assert.equal(resolve().name,'high');
assert.equal(resolve().source,'default');
assert.equal(resolve({auto:'medium'}).source,'auto');
assert.equal(resolve({saved:'low',auto:'ultra'}).name,'low');
assert.equal(resolve({param:'quality=medium',saved:'low',auto:'ultra'}).source,'param');
const overridden=resolve({param:'quality=low&rays=4&grid=480x180&shadowQuality=off',saved:'medium'});
assert.equal(overridden.name,'low');
assert.equal(overridden.knobs.rays,4);assert.equal(overridden.knobs.grid,'480x180');
assert.equal(overridden.knobSources.rays,'param');assert.equal(overridden.knobs.shadowQuality,'off');
assert.equal(resolve({saved:'auto',auto:'ultra'}).name,'ultra');
assert.equal(resolve({saved:'auto'}).name,'high');
assert.equal(resolve({saved:{quality:'low',shadowQuality:'high'}}).knobs.shadowQuality,'high');
let warnings=[];
assert.equal(resolveQuality({param:'quality=typo',saved:'low',warn:m=>warnings.push(m)}).name,'high');
assert.equal(warnings.length,1);
const invalid=resolve({param:'quality=low&rays=&grid=160x60&scatter=2&lodScale=NaN&shadowQuality=bad'});
assert.deepEqual(invalid.knobs,knobsFor('low'));
const copy=knobsFor('high');copy.rays=4;assert.equal(knobsFor('high').rays,2);
let blob={muted:true,grid:'320x120'};
const adapter={save:partial=>{blob={...blob,...partial};},load:()=>({...blob})};
assert.equal(saveQuality('auto',adapter).saved,true);assert.equal(blob.muted,true);assert.equal(blob.grid,'320x120');
assert.equal(saveQuality('low',{save:()=>{},load:()=>({})}).saved,false,'detect storage adapter dropping quality');
assert.equal(saveQuality('low',{save:()=>{throw Error('quota');},load:()=>({})}).saved,false);
assert.throws(()=>saveQuality('bad',adapter));
for(const key of ['grid','rays','shadowQuality','scatter','lodScale']) {
  const bad=structuredClone(data);bad.presets.low[key]=null;
  await assert.rejects(loadPresets(bad));
}
assert.equal(knobsFor('low').rays,1,'bad load does not replace previous table');
const response=await loadPresets(null,async()=>({ok:true,json:async()=>data}));assert.equal(response.ultra.rays,4);
await assert.rejects(loadPresets(null,async()=>({ok:false,status:404})),/404/);
console.log('gfxPresets: D-047 data, precedence, independent shadows, validation, immutable copies and adapter read-back PASS');

// QUALITY-STALE-01: preset pick clears overrides; migration drops unmarked ones once; marked ones survive
{
  let b={quality:'high',shadowQuality:'low',lodScale:0.6,gfxOverrides:true};
  const a={save:p=>{b={...b,...p};for(const k of Object.keys(b))if(b[k]===undefined)delete b[k];},load:()=>({...b})};
  saveQuality('low',a);assert.deepEqual(b,{quality:'low'});
  b={quality:'high',shadowQuality:'low',lodScale:0.6};
  const out=dropStaleOverrides({...b},a);assert.equal(out.shadowQuality,undefined);assert.equal(b.lodScale,undefined);
  b={quality:'high',shadowQuality:'low',gfxOverrides:true};
  assert.equal(dropStaleOverrides({...b},a).shadowQuality,'low');
}
