// engine/world/decorPaint.test.js (ED-FOLIAGE-03, arch 38.69): neutral grassMask, decor paint multiplier in scatterDetail + mask bake, rebuildDecor.
// Run: node engine/world/decorPaint.test.js
import { World } from './World.js';
import { Terrain } from './Terrain.js';
import { makeOk } from '../test/assert.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod;
farTowerMod; ferrumLightsMod;

import { createGrassMask, setSample, paintAt, grassMaskToJSON, grassMaskFromJSON, sampleAt } from './grassMask.js';
import { DetailScatterJob, decorRootCm } from './scatter.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const { assets } = await loadTestAssets();
const def = (() => { const d = { ...assets.world('world_m1') }; delete d.terrainGrid;
  d.terrainBands = [{ id: 'east', ch: 3, cw: 5, cx0: 8, cy0: 7 }]; return d; })();
const w = World.load(def, assets, { detail: true, physics: 'mesh' });
// world_m1 has no biome table: a stub biome (id 0) names the three gpu layers at full density
const fakeBio = { detail: { 0: { reeds: 1, wildflowers: 1, pebbles: 1 } }, biomeAt: () => 0 };
const ctx = w._detailCtx;
const run = (decorGpu, decorPaint) => {
  const j = new DetailScatterJob(w.terrain, w.structures, ctx.keepOut, ctx.cfg, null, { decorGpu, decorPaint: decorPaint || null });
  j.bio = fakeBio; j.step(Infinity); return { r: j.result, decor: j.decor };
};
const eq = (a, b) => a.byteLength === b.byteLength && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const sameDetail = (a, b) => a.count === b.count && ['x', 'y', 'z', 'yawDeg', 'species', 'r2'].every((f) => eq(a[f], b[f]));
const sameMask = (a, b) => a.layers.length === b.layers.length && a.layers.every((m, i) => m.name === b.layers[i].name && eq(m.mask, b.layers[i].mask));
const names = ['reeds', 'wildflowers', 'pebbles'];
const uniform = (v) => { const o = {}; for (const n of names) { o[n] = createGrassMask(0.5, 64, v); } return o; };

// neutral unit tests
{
  const g = createGrassMask(0.5, 64, 128);
  ok('neutral: absent reads 128, paintAt 1', sampleAt(g, 5, 5) === 128 && paintAt(g, 3.3, 1.2) === 1);
  setSample(g, 0, 0, 255);
  ok('neutral: new chunk fills with neutral', sampleAt(g, 1, 0) === 128 && sampleAt(g, 0, 0) === 255);
  const g0 = createGrassMask();
  ok('neutral 0 default unchanged', g0.neutral === 0 && sampleAt(g0, 3, 3) === 0 && paintAt(g0, 1, 1) === 0);
  ok('paintAt(null) = 1', paintAt(null, 0, 0) === 1);
  const j = grassMaskToJSON(g, 'd'); const back = grassMaskFromJSON(j);
  ok('neutral JSON round trip', j.neutral === 128 && back.neutral === 128 && sampleAt(back, 0, 0) === 255 && sampleAt(back, 9, 9) === 128);
  const g2 = createGrassMask(0.5, 64, 128); setSample(g2, 2, 2, 128);
  ok('all-neutral chunk dropped in JSON', Object.keys(grassMaskToJSON(g2).chunks).length === 0);
  ok('neutral 0 JSON has no neutral key', !('neutral' in grassMaskToJSON(createGrassMask())));
  ok('bad neutral throws', (() => { try { createGrassMask(0.5, 64, 300); return false; } catch (e) { return true; } })());
}

for (const gpu of [false, true]) {
  const tag = gpu ? 'mask' : 'cpu';
  const base = run(gpu, null);
  const neu = run(gpu, uniform(128));
  ok(`${tag}: neutral paint == no paint (bytes)`, sameDetail(base.r, neu.r) && (!gpu || sameMask(base.decor, neu.decor)));
  const zero = run(gpu, uniform(0)), two = run(gpu, uniform(255)), hlf = run(gpu, uniform(64));
  if (!gpu) {
    const layerCount = (d, nm) => { const li = ctx.cfg.layers.findIndex((l) => l.name === nm); let n = 0; for (let i = 0; i < d.count; i++) if (d.speciesDefs[d.species[i]].layer === li) n++; return n; };
    for (const nm of names) {
      const b = layerCount(base.r, nm), z = layerCount(zero.r, nm), t = layerCount(two.r, nm);
      ok(`cpu ${nm}: paint 0 = none, 255 more (${b}/${z}/${t})`, z === 0 && t >= b, `${b}/${z}/${t}`);
    }
  } else {
    let nb = 0, nz = 0, nt = 0, bad = 0;
    for (let k = 0; k < base.decor.layers.length; k++) {
      const a = base.decor.layers[k].mask, z = zero.decor.layers[k].mask, t = two.decor.layers[k].mask, h = hlf.decor.layers[k].mask;
      for (let i = 0; i < a.length; i++) {
        const pa = a[i] & 127, pt = t[i] & 127;
        nb += pa; nz += z[i] & 127; nt += pt;
        if ((a[i] & 128) !== (t[i] & 128)) bad++; // carpet bit untouched
        if (pa && pt < pa) bad++;
        if (pa && pa < 60 && Math.abs(pt - Math.round(pa * 255 / 128)) > 1) bad++; // below the clamp: x ~2
        if (pa && Math.abs((h[i] & 127) - Math.round(pa * 0.5)) > 1) bad++; // paint 64 = x0.5
      }
    }
    ok(`mask: paint 0 = none, 255 >= base (prob clamps at 127), per cell (${nb}/${nz}/${nt})`, nb > 0 && nz === 0 && nt >= nb && bad === 0, `bad ${bad}`);
  }
}

const NR = w.terrain.near, CX = NR.x0 + NR.w * NR.cell / 2;
// painted half-plane: the unpainted side is byte-identical, the painted side is empty
{
  const half = {};
  for (const n of names) { const l = createGrassMask(0.5, 64, 128); for (let j = Math.floor(NR.y0 / 0.5); j <= Math.ceil((NR.y0 + NR.h * NR.cell) / 0.5); j++) for (let i = Math.floor(CX / 0.5); i <= Math.ceil((NR.x0 + NR.w * NR.cell) / 0.5); i++) setSample(l, i, j, 0); half[n] = l; }
  const base = run(true, null), p = run(true, half);
  let diffNeg = 0, nonzeroPos = 0, seenNeg = 0;
  for (let k = 0; k < base.decor.layers.length; k++) {
    const a = base.decor.layers[k], b = p.decor.layers[k], l = ctx.cfg.layers.find((q) => q.name === a.name);
    const cellCm = Math.round(l.cellM * 100), jitCm = Math.round(l.jitter * 100);
    for (let iy = a.iy0; iy < a.iy0 + a.h; iy++) for (let ix = a.ix0; ix < a.ix0 + a.w; ix++) {
      const r = decorRootCm(ix, iy, l.seed, cellCm, jitCm), x = r[0] / 100, o = (iy - a.iy0) * a.w + ix - a.ix0;
      if (x < CX - 1) { seenNeg++; if (a.mask[o] !== b.mask[o]) diffNeg++; } else if (x > CX + 1.5 && (b.mask[o] & 127) !== 0) nonzeroPos++;
    }
  }
  ok(`mask paint affects only the painted side (${seenNeg} cells)`, diffNeg === 0 && nonzeroPos === 0, `${diffNeg}/${nonzeroPos}`);
}

// rebuildDecor touches only rect cells
{
  w.decorGpu = true; w.decorPaint = null;
  const stepOrig = DetailScatterJob.prototype.step; // the stub biome (world_m1 has none) so the gpu layers bake non-empty masks
  DetailScatterJob.prototype.step = function (ms) { this.bio = fakeBio; return stepOrig.call(this, ms); };
  w.rebuildDecor({ x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }); // masks exist with decorGpu on
  const lay0 = w.decor.layers;
  const before = lay0.map((m) => Uint8Array.from(m.mask)), v0 = w.decor.version | 0, rv = w.renderVersion;
  const nr = w.terrain.near;
  const cx = nr.x0 + nr.w * nr.cell / 2, cy = nr.y0 + nr.h * nr.cell / 2;
  w.decorPaint = uniform(0);
  const r = w.rebuildDecor({ x0: cx - 8, y0: cy - 8, x1: cx + 8, y1: cy + 8 });
  let changedIn = 0, changedOut = 0;
  for (let k = 0; k < before.length; k++) {
    const m = w.decor.layers[k], l = ctx.cfg.layers.find((q) => q.name === m.name), cm = Math.round(l.cellM * 100), jc = Math.round(l.jitter * 100);
    for (let i = 0; i < m.mask.length; i++) if (m.mask[i] !== before[k][i]) {
      const ix = m.ix0 + (i % m.w), iy = m.iy0 + Math.floor(i / m.w), rc = decorRootCm(ix, iy, l.seed, cm, jc);
      if (Math.abs(rc[0] / 100 - cx) <= 8 + 1e-9 && Math.abs(rc[1] / 100 - cy) <= 8 + 1e-9) changedIn++; else changedOut++;
    }
  }
  ok(`rebuildDecor: changes only inside rect (in ${changedIn}, out ${changedOut}, cells ${r.cells})`, changedIn > 0 && changedOut === 0);
  ok('rebuildDecor bumps decor.version + renderVersion', (w.decor.version | 0) === v0 + 1 && w.renderVersion === rv + 1);
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.error(failures.join('\n')); process.exit(1); }
