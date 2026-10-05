// ME-14c2 (docs/architecture.md 37.1): kind-9 (KIND_MESH) in the JS frame path - rasterJS face rule, detail shading,
// edge pass, compositor feed. Run: node engine/render/meshKind9.render.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { World } from '../world/World.js';
import { meshFromJSON } from '../index.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { OpenSpans } from './OpenSpans.js';
import { GBuffer, KIND_MESH, FACE_PACKED, FACE_U } from './GBuffer.js';
import { bindShading } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { makeLightBuffer, LightSet } from './lighting.js';
import { SUN_SHADOW_DEFAULTS } from './shadowSun.js';
import { createClothSystem } from '../world/cloths.js';
import { buildWorldColliders } from '../world/colliders.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const loadRuins = (rel) => meshFromJSON(JSON.parse(readFileSync(new URL('../../content/meshes/ruins/' + rel, import.meta.url), 'utf8')));
const line = loadRuins('Fences/Line.mesh.json');
const moss = loadRuins('Moss/GroundMossXS.mesh.json');
// The committed meshes carry an empty `mats` (sidecars arrive with ME-14c4): map them here.
line.mats = Object.fromEntries(line.matKeys.map((k) => [k, 'stone']));
moss.mats = Object.fromEntries(moss.matKeys.map((k) => [k, 'moss_top']));
assets._meshes[line.id] = line; assets._meshes[moss.id] = moss;

const COLS = 80, ROWS = 30;
function makeFb() {
  return {
    renderer: 'mesh',
    rt: new CellBuffer(COLS, ROWS), depth: new DepthBuffer(COLS, ROWS), spans: new OpenSpans(COLS),
    palette: assets.palette, gbuf: new GBuffer(COLS, ROWS), matTable: bindShading(assets.palette, assets.detailPass, 1),
    detailPass: null, lights: null, light: makeLightBuffer(COLS, ROWS), timeSec: 0, loop: { stats: {} },
  };
}
const place = (mesh, x, y, yaw) => ({ id: 'm' + x + '_' + y + '_' + yaw, mesh: mesh.id, origin: { x, y, z: 0 }, yawDeg: yaw });
const mk = (structures, opts = {}) => World.load({ terrain: null, structures, entities: [] }, assets, opts);
function render(world, cam, fb = makeFb()) { renderWorld(fb, world, cam); return fb; }
function cells9(fb) {
  const g = fb.gbuf; let n = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, sx = 0;
  for (let i = 0; i < COLS * ROWS; i++) if (g.kind[i] === KIND_MESH) {
    n++; const x = i % COLS, y = (i / COLS) | 0;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); sx += x;
  }
  return { n, minX, maxX, minY, maxY, cx: n ? sx / n : -1 };
}
const eye = { x: 1000, y: 1000, z: 1.0, pitchDeg: -8 };
// D-028: forward = (sin yaw, -cos yaw), yaw 0 = north, world y increases south.
const lookYaw = 0;
ok('yaw 0: mesh four metres north renders kind-9 cells', cells9(render(mk([place(line, eye.x, eye.y - 4, 0)]), { ...eye, yawDeg: 0 })).n > 0);

{
  const rad = lookYaw * Math.PI / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
  const cam = { ...eye, yawDeg: lookYaw };
  const at = (mesh, yaw, d = 4) => mk([place(mesh, eye.x + d * dx, eye.y + d * dy, yaw)], { physics: 'mesh' });

  // 1. non-empty, centred, glyphs shaded
  const fb0 = render(at(line, 0), cam);
  const c0 = cells9(fb0);
  ok('yaw 0: kind-9 cells non-empty', c0.n > 10, `n=${c0.n}`);
  ok('yaw 0: cells centred horizontally (+-6 cols)', Math.abs(c0.cx - COLS / 2) <= 6, `cx=${c0.cx}`);
  ok('yaw 0: cells below the screen top third (fence at eye 1 m)', c0.minY >= ROWS * 0.3, `minY=${c0.minY}`);
  let lit = 0, glyph = 0;
  for (let i = 0; i < COLS * ROWS; i++) if (fb0.gbuf.kind[i] === KIND_MESH) {
    if (fb0.rt.fg[i * 4] + fb0.rt.fg[i * 4 + 1] + fb0.rt.fg[i * 4 + 2] > 0) lit++;
    if (fb0.rt.glyphIdx[i] !== 0) glyph++;
  }
  ok('kind-9 cells are shaded (fg > 0) and carry glyphs', lit > c0.n * 0.9 && glyph > c0.n * 0.5, `lit=${lit} glyph=${glyph} n=${c0.n}`);

  // 2. materials resolve to real ids (no fallback 0) for both committed meshes
  const mt = fb0.matTable;
  const matsOf = (fb) => { const s = new Set(); for (let i = 0; i < COLS * ROWS; i++) if (fb.gbuf.kind[i] === KIND_MESH) s.add(fb.gbuf.mat[i]); return s; };
  const stoneId = mt.idFor('stone');
  ok('Line: every kind-9 cell mat == idFor(stone)', matsOf(fb0).size === 1 && matsOf(fb0).has(stoneId) && stoneId > 0, [...matsOf(fb0)].join());
  const fbM = render(at(moss, 0, 2.5), { ...cam, z: 2.5, pitchDeg: -35 });
  ok('Moss: every kind-9 cell mat == idFor(moss_top)', cells9(fbM).n > 0 && matsOf(fbM).size === 1 && matsOf(fbM).has(mt.idFor('moss_top')), `n=${cells9(fbM).n}`);
  let unmapped = null;
  try {
    const noMats = { ...line, id: 'x/unmapped', mats: {} };
    assets._meshes[noMats.id] = noMats;
    render(mk([place(noMats, eye.x + 4 * dx, eye.y + 4 * dy, 0)]), cam);
  } catch (e) { unmapped = e.message; }
  ok('unmapped material is not silent (throws naming the material)', unmapped !== null && unmapped.includes(line.matKeys[0]), String(unmapped));

  let badKey = null;
  try {
    const bk = { ...line, id: 'x/badkey', mats: { [line.matKeys[0]]: 'noSuchPaletteKey' } };
    assets._meshes[bk.id] = bk;
    render(mk([place(bk, eye.x + 4 * dx, eye.y + 4 * dy, 0)]), cam);
  } catch (e) { badKey = e.message; }
  ok('unknown palette key throws naming the key (no invented id)', badKey !== null && badKey.includes('noSuchPaletteKey'), String(badKey));

  // 3. yaw 0 / 90 / 37: the cell blob follows the collider AABB extent across the view direction
  const res = {};
  for (const yaw of [0, 90, 37]) {
    const w = at(line, yaw);
    const c = cells9(render(w, cam));
    const col = buildWorldColliders(w)[0];
    const perp = Math.abs(dx) > 0.5 ? col.max[1] - col.min[1] : col.max[0] - col.min[0];
    res[yaw] = { cells: c.maxX - c.minX + 1, perp, n: c.n };
    ok(`yaw ${yaw}: cells non-empty and centred`, c.n > 5 && Math.abs(c.cx - COLS / 2) <= 6, JSON.stringify(c));
  }
  const byPerp = [0, 37, 90].sort((a, b) => res[b].perp - res[a].perp);
  const byCells = [0, 37, 90].sort((a, b) => res[b].cells - res[a].cells);
  ok('cell width orders like the AABB extent across the view', byPerp.join() === byCells.join(), JSON.stringify(res));

  // 4. face rule: yaw 37 has packed (face 7) cells with unit normals (max comp < 0.9); yaw 0 stays axis aligned
  const g = render(at(line, 37), cam).gbuf;
  let axis = 0, packed = 0, bad = 0;
  const alias = new Uint32Array(g.aoD.buffer, g.aoD.byteOffset, g.aoD.length);
  const nv = [0, 0, 1];
  for (let i = 0; i < COLS * ROWS; i++) if (g.kind[i] === KIND_MESH) {
    const f = g.face[i];
    if (f === FACE_PACKED) {
      packed++; unpackNormalOct(alias[i], nv);
      if (Math.abs(Math.hypot(nv[0], nv[1], nv[2]) - 1) > 1e-2 || Math.max(Math.abs(nv[0]), Math.abs(nv[1]), Math.abs(nv[2])) >= 0.9) bad++;
    } else if (f >= 1 && f <= 6) axis++;
    else bad++;
  }
  ok('yaw 37: has face-7 cells with packed unit normals, valid faces only', packed > 0 && bad === 0, `packed=${packed} axis=${axis} bad=${bad}`);
  const g0 = fb0.gbuf; let p0 = 0, aoOk = true, top = 0;
  for (let i = 0; i < COLS * ROWS; i++) if (g0.kind[i] === KIND_MESH) {
    if (g0.face[i] === FACE_PACKED) p0++; else if (g0.aoD[i] !== Infinity) aoOk = false;
    if (g0.face[i] === FACE_U) top++;
  }
  ok('yaw 0: face 7 only on <= 10% of cells (bevels)', p0 <= c0.n * 0.1, `packed=${p0}/${c0.n}`);
  ok('kind 9 axis faces: aoD == Infinity', aoOk);

  // Cloth keys may be resolved lazily by idFor: the strict imported-mesh resolver must never see them.
  {
    const world = at(line, 0), fb = makeFb(), table = fb.matTable;
    const clothKey = 'testLazyCloth';
    world.cloths = createClothSystem([{ id: 'banner', mat: clothKey, cols: 4, rows: 4, size: [1, 1],
      origin: [eye.x - 1, eye.y - 3, 2], yawDeg: 0, plane: 'vertical', pins: [[0, 0], [3, 0]] }], { groundAt: () => 0 });
    const idFor = table.idFor; let calls = 0;
    table.idFor = (key) => { if (key === clothKey) { calls++; return idFor('canvas'); } return idFor(key); };
    fb.lights = new LightSet(); fb.lights.setSun({ elevation: 50, azimuth: 135, on: true }); fb.lights.update(0, null);
    fb.shadowOpts = { ...SUN_SHADOW_DEFAULTS, res: 64, boxM: 32, aheadM: 0 };
    let error = null;
    try { for (let i = 0; i < 8; i++) render(world, cam, fb); } catch (e) { error = e; }
    const clothMesh = world.cloths.meshes[0];
    ok('mesh + lazy cloth key: camera and sun shadow frames do not throw', !error, error?.stack);
    ok('mesh + cloth: shadow map rendered', !!fb.sunMap);
    ok('cloth resolver remains table.idFor across camera/shadow passes', clothMesh?.matFor === table.idFor);
    ok('cloth material resolves once over eight camera/shadow frames', calls === 1, `calls=${calls}`);
  }

  // 5. zero allocation per frame once warm
  const fbA = makeFb(), wA = at(line, 37);
  for (let i = 0; i < 20; i++) renderWorld(fbA, wA, cam);
  global.gc(); const b0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200; i++) renderWorld(fbA, wA, cam);
  global.gc(); const grew = process.memoryUsage().heapUsed - b0;
  ok('no heap growth over 200 mesh frames', grew < 128 * 1024, `grew=${grew}`);

  // 6. GPU path stays clean: with fb.gpu set the JS twin returns early and writes no kind-9 cells
  const fbG = makeFb(); fbG.gpu = {};
  renderWorld(fbG, at(line, 0), cam);
  ok('gpu frame writes no kind-9 cells (GLSL twin = ME-14c3)', cells9(fbG).n === 0);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
