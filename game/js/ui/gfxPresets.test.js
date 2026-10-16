import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPresets, resolveQuality, knobsFor, saveQuality, dropStaleOverrides, carpetQualityFor, carpetBuildFor, applyCarpetPreset } from './gfxPresets.js';
const data = JSON.parse(readFileSync(new URL('../../../content/settings/gfx-presets.json', import.meta.url)));
await loadPresets(data);
assert.deepEqual(['low','medium','high','ultra'].map(n=>knobsFor(n).rays),[1,2,2,4]);
assert.deepEqual(['low','medium','high','ultra','extreme'].map(n=>knobsFor(n).raysFarM),[0,0,0,40,0]); // RTX-RAYS-BAND-01
assert.equal(resolveQuality({param:'quality=ultra&raysFarM=25'}).knobs.raysFarM,25);
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
for(const key of ['grid','rays','shadowQuality','scatter','lodScale','pointShadows']) {
  const bad=structuredClone(data);bad.presets.low[key]=null;
  await assert.rejects(loadPresets(bad));
}
assert.equal(knobsFor('low').rays,1,'bad load does not replace previous table');
const response=await loadPresets(null,async()=>({ok:true,json:async()=>data}));assert.equal(response.ultra.rays,4);
await assert.rejects(loadPresets(null,async()=>({ok:false,status:404})),/404/);
assert.deepEqual(['low','medium','high','ultra'].map(n=>knobsFor(n).pointShadows),[false,false,true,true],'AUD-44 point shadows on high/ultra only');
assert.equal(resolve({param:'quality=high&pointshadows=0'}).knobs.pointShadows,true,'URL pointshadows is not a preset knob');
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

// OB-103b (D-075 G1): carpet knob per preset, ?carpet override, live settings path
{
  const want = { low: [false, 0.5, 0.6], medium: [true, 0.6, 0.6], high: [true, 1, 1], ultra: [true, 1.4, 1.25], extreme: [true, 1.4, 1.5] };
  for (const [n, [on, r, d]] of Object.entries(want)) assert.deepEqual(carpetQualityFor(knobsFor(n)), { on, radiusScale: r, densScale: d }, 'carpet knob ' + n);
  assert.equal(carpetQualityFor(knobsFor('high'), '0').on, false, '?carpet=0 forces off');
  assert.deepEqual(carpetQualityFor(knobsFor('low'), '1'), { on: true, radiusScale: 0.5, densScale: 0.6 }, '?carpet=1 forces on with the preset knob');
  assert.equal(carpetQualityFor(knobsFor('ultra'), 'x').on, true, 'junk value = preset decides');
  assert.equal(carpetQualityFor(null).on, false, 'no preset (capture page) = off');
  assert.equal(carpetQualityFor(null, '1').on, true);
  assert.equal(carpetBuildFor(true), true); assert.equal(carpetBuildFor(false), false);
  assert.equal(carpetBuildFor(true, '0'), false); assert.equal(carpetBuildFor(false, '1'), true);
  // validation: a bad carpet knob is rejected
  const bad = JSON.parse(JSON.stringify(data)); bad.presets.low.carpet.radiusScale = 5;
  await assert.rejects(() => loadPresets(bad), /invalid low/);
  const bad2 = JSON.parse(JSON.stringify(data)); delete bad2.presets.high.carpet;
  await assert.rejects(() => loadPresets(bad2), /invalid high/);
  await loadPresets(data); // restore
  // settings change path: world.setCarpetQuality gets the new preset; URL force still wins
  const calls = [], world = { setCarpetQuality: (q) => calls.push(q) };
  assert.deepEqual(applyCarpetPreset('ultra', world, ''), { on: true, radiusScale: 1.4, densScale: 1.25 });
  applyCarpetPreset('low', world, ''); applyCarpetPreset('medium', world, '?carpet=0');
  assert.deepEqual(calls.map((q) => q.on), [true, false, false]);
  assert.equal(applyCarpetPreset('high', null, ''), null);
  const c = knobsFor('high').carpet; c.on = false; assert.equal(knobsFor('high').carpet.on, true, 'knobsFor returns a copy');
  // real World: low -> medium switches on live
  const { World } = await import('../../../engine/index.js');
  const w = new World(); applyCarpetPreset('low', w, ''); assert.equal(w.carpetQuality.on, false);
  applyCarpetPreset('medium', w, ''); assert.deepEqual([w.carpetQuality.on, w.carpetQuality.radiusScale, w.carpetQuality.densScale], [true, 0.6, 0.6]);
  assert.deepEqual(w.checkCarpetWindow(), { ok: true, need: 0, have: 0 }, 'no carpet = no window check');
  w.carpet = { cfg: { radiusM: 12, classCellM: 2, classJitterM: 0.8 }, w: 20, h: 20, cellM: 2 }; // half window 20 m
  const warns = []; const ow = console.warn; console.warn = (m) => warns.push(m);
  applyCarpetPreset('high', w, ''); applyCarpetPreset('ultra', w, ''); applyCarpetPreset('ultra', w, ''); console.warn = ow;
  assert.equal(warns.length, 1, 'window warning once for radiusScale 1.4 (need 27.8 m > 20 m)'); assert.equal(w.checkCarpetWindow().ok, false);
}
console.log('OB-103b carpet preset checks PASS');

// HIDE-EXTREME-01 (D-107): extreme is URL-only
{
  const { QUALITY_CHOICES, resolveQuality } = await import('./gfxPresets.js');
  const { findOption } = await import('../settings/options.js');
  const { TIERS } = await import('../gfxAuto.js');
  const assertM = (await import('node:assert')).default;
  assertM.deepEqual([...QUALITY_CHOICES], ['low', 'medium', 'high', 'ultra', 'auto']);
  assertM.ok(!findOption('quality').values.includes('extreme'), 'options menu lists no extreme');
  assertM.ok(!TIERS.includes('extreme'), 'auto-pick never chooses extreme');
  const w = () => {};
  assertM.equal(resolveQuality({ param: new URLSearchParams('quality=extreme'), warn: w }).name, 'extreme');
  assertM.equal(resolveQuality({ saved: 'extreme', warn: w }).name, 'ultra');
  assertM.equal(resolveQuality({ auto: 'extreme', warn: w }).name, 'ultra');
  console.log('HIDE-EXTREME-01: PASS');
}
