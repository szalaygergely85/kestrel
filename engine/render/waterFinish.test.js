// WATER-FINISH-01a (architecture.md 38.77): screen reflection + shallow caustics in the JS twin. Node ESM.
// Run: node --expose-gc engine/render/waterFinish.test.js
import { World } from '../world/World.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { makeLightBuffer } from './lighting.js';
import { waterCompositeJS } from './waterComposite.js';
import { resolveWaterLooks } from './waterLook.js';
import { causticHit, shearMirrorRow, reflAccept, packWaterFinish, WF_STRIDE, WATER_FINISH_WGSL } from './waterFinish.js';
import { createPitchedTerms, pitchedTermsInto, worldToCell, projectDirPitched, projTerms } from './projection.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeFb(world, cols, rows) {
  const matTable = bindShading(assets.palette, assets.detailPass, 1);
  if (world.structures[0]) bindLevel(matTable, world.structures[0].level);
  return { rt: new CellBuffer(cols, rows), depth: new DepthBuffer(cols, rows), palette: assets.palette, gbuf: new GBuffer(cols, rows), matTable,
    detailPass: null, lights: null, light: makeLightBuffer(cols, rows), timeSec: 0, loop: { stats: {} }, renderer: 'mesh' };
}
const def = { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [], water: [{ id: 'pool', shape: 'rect', rect: [2, 2, 9, 9], z: 0.4 }] };
const world = World.load(def, assets, {});
const COLS = 80, ROWS = 40;
const POSES = [
  { x: 5.5, y: 5.5, z: 1.6, yawDeg: 40, pitchDeg: -25, projection: 'shear' },
  { x: 1.2, y: 5.5, z: 1.3, yawDeg: 90, pitchDeg: -8, projection: 'shear' },
  { x: 1.2, y: 5.5, z: 1.3, yawDeg: 90, pitchDeg: -8, projection: 'pitched' },
];
function render(look, pose, t, cols = COLS, rows = ROWS) {
  const fb = makeFb(world, cols, rows);
  fb.waterLooks = resolveWaterLooks(look ? { water: look } : null);
  fb.timeSec = t;
  renderWorld(fb, world, pose); renderWorld(fb, world, pose);
  const c = fb.rt.cells || fb.rt;
  return { fb, glyph: c.glyphIdx.slice(), fg: c.fg.slice(), bg: c.bg.slice() };
}
const same = (a, b) => a.glyph.every((v, i) => v === b.glyph[i]) && a.fg.every((v, i) => v === b.fg[i]) && a.bg.every((v, i) => v === b.bg[i]);

// 1. keys at 0 -> byte-identical to the engine default on 3 poses
for (const [i, pose] of POSES.entries()) {
  const base = render(null, pose, 1.3), zero = render({ causticK: 0, reflScreenK: 0, causticDepth: 0.5, reflDim: 0.3 }, pose, 1.3);
  ok(`keys 0 -> byte-identical (pose ${i})`, same(base, zero));
}
{
  let throws = 0;
  for (const b of [{ causticK: 2 }, { causticDepth: 0 }, { causticRGB: [1, 2] }, { causticGlyph: 'ab' }, { reflScreenK: -1 }, { reflDim: 2 }]) { try { packWaterFinish('x', b); } catch (e) { if (String(e.message).includes('x')) throws++; } }
  const d = packWaterFinish('d', null);
  ok('finish keys: invalid values throw, naming the look; defaults are 0', throws === 6 && d.length === WF_STRIDE && d[0] === 0 && d[6] === 0);
}
// 2. reflection samples the mirrored row (shear)
{
  const pose = POSES[1], DIM = 0.7;
  const off = render(null, pose, 0), on = render({ reflScreenK: 1, reflDim: DIM }, pose, 0);
  const fb = on.fb, grid = { cols: COLS, rows: ROWS, pxCellW: fb.rt.pxCellW || 1, pxCellH: fb.rt.pxCellH || 1 };
  const terms = projTerms(pose, grid, {});
  const wt = fb.water, depth = fb.depth.depth;
  let changed = 0, wrong = 0, rejectedChanged = 0, acceptedUnchanged = 0, accepted = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    const col = i % COLS, row = (i / COLS) | 0;
    const rowM = shearMirrorRow(terms.horizonRow, row), mi = rowM * COLS + col, inside = rowM >= 0 && rowM < ROWS;
    const hit = wt.kind[i] === 1 && wt.depth[i] < depth[i] && fb.gbuf.kind[i] !== 0;
    const acc = hit && reflAccept(rowM, ROWS, inside ? wt.kind[mi] : 0, inside ? fb.gbuf.kind[mi] : 0, inside ? depth[mi] : 0, wt.depth[i]);
    const d = off.bg[i * 4] !== on.bg[i * 4] || off.bg[i * 4 + 1] !== on.bg[i * 4 + 1] || off.bg[i * 4 + 2] !== on.bg[i * 4 + 2] || off.fg[i * 4] !== on.fg[i * 4];
    if (d) { changed++; if (!acc) rejectedChanged++; }
    if (acc) {
      accepted++;
      if (!d) acceptedUnchanged++;
      // new bg lies between the old bg and the dimmed mirrored bg (fresnel share <= 1)
      const target = on.bg[mi * 4 + 1] * DIM, lo = Math.min(off.bg[i * 4 + 1], target) - 1.5, hi = Math.max(off.bg[i * 4 + 1], target) + 1.5;
      if (on.bg[i * 4 + 1] < lo || on.bg[i * 4 + 1] > hi) wrong++;
    }
  }
  ok(`reflection: accepted cells exist and change (${accepted} accepted, ${changed} changed)`, accepted > 20 && changed > 20);
  ok('reflection: only accepted cells change (reject keeps the sky reflection)', rejectedChanged === 0);
  ok('reflection: accepted cells blend toward the mirrored row', wrong === 0 && acceptedUnchanged <= accepted * 0.05);
  ok('shear mirror row: 2*horizon - row', shearMirrorRow(20, 25) === 15 && shearMirrorRow(20.5, 10) === 31);
  ok('accept: off screen / water / sky / too near all reject', !reflAccept(-1, 40, 0, 1, 99, 5) && !reflAccept(40, 40, 0, 1, 99, 5) && !reflAccept(3, 40, 1, 1, 99, 5) && !reflAccept(3, 40, 0, 0, Infinity, 5) && !reflAccept(3, 40, 0, 1, 5.9, 5) && reflAccept(3, 40, 0, 1, 6.1, 5));
}
// 3. pitched helper agrees with worldToCell for a far point along the direction
{
  const T = createPitchedTerms(); const o = [0, 0, 0], q = [0, 0, 0];
  pitchedTermsInto(T, POSES[2], { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 });
  let bad = 0, n = 0;
  for (const [dx, dy, dz] of [[T.fX + 0.2, T.fY, T.fZ + 0.1], [T.fX, T.fY + 0.2, T.fZ - 0.1], [T.fX - 0.2, T.fY, T.fZ], [T.fX, T.fY, T.fZ + 0.2]]) {
    const L = 1e6; worldToCell(T, T.eyeX + dx * L, T.eyeY + dy * L, T.eyeZ + dz * L, o);
    if (projectDirPitched(T, dx, dy, dz, q)) { n++; if (Math.abs(q[0] - Math.round(o[0])) > 1 || Math.abs(q[1] - Math.round(o[1])) > 1) bad++; }
  }
  ok('projectDirPitched == worldToCell at infinity (+-1 cell)', n >= 3 && bad === 0 && projectDirPitched(T, -T.fX, -T.fY, -T.fZ, q) === false);
  const R = render({ reflScreenK: 1 }, POSES[2], 0), R0 = render(null, POSES[2], 0);
  ok('reflection: pitched pose renders and changes cells', !same(R, R0));
}
// 4. caustics: only where the column is shallower than causticDepth, deterministic per t, bounded
{
  const pose = POSES[0], SEE = { opaqueAt: 40, seeThrough: 0.95 };
  const base = render(SEE, pose, 0.0);
  const on = render({ ...SEE, causticK: 0.5, causticGlyph: '^' }, pose, 0.0);
  const deep = render({ ...SEE, causticK: 0.5, causticDepth: 0.1 }, pose, 0.0); // pool column 0.4 m > 0.1
  const n = (a, b) => { let c = 0; for (let i = 0; i < a.glyph.length; i++) if (a.glyph[i] !== b.glyph[i] || a.fg[i * 4] !== b.fg[i * 4]) c++; return c; };
  const hits = n(base, on); let caus = 0, bright = 0;
  for (let i = 0; i < on.glyph.length; i++) { if (on.glyph[i] === 94 - 32) caus++; for (let c = 0; c < 3; c++) if (on.fg[i * 4 + c] > base.fg[i * 4 + c]) bright++; }
  ok(`caustics: hit cells exist (${hits}) with the glyph and brighten fg`, hits > 10 && caus > 5 && bright > 10);
  ok('caustics: column >= causticDepth -> no caustics', n(base, deep) === 0);
  const again = render({ ...SEE, causticK: 0.5, causticGlyph: '^' }, pose, 0.0), later = render({ ...SEE, causticK: 0.5, causticGlyph: '^' }, pose, 0.4);
  ok('caustics: deterministic per t, flickers with t', same(on, again) && !same(on, later));
  const full = render({ ...SEE, causticK: 1 }, pose, 0.0);
  ok('caustics: K bounds the hit share (K=0.5 < K=1), K=0 none', hits < n(base, full) && n(base, render({ ...SEE, causticK: 0 }, pose, 0)) === 0);
  ok('causticHit: pure + deterministic', causticHit(3.3, 4.4, 1.0, 0.5) === causticHit(3.3, 4.4, 1.0, 0.5) && !causticHit(3.3, 4.4, 1.0, 0));
}
ok('WGSL text: shearMirrorRow / reflAccept / causticHit / 0.7 m cell', ['fn shearMirrorRow', 'fn reflAccept', 'fn causticHit', '0.7'].every((s) => WATER_FINISH_WGSL.includes(s)));

// 5. micro-bench at 240x90 (reflection + caustics on vs off) + alloc
{
  const W = 240, H = 90, look = { opaqueAt: 3, seeThrough: 0.6, causticK: 0.4, reflScreenK: 0.7 };
  const pose = POSES[0];
  const fbOn = makeFb(world, W, H); fbOn.waterLooks = resolveWaterLooks({ water: look });
  const fbOff = makeFb(world, W, H); fbOff.waterLooks = resolveWaterLooks({ water: { ...look, causticK: 0, reflScreenK: 0 } });
  for (let i = 0; i < 6; i++) { renderWorld(fbOn, world, pose); renderWorld(fbOff, world, pose); }
  const time = (f) => { let best = 1e9; for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (let i = 0; i < 20; i++) { f.timeSec = i * 0.016; renderWorld(f, world, pose); } best = Math.min(best, (performance.now() - t0) / 20); } return best; };
  const on = time(fbOn), off = time(fbOff);
  console.log(`bench 240x90 whole frame (pool in view): finish on ${on.toFixed(2)} ms, off ${off.toFixed(2)} ms, delta ${(on - off).toFixed(3)} ms (budget 0.3)`);
  if (globalThis.gc) { // the composite alone (renderWorld itself allocates): 0 B/call after warm
    const terms = projTerms(POSES[1], { cols: W, rows: H, pxCellW: fbOn.rt.pxCellW || 1, pxCellH: fbOn.rt.pxCellH || 1 }, {});
    const pt = createPitchedTerms();
    const per = (f) => { f.timeSec = 0.5; for (let i = 0; i < 30; i++) { waterCompositeJS(f, world, terms, pt, false, false); waterCompositeJS(f, world, terms, pt, false, true); } gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 200; i++) { f.timeSec = i * 0.016; waterCompositeJS(f, world, terms, pt, false, false); waterCompositeJS(f, world, terms, pt, false, true); } return (process.memoryUsage().heapUsed - h0) / 200; };
    const pOn = per(fbOn), pOff = per(fbOff);
    const t0 = performance.now(); for (let i = 0; i < 100; i++) { waterCompositeJS(fbOn, world, terms, pt, false, false); waterCompositeJS(fbOn, world, terms, pt, false, true); }
    const tOn = (performance.now() - t0) / 100; fbOn.waterLooks = fbOff.waterLooks;
    const t1 = performance.now(); for (let i = 0; i < 100; i++) { waterCompositeJS(fbOn, world, terms, pt, false, false); waterCompositeJS(fbOn, world, terms, pt, false, true); }
    const tOff = (performance.now() - t1) / 100;
    console.log(`composite alone: on ${tOn.toFixed(3)} ms, off ${tOff.toFixed(3)} ms; alloc on ${pOn.toFixed(0)} / off ${pOff.toFixed(0)} B/call`);
    ok('composite: finish keys add no allocation', pOn <= pOff + 512);
    ok('composite finish delta <= 0.3 ms', tOn - tOff <= 0.3);
  }
}
console.log(`waterFinish: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('FAIL', f);
process.exit(fail ? 1 : 0);
