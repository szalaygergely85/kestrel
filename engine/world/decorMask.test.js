// engine/world/decorMask.test.js (ENV-01b, arch 38.62): decor mask bake, validator, decorGpu on/off, overlap agreement, bundle MB table.
// Run: node engine/world/decorMask.test.js
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
import { BandBakeJob } from './bandBake.js';
import { BandCache, bundleBytes } from './bandCache.js';
import { validateDetailConfig, decorRootCm } from './scatter.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const { assets } = await loadTestAssets();
const def = (() => { const d = { ...assets.world('world_m1') }; delete d.terrainGrid;
  d.terrainBands = [{ id: 'east', ch: 3, cw: 5, cx0: 8, cy0: 7 }, { id: 'west', ch: 3, cw: 5, cx0: 6, cy0: 7 }, { id: 'south1', ch: 3, cw: 5, cx0: 8, cy0: 9 }, { id: 'south2', ch: 3, cw: 5, cx0: 8, cy0: 11 }, { id: 'south3', ch: 3, cw: 5, cx0: 8, cy0: 13 }]; return d; })();
const w = World.load(def, assets, { detail: true, physics: 'mesh' });
const zs = w.terrainBands;
// world_m1's hand-authored bands carry no biome table, so a stub biome (id 0) names the three gpu layers at full density
const fakeBio = { detail: { 0: { reeds: 1, wildflowers: 1, pebbles: 1 } }, biomeAt: () => 0 };
const bake = (z, dx = 0) => {
  const j = BandBakeJob.create(w, z.cx0 + dx, z.cy0, z.cw, z.ch, null);
  j.stepTerrain(Infinity); j.stepScatter(2); j.detail.bio = fakeBio; j.step(Infinity);
  return { j, b: j.bundle() };
};
const eq = (a, b) => a.byteLength === b.byteLength && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const cfg0 = w._detailCtx.cfg;
const gpuNames = cfg0.layers.filter((l) => l.gpu).map((l) => l.name);
ok('content flags reeds/wildflowers/pebbles gpu', gpuNames.join() === 'reeds,wildflowers,pebbles', gpuNames.join());
ok('reeds species are grassLike', Object.values(cfg0.layers.find((l) => l.name === 'reeds').ground).every((list) => list.every((s) => s.grassLike === true)));

// validator
const mkCfg = (sp) => ({ layers: [{ name: 'x', gpu: true, seed: 1, cellM: 3, drawM: 30, jitter: 1, fill: 1, maxSlope: 0.3, clearM: 0.5, ground: { grass: [sp] } }] });
const base = { mesh: 'm', weight: 1, sway: true };
const thr = (f) => { try { f(); return false; } catch (e) { return true; } };
ok('validator: gpu species ok', !thr(() => validateDetailConfig(mkCfg({ ...base, grassLike: true }), ['grass'])));
ok('validator: gpu + collider throws', thr(() => validateDetailConfig(mkCfg({ ...base, collider: { prism: { r: 1, h: 1 } } }), ['grass'])));
ok('validator: gpu + shadow throws', thr(() => validateDetailConfig(mkCfg({ ...base, shadow: true }), ['grass'])));
ok('validator: grassLike must be boolean', thr(() => validateDetailConfig(mkCfg({ ...base, grassLike: 1 }), ['grass'])));
ok('validator: non-gpu layer keeps collider', !thr(() => { const c = mkCfg({ ...base, collider: { prism: { r: 1, h: 1 } } }); c.layers[0].gpu = false; validateDetailConfig(c, ['grass']); }));

const rows = [];
const tot = { before: 0, after: 0, mask: 0 };
const dBytes = (d) => Object.values(d).reduce((n, v) => n + (ArrayBuffer.isView(v) ? v.byteLength : 0), 0);
for (let k = 0; k < zs.length; k++) {
  const z = zs[k];
  delete w.decorGpu;
  const off = bake(z);
  ok(`decorGpu off: no mask, bundle.decor null: ${z.id}`, off.b.decor === null && off.j.detail.decor === null);
  w.decorGpu = false;
  const off2 = bake(z);
  ok(`decorGpu false == default bytes: ${z.id}`, off2.b.decor === null && ['x', 'y', 'z', 'yawDeg', 'species', 'r2', 'tileStart'].every((f) => eq(off.b.detail[f], off2.b.detail[f])));
  w.decorGpu = true;
  const on = bake(z);
  w.decorGpu = false;
  const dOn = on.b.detail, dOff = off.b.detail;
  const gl = new Set(cfg0.layers.map((l, i) => (l.gpu ? i : -1)).filter((i) => i >= 0));
  const layerOf = (d, i) => d.speciesDefs[d.species[i]].layer;
  let absent = true, keep = 0;
  for (let i = 0; i < dOn.count; i++) if (gl.has(layerOf(dOn, i))) absent = false;
  for (let i = 0; i < dOff.count; i++) if (!gl.has(layerOf(dOff, i))) keep++;
  ok(`decorGpu on: gpu layers absent from detail, others kept: ${z.id}`, absent && dOn.count === keep && dOn.count < dOff.count, `${dOn.count}/${keep}/${dOff.count}`);
  const keyOf = (d, i) => `${d.x[i]},${d.y[i]},${d.z[i]},${d.yawDeg[i]},${d.species[i]}`;
  const sOff = []; for (let i = 0; i < dOff.count; i++) if (!gl.has(layerOf(dOff, i))) sOff.push(keyOf(dOff, i));
  const sOn = []; for (let i = 0; i < dOn.count; i++) sOn.push(keyOf(dOn, i));
  ok(`decorGpu on: non-gpu placements identical: ${z.id}`, sOff.sort().join('|') === sOn.sort().join('|'));
  rows.push({ z, off, on });
  const maskB = on.b.decor.layers.reduce((n, m) => n + m.mask.byteLength, 0);
  ok(`bundle.decor counted in bundleBytes: ${z.id}`, bundleBytes(on.b) - bundleBytes({ ...on.b, decor: null }) === maskB);
  const mb = (n) => (n / 1048576).toFixed(3);
  console.log(`${z.id.padEnd(7)} detail: ${dOff.count} pts ${mb(dBytes(dOff))} MB -> ${dOn.count} pts ${mb(dBytes(dOn))} MB | mask ${mb(maskB)} MB | bundle ${mb(bundleBytes(off.b))} -> ${mb(bundleBytes(on.b))} MB`);
  tot.before += bundleBytes(off.b); tot.after += bundleBytes(on.b); tot.mask += maskB;
}
console.log(`TOTAL bundle ${(tot.before / 1048576).toFixed(3)} -> ${(tot.after / 1048576).toFixed(3)} MB (mask ${(tot.mask / 1048576).toFixed(3)} MB)`);

// mask byte == the 37.4 rules at the twin root (independent re-evaluation; structures/exclusions only ever clear a byte)
{
  const { j, b } = rows[0].on; const T = j.view, g = T.near;
  let nz = 0, bad = 0, carpetBits = 0, cells = 0, cleared = 0;
  const nrm = { x: 0, y: 0, z: 1 };
  for (const m of b.decor.layers) {
    const l = cfg0.layers.find((c) => c.name === m.name), cellCm = Math.round(l.cellM * 100), jitCm = Math.round(l.jitter * 100);
    const bio = j.detail.bio;
    for (let iy = m.iy0; iy < m.iy0 + m.h; iy++) for (let ix = m.ix0; ix < m.ix0 + m.w; ix++) {
      const r = decorRootCm(ix, iy, l.seed, cellCm, jitCm), x = r[0] / 100, y = r[1] / 100;
      const byte = m.mask[(iy - m.iy0) * m.w + (ix - m.ix0)]; cells++;
      let fill = l.biomeOnly ? 0 : l.fill;
      if (bio) { const d = bio.detail[bio.biomeAt(x, y)]; if (d !== undefined && d[l.name] !== undefined) fill = Math.min(1, l.fill * d[l.name]); }
      const inRect = x >= g.x0 && y >= g.y0 && x < g.x0 + g.w * g.cell && y < g.y0 + g.h * g.cell;
      let rule = Math.round(fill * 127) > 0 && inRect;
      if (rule) {
        const t = T.groundTypeAt(x, y), list = l.ground[T.typeName(t)];
        rule = !!(list && list.length) && [[-1, -1], [-1, 1], [1, -1], [1, 1]].every(([a, c]) => T.groundTypeAt(x + a * l.clearM, y + c * l.clearM) === t);
        if (rule) { T.groundNormalAt(x, y, nrm); rule = Math.hypot(nrm.x, nrm.y) / nrm.z <= l.maxSlope; }
      }
      if (byte & 127) { nz++; if (!rule || (byte & 127) !== Math.round(fill * 127)) bad++; }
      else if (rule) cleared++;
      if (byte & 128) carpetBits++;
    }
  }
  ok('mask: every non-zero byte satisfies the 37.4 rules and prob == round(fill*mult*127)', nz > 0 && bad === 0, `nz ${nz} bad ${bad} of ${cells}`);
  ok('mask: carpet bit unset without a carpet', carpetBits === 0);
  console.log(`mask ${rows[0].z.id}: ${nz} set / ${cells} cells, ${cleared} cleared by structures/exclusions`);
}

// carpet bit: a synthetic carpet class map marks the roots inside it
{
  const z = zs[0], g0 = bake(z).b.near;
  w.decorGpu = true;
  w.carpet = { classMap: new Uint8Array(4 * 4).fill(1), x0: g0.x0, y0: g0.y0, w: 4, h: 4, cellM: 64 };
  const ms = bake(z).b.decor.layers.map((l) => l.mask);
  w.decorGpu = false; w.carpet = null;
  let c = 0, nz = 0; for (const m of ms) for (let i = 0; i < m.length; i++) { if (m[i] & 127) nz++; if (m[i] & 128) c++; }
  ok('carpet bit set for roots inside the class map only', c > 0 && c < nz, `carpet ${c} of ${nz}`);
}

// overlapping bands agree on every shared lattice cell whose root (and clearM probes) lie inside both rects
{
  w.decorGpu = true;
  const z = zs[0], A = bake(z, 0).b, B = bake(z, 1).b;
  w.decorGpu = false;
  let shared = 0, diff = 0;
  for (let i = 0; i < A.decor.layers.length; i++) {
    const a = A.decor.layers[i], b = B.decor.layers[i], l = cfg0.layers.find((c) => c.name === a.name);
    const cellCm = Math.round(l.cellM * 100), jitCm = Math.round(l.jitter * 100);
    const inR = (g, x, y) => x >= g.x0 && y >= g.y0 && x < g.x0 + g.w * g.cell && y < g.y0 + g.h * g.cell;
    for (let iy = Math.max(a.iy0, b.iy0); iy < Math.min(a.iy0 + a.h, b.iy0 + b.h); iy++)
      for (let ix = Math.max(a.ix0, b.ix0); ix < Math.min(a.ix0 + a.w, b.ix0 + b.w); ix++) {
        const r = decorRootCm(ix, iy, l.seed, cellCm, jitCm), x = r[0] / 100, y = r[1] / 100;
        if (![A, B].every((q) => inR(q.near, x - 2, y - 2) && inR(q.near, x + 2, y + 2))) continue;
        shared++;
        if (a.mask[(iy - a.iy0) * a.w + ix - a.ix0] !== b.mask[(iy - b.iy0) * b.w + ix - b.ix0]) diff++;
      }
  }
  ok('overlapping bands agree on shared cells', shared > 1000 && diff === 0, `shared ${shared} diff ${diff}`);
}

// cache counts the mask
{
  const c = new BandCache(1 << 30); const b = rows[0].on.b; b.key = 'k';
  c.put(b);
  ok('BandCache counts the mask', c.bytes === bundleBytes(b) && c.bytes > bundleBytes({ ...b, decor: null }));
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.error(failures.join('\n')); process.exit(1); }
