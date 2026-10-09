// engine/voxel/emissiveLight.test.js - EMIS-01a (architecture.md 38.12 (1)).
//   node engine/voxel/emissiveLight.test.js
import { deriveEmissiveLight, EMISSIVE_LIGHT_MIN } from './emissiveLight.js';
import { packVoxelModel } from './voxelPack.js';
import { validateVoxelModel } from './VoxelModel.js';
import { makeOk, approxEqual as approxEqualCore } from '../test/assert.js';
const approxEqual = (a, b, eps = 1e-6) => approxEqualCore(a, b, eps);

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const FLK = { hzMin: 8, hzMax: 12, amount: 0.15, jitter: 0.05 };
const MATS = {
  stone: { emissive: 0, rgb: [100, 100, 100] },
  dim: { emissive: 0.3, rgb: [255, 0, 0] },
  gold: { emissive: 1, rgb: [255, 200, 100], flicker: FLK },
  teal: { emissive: 0.5, rgb: [0, 200, 200] },
  flash: { emissive: 1, rgb: [255, 255, 255] },
};
const matInfo = (k) => MATS[k] || null;
const presetInfo = (n) => (n === 'torch' ? { hue: [1, 0.6, 0.2], intensity: 1, radius: 6, flicker: FLK } : null);

// a w x 1 x 1 model, one part, `row` chars on layer 0
function model(row, mats, extra) {
  const w = row.length;
  return Object.assign({
    version: 1, cellM: 0.1, size: [w, 1, 1], anchor: [0, 0, 0], mats,
    layers: [[row]], parts: { root: { box: [0, 0, 0, w, 1, 1], pivot: [0, 0, 0] } },
  }, extra || {});
}
const M = { s: 'stone', d: 'dim', g: 'gold', t: 'teal', f: 'flash' };

// no emissive voxels -> null; below threshold ignored
ok('no emissive -> null', deriveEmissiveLight(model('ssss', M), matInfo) === null);
ok('emissive < MIN ignored', deriveEmissiveLight(model('dddd', M), matInfo) === null && EMISSIVE_LIGHT_MIN === 0.5);

// centroid: one gold voxel at x=2 -> centre 2.5; weighted by emissive
{
  const l = deriveEmissiveLight(model('ssgs', M), matInfo);
  ok('single voxel centroid', approxEqual(l.x, 2.5) && approxEqual(l.y, 0.5) && approxEqual(l.z, 0.5));
  ok('single voxel count/n', l.count === 1 && l.n === 1);
  // intensity clamp low 0.15 (0.12*1 = 0.12), radius clamp low 2 (1.85)
  ok('intensity/radius lower clamps', approxEqual(l.intensity, 0.15) && approxEqual(l.radius, 2));
  ok('hue normalised to max 1', approxEqual(Math.max(...l.hue), 1) && approxEqual(l.hue[1], 200 / 255));
  ok('flicker from material', l.flicker === FLK);
}
{
  // gold (w1) at x=0 and teal (w0.5) at x=3: centroid = (0.5*1 + 3.5*0.5)/1.5
  const l = deriveEmissiveLight(model('gsst', M), matInfo);
  ok('emissive-weighted centroid', approxEqual(l.x, (0.5 * 1 + 3.5 * 0.5) / 1.5));
  // hue: weighted mean rgb (255+0, 200+... ) normalised
  const r = 255 * 1 + 0 * 0.5, g = 200 * 1 + 200 * 0.5, b = 100 * 1 + 200 * 0.5, m = Math.max(r, g, b);
  ok('emissive-weighted hue', approxEqual(l.hue[0], r / m) && approxEqual(l.hue[1], g / m) && approxEqual(l.hue[2], b / m));
}
// formulas from 38.12: 6-voxel glint ~0.3 / 2.4 m ; 40-voxel lamp ~0.75 / 3.7 m ; caps
{
  const g6 = deriveEmissiveLight(model('gggggg', M), matInfo);
  ok('6-voxel glint ~0.29 / ~2.36', approxEqual(g6.intensity, 0.12 * Math.sqrt(6)) && approxEqual(g6.radius, 1.5 + 0.35 * Math.sqrt(6)));
  const g40 = deriveEmissiveLight(model('g'.repeat(40), M), matInfo);
  ok('40-voxel lamp ~0.76 / ~3.7', approxEqual(g40.intensity, 0.12 * Math.sqrt(40)) && approxEqual(g40.radius, 1.5 + 0.35 * Math.sqrt(40)));
  const big = deriveEmissiveLight(model('g'.repeat(200), M), matInfo);
  ok('caps 0.9 / 6', approxEqual(big.intensity, 0.9) && approxEqual(big.radius, 6));
}
// voxels outside any part box are not drawn -> not counted
{
  const def = model('gggg', M);
  def.parts.root.box = [0, 0, 0, 2, 1, 1];
  ok('voxels outside part boxes ignored', deriveEmissiveLight(def, matInfo).count === 2);
}
// overrides: false / preset (def.light and 4th arg), unknown preset falls back to derived
{
  const d = model('gggg', M, { light: false });
  ok('def.light=false disables', deriveEmissiveLight(d, matInfo) === null);
  ok('override=false disables', deriveEmissiveLight(model('gggg', M), matInfo, presetInfo, false) === null);
  const p = deriveEmissiveLight(model('gggg', M), matInfo, presetInfo, { preset: 'torch' });
  ok('preset override: hue/intensity/radius from preset, centroid derived',
    p.intensity === 1 && p.radius === 6 && p.hue[1] === 0.6 && approxEqual(p.x, 2));
  const pd = deriveEmissiveLight(model('gggg', M, { light: { preset: 'torch' } }), matInfo, presetInfo);
  ok('def.light preset works', pd.radius === 6);
  const unk = deriveEmissiveLight(model('gggg', M), matInfo, presetInfo, { preset: 'nope' });
  ok('unknown preset -> derived values', approxEqual(unk.intensity, 0.24));
  ok('explicit override beats def.light', deriveEmissiveLight(model('gggg', M, { light: false }), matInfo, presetInfo, { preset: 'torch' }).radius === 6);
}
// matInfo can exclude a material (transient flash paint)
{
  const mi = (k) => (k === 'flash' ? { ...MATS.flash, light: false } : MATS[k]);
  ok('matInfo light:false excluded', deriveEmissiveLight(model('ffff', M), mi) === null);
}
// flicker: most emissive-weight wins
{
  const A = { emissive: 1, rgb: [1, 1, 1], flicker: { id: 'A' } }, B = { emissive: 1, rgb: [1, 1, 1], flicker: { id: 'B' } };
  const mi = (k) => (k === 'a' ? A : k === 'b' ? B : null);
  const l = deriveEmissiveLight(model('abb', { a: 'a', b: 'b' }), mi);
  ok('dominant flicker wins', l.flicker.id === 'B');
}
// pack integration: pm.emissiveLight, null without lightInfo, validator accepts/rejects `light`
{
  const def = model('ssgg', M);
  const pm = packVoxelModel(def, () => 1, { matInfo, presetInfo });
  ok('pack stores emissiveLight', pm.emissiveLight && pm.emissiveLight.count === 2 && approxEqual(pm.emissiveLight.x, 3));
  ok('pack without lightInfo -> null', packVoxelModel(def, () => 1).emissiveLight === null);
  ok('pack honours lightInfo.override=false', packVoxelModel(def, () => 1, { matInfo, override: false }).emissiveLight === null);
  ok('validator: light=false ok', validateVoxelModel(model('ss', M, { light: false })).errors.length === 0);
  ok('validator: light {preset} ok', validateVoxelModel(model('ss', M, { light: { preset: 'torch' } })).errors.length === 0);
  ok('validator: bad light rejected', validateVoxelModel(model('ss', M, { light: true })).errors.some((e) => e.includes('voxel.light')));
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) { for (const f of failures) console.log(' - ' + f); process.exit(1); } else console.log('ALL PASS');
