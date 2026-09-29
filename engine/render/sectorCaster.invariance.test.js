// engine/render/sectorCaster.invariance.test.js (CO-3, docs/coordinates.md
// section 10 item 5, yawSteps = 0 cases only).
// Render invariance: a terrain-less world with the tower placed at
// A = (0,0,0), B = (1480,1018,-3), B' = (513.25,-77.5,4), the same RELATIVE
// camera (cam_B = localToWorld(frame_B, worldToLocal(frame_A, cam_A)), same
// yaw/pitch) must give BIT-IDENTICAL rt.cells (glyph/fg/bg) and depth on the
// CPU path, with detail on/off, sprites + voxel props included, and with poses
// outside the footprint (BUG-OWN-008 class). A failure here is a real bug
// (BUG row), never a reason to loosen the test.
// Both CPU geometry paths are covered: the sector caster ('sector') and the
// mesh raster oracle rasterJS ('mesh', fb.renderer = 'mesh'; runs in Node with
// no glue).
// NOTE: the yawSteps 1..3 cases (camera yaw + 90k) are deferred to CO-4
// (rotateLevel; World.load still throws for yawSteps != 0).
// KNOWN BUGS found by this test: with POINT LIGHTS on, the light vis grid does
// not respect the frame (details at section 2). They are XFAIL checks: they
// turn into a suite FAILURE as soon as the bug is fixed, so the check gets
// promoted to a live one.
// Run: node engine/render/sectorCaster.invariance.test.js
import { World } from '../world/World.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { OpenSpans } from './OpenSpans.js';
import { GBuffer } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { buildLightSet, makeLightBuffer } from './lighting.js';
import { VoxelPool } from './VoxelPool.js';
import { SpritePool, drawSprites } from './sprites.js';
import { buildSpriteAtlas } from './gpu/spritesAtlas.js';
import { worldToLocal, localToWorld } from '../core/transform.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import terrainDef from '../../design/levels/overworld_far.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; farTowerMod; ferrumLightsMod; terrainDef;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const COLS = 80, ROWS = 40;
const ORIGINS = { A: { x: 0, y: 0, z: 0 }, B: { x: 1480, y: 1018, z: -3 }, Bp: { x: 513.25, y: -77.5, z: 4 } };
// Diagnostic origins (lights-on isolation): integer xy shift only, z-only, fractional-xy-only.
const DIAG = { Bint: { x: 1480, y: 1018, z: 0 }, Bz: { x: 1480, y: 1018, z: -3 }, Bfrac: { x: 513.25, y: -77.5, z: 0 } };
const worlds = {}, frames = {};
function mk(key, origin) {
  const w = World.load({ terrain: null, structures: [{ id: 'tw', level: 'tower', origin, yawSteps: 0 }], entities: [] }, assets, {});
  // 'ground' props resolve to terrain height and do NOT shift with the frame (spec
  // section 10 item 4); this world has no terrain (=> z 0), so put them at the same
  // structure-relative place in B/B' by hand, or the test would compare a z-shifted
  // structure against unshifted props.
  for (const p of w.structures[0].level.def.props) {
    if (p.z !== 'ground') continue;
    const e = w.entity(`tw.${p.id}`);
    if (e) e.transform.z += origin.z;
  }
  worlds[key] = w; frames[key] = w.frameOf('tw');
}
for (const [k, o] of Object.entries({ ...ORIGINS, ...DIAG })) mk(k, o);
const lvl = worlds.A.structures[0].level;
const atlas = buildSpriteAtlas(assets, assets.palette);

function makeFb(world, useDetail, renderer, useLights) {
  const matTable = bindShading(assets.palette, assets.detailPass, 1);
  for (const s of world.structures) bindLevel(matTable, s.level);
  const rt = new CellBuffer(COLS, ROWS);
  rt.pxCellW = 1; rt.pxCellH = 2;
  rt.cells = rt; // edgePass/drawSprites read rt.cells (RenderTarget shape)
  const pool = new VoxelPool();
  pool.bind(assets, matTable);
  return {
    rt, depth: new DepthBuffer(COLS, ROWS), spans: new OpenSpans(COLS), palette: assets.palette,
    gbuf: new GBuffer(COLS, ROWS), matTable, detailPass: useDetail ? assets.detailPass : null,
    lights: useLights ? buildLightSet(world, assets.palette) : null, light: makeLightBuffer(COLS, ROWS),
    timeSec: 0, loop: { stats: {} }, voxelPool: pool, renderer,
    spritePool: new SpritePool(atlas, assets.palette),
  };
}

function render(world, fb, cam) {
  if (fb.lights) fb.lights.update(0, world);
  fb.voxelPool.collect(world, cam);
  fb.voxelPool.project(cam, fb.rt);
  renderWorld(fb, world, cam);
  fb.spritePool.collect(world);
  fb.spritePool.project(cam, fb.rt, fb.lights || [1, 1, 1], world);
  drawSprites(fb, fb.spritePool);
  return fb;
}

// First differing field between two renders (or null).
function diff(a, b) {
  const n = COLS * ROWS;
  for (let i = 0; i < n; i++) {
    const at = `@${i % COLS},${(i / COLS) | 0}`;
    if (a.rt.glyphIdx[i] !== b.rt.glyphIdx[i]) return `glyph ${at}`;
    for (let k = 0; k < 4; k++) {
      if (a.rt.fg[i * 4 + k] !== b.rt.fg[i * 4 + k]) return `fg[${k}] ${at}: ${a.rt.fg[i * 4 + k]} vs ${b.rt.fg[i * 4 + k]}`;
      if (a.rt.bg[i * 4 + k] !== b.rt.bg[i * 4 + k]) return `bg[${k}] ${at}: ${a.rt.bg[i * 4 + k]} vs ${b.rt.bg[i * 4 + k]}`;
    }
    if (!Object.is(a.depth.depth[i], b.depth.depth[i])) return `depth ${at}: ${a.depth.depth[i]} vs ${b.depth.depth[i]}`;
  }
  return null;
}
function drawn(fb) {
  let c = 0;
  for (let i = 0; i < COLS * ROWS; i++) if (Number.isFinite(fb.depth.depth[i])) c++;
  return c;
}

const eye = 1.6;
const fl = (x, y) => lvl.floorAt(x, y) ?? 0;
// Interior cells: one with a real (non-sky) ceiling for the look-up pose, the highest non-summit floor for the stair pose.
let roofCell = null, stairCell = null;
for (let y = 0; y < lvl.height; y++) for (let x = 0; x < lvl.width; x++) {
  const s = lvl.sectorAt(x + 0.5, y + 0.5);
  if (!s || s.solid) continue;
  const f = lvl.floorAt(x + 0.5, y + 0.5);
  if (s.ceilH !== 'sky' && s.ceilH > f + 1 && !roofCell) roofCell = { x: x + 0.5, y: y + 0.5, f };
  if (s.ceilH === 'sky' && f > 2 && f < 6 && (!stairCell || f > stairCell.f)) stairCell = { x: x + 0.5, y: y + 0.5, f };
}
if (!roofCell || !stairCell) throw new Error('tower fixture changed: no roof/stair cell for the invariance poses');
// Camera poses in structure-local coordinates (frame A = identity).
const poses = {
  'inside ground floor': { x: 5.5, y: 6.5, z: fl(5.5, 6.5) + eye, yawDeg: 40, pitchDeg: -5 },
  'inside, facing lantern/brazier': { x: 14.5, y: 6.5, z: fl(14.5, 6.5) + eye, yawDeg: 90, pitchDeg: 0 },
  'inside, looking up': { x: roofCell.x, y: roofCell.y, z: roofCell.f + eye, yawDeg: 200, pitchDeg: 45 },
  'stair': { x: stairCell.x, y: stairCell.y, z: stairCell.f + eye, yawDeg: 300, pitchDeg: -15 },
  'outside west of footprint': { x: -6, y: lvl.height / 2, z: 3, yawDeg: 90, pitchDeg: -4 },
  'outside glancing (NE corner)': { x: lvl.width + 5, y: -4, z: 4, yawDeg: 235, pitchDeg: -10 },
};

const tmpL = { x: 0, y: 0, z: 0 }, tmpW = { x: 0, y: 0, z: 0 };
function camFor(key, camA) {
  worldToLocal(frames.A, camA.x, camA.y, camA.z, tmpL);
  localToWorld(frames[key], tmpL.x, tmpL.y, tmpL.z, tmpW);
  return { x: tmpW.x, y: tmpW.y, z: tmpW.z, yawDeg: camA.yawDeg, pitchDeg: camA.pitchDeg };
}
// Renders every pose for A and `key`; returns the renders that differ.
function compare(key, useLights, renderers = ['sector', 'mesh']) {
  const bad = [];
  for (const renderer of renderers) for (const useDetail of [true, false]) for (const [name, camA] of Object.entries(poses)) {
    const label = `${renderer}/detail ${useDetail ? 'on' : 'off'}/'${name}'`;
    const ref = render(worlds.A, makeFb(worlds.A, useDetail, renderer, useLights), camA);
    if (drawn(ref) === 0) bad.push({ label, d: 'A draws nothing (bad pose)' });
    const got = render(worlds[key], makeFb(worlds[key], useDetail, renderer, useLights), camFor(key, camA));
    const d = diff(ref, got);
    if (d) bad.push({ label, d });
  }
  return bad;
}
const N = 2 * 2 * Object.keys(poses).length;
const first = (bad) => bad.slice(0, 3).map((b) => `${b.label}: ${b.d}`).join(' | ');

// ---- 1. LIVE: ambient-only (no point lights): geometry + voxel props + sprites bit-identical ----
for (const key of ['B', 'Bp']) {
  const bad = compare(key, false);
  ok(`no point lights: A == ${key} bit-identical (cells + depth), ${N} sector+mesh/detail/pose renders`, bad.length === 0, first(bad));
}

// ---- 2. Point lights on ----
// LIVE control: an integer xy shift with z = 0 is bit-identical.
{
  const bad = compare('Bint', true);
  ok('point lights on: A == integer-xy shift (1480,1018,0) bit-identical', bad.length === 0, first(bad));
}
// XFAIL (real bugs, see the story note; these flip to a suite FAILURE once fixed):
//  (a) z != 0: `computeVisGrid`/`cellBlocks` (lighting.js) compare the light's WORLD z (`defZ`)
//      against level-local `sec.floorH/ceilH/topH` without subtracting `frame.z` (sunVisible does
//      subtract it), so the per-light occlusion box differs for a structure at z = -3.
//  (b) fractional xy origin: the vis grid box/DDA is aligned to WORLD integer cells
//      (`floor(defX)`, `cellBlocks(world, cx, cy)` -> `sectorAt(cx + 0.5, ...)`), not to the level
//      grid, so a structure at x/y .25/.5 gets a shifted occlusion grid.
for (const [key, what] of [['Bz', 'z-only shift (1480,1018,-3)'], ['Bfrac', 'fractional-xy-only shift (513.25,-77.5,0)'], ['B', 'spec B (1480,1018,-3)'], ['Bp', "spec B' (513.25,-77.5,4)"]]) {
  const bad = compare(key, true, ['sector']);
  ok(`XFAIL point lights on, ${what}: still differs from A (known light-vis bug; fixing it must promote this to a live check)`, bad.length > 0, `now bit-identical in all ${N / 2} sector renders: promote to a live check`);
  if (bad.length) console.log(`  (xfail) ${what}: ${bad.length}/${N / 2} sector renders differ, first: ${bad[0].label}: ${bad[0].d}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
