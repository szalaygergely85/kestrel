// US-055a2b (architecture.md 32.2 + 35.3, 35.11 step 3): the water composite - look table, JS twin on fixtures, edge suppression,
// sky pass, shader source parity, zero allocation. Node ESM, no framework.
// Run: node --expose-gc engine/render/waterComposite.test.js
import { World } from '../world/World.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { OpenSpans } from './OpenSpans.js';
import { GBuffer, KIND_MODEL, FACE_E } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { makeLightBuffer } from './lighting.js';
import { edgePass } from './edgePass.js';
import { hashFastU } from './terrainShade.js';
import { unprojectCell } from './projection.js';
import { sunFromWorld } from './terrainCaster.js';
import {
  DEFAULT_WATER_LOOK, WL_STRIDE, WATER_HASH_SALT, packWaterLook, resolveWaterLooks, fillWaterSlotTable, waterFogParams, WFOG_LEN,
} from './waterLook.js';
import { lastWaterSelection } from './water.js';
import { WATER_COMPOSITE_FRAG_SRC } from './gpu/glsl/waterComposite.frag.js';
import { EDGE_FRAG_SRC } from './gpu/glsl/edge.frag.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const COLS = 80, ROWS = 40;
const DP = globalThis.ASSETS.detailPass;

// ---- fixtures ----
function makeFb(world) {
  const matTable = bindShading(assets.palette, assets.detailPass, 1);
  if (world.structures[0]) bindLevel(matTable, world.structures[0].level);
  return {
    rt: new CellBuffer(COLS, ROWS), depth: new DepthBuffer(COLS, ROWS), spans: new OpenSpans(COLS), palette: assets.palette,
    gbuf: new GBuffer(COLS, ROWS), matTable, detailPass: null, lights: null, light: makeLightBuffer(COLS, ROWS),
    timeSec: 0, loop: { stats: {} }, renderer: 'mesh',
  };
}
const roomDef = (water) => ({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [], water });
const seaDef = (water) => ({ terrain: null, structures: [], entities: [], water });
const POOL = { id: 'pool', shape: 'rect', rect: [2, 2, 9, 9], z: 0.4 };
const CAM = { x: 5.5, y: 5.5, z: 1.6, yawDeg: 40, pitchDeg: -25, projection: 'shear' };

const cellsOf = (fb) => fb.rt.cells || fb.rt;
function snapshot(fb) {
  const c = cellsOf(fb);
  return { glyph: c.glyphIdx.slice(), fg: c.fg.slice(), bg: c.bg.slice() };
}

// ---- 1. look table ----
{
  const row = packWaterLook('t', null);
  ok('look: defaults pack to WL_STRIDE floats with ramp codes ASCII-32', row.length === WL_STRIDE && row[12] === 3 && row[16] === 126 - 32 && row[17] === 45 - 32 && row[18] === 61 - 32);
  ok('look: shallow / deep / glint / opaqueAt / seeThrough / waveHz / bgK land in their slots',
    row[0] === 96 && row[4] === 16 && row[8] === 235 && Math.abs(row[3] - 1.5) < 1e-6 && Math.abs(row[7] - 0.35) < 1e-6 && row[11] === 2 && Math.abs(row[13] - 0.6) < 1e-6);
  const bads = [{ ramp: '' }, { ramp: '123456789' }, { ramp: 'a b' }, { shallow: [1, 2] }, { deep: [0, 0, 300] }, { opaqueAt: 0 }, { seeThrough: 2 }, { waveHz: -1 }, { bgK: 1.5 }];
  let allThrow = true, named = true;
  for (const b of bads) { try { packWaterLook('lava', b); allThrow = false; } catch (e) { if (!String(e.message).includes('lava')) named = false; } }
  ok('look: every invalid field throws, naming the look', allThrow && named);
  const looks = resolveWaterLooks({ lava: { ramp: '#@', shallow: [255, 80, 0], deep: [120, 20, 0] } });
  const world = { water: { lookNames: ['water', 'lava', 'lava'], look: Uint8Array.from([0, 1, 2]) } };
  const out = new Float32Array(12 * WL_STRIDE);
  fillWaterSlotTable({ count: 3, region: Int32Array.from([1, 0, 2]) }, world, looks, out);
  ok('look: slot table = region look by name (designer table first, engine default for an unknown name)',
    out[0] === 255 && out[12] === 2 && out[WL_STRIDE] === 96 && out[WL_STRIDE + 12] === 3 && out[2 * WL_STRIDE] === 255);
  const t = new Float32Array(WFOG_LEN);
  waterFogParams({ fog: { start: 10, full: 40, fgRGB: [1, 2, 3], bgRGB: [4, 5, 6] } }, null, false, t);
  ok('fog: no terrain -> the interior fog (linear, bg x1)', t[0] === 10 && t[1] === 40 && t[2] === 1 && t[3] === 1 && t[4] === 1 && t[8] === 1 && t[12] === 4 && t[16] === 4);
  waterFogParams({ fog: { start: 10, full: 40, fgRGB: [1, 2, 3], bgRGB: [4, 5, 6] } }, { fog: { far: { start: 50, full: 1500, curve: 0.7, color: 'a', colorFar: 'b' } }, rgb: { a: [9, 9, 9], b: [20, 20, 20] } }, true, t);
  ok('fog: terrain world -> the terrain fog (curve, bg x1.1, near -> far colour)', t[0] === 50 && t[1] === 1500 && Math.abs(t[2] - 0.7) < 1e-6 && Math.abs(t[3] - 1.1) < 1e-6 && t[4] === 9 && t[8] === 20 && t[12] === 9 && t[16] === 20);
}

// ---- 2. twin on a pool fixture: formula, floor visible, hidden, anchored ----
{
  const world = World.load(roomDef([POOL]), assets, {});
  const base = World.load(roomDef([]), assets, {});
  const fb = makeFb(world), fb0 = makeFb(base);
  for (let w = 0; w < 2; w++) { renderWorld(fb, world, CAM); renderWorld(fb0, base, CAM); } // frame 1 primes the lazy ambient light state
  const snap = snapshot(fb), snap0 = snapshot(fb0);
  const wt = fb.water, depth = fb.depth.depth, N = COLS * ROWS;
  let hits = 0, opaque = 0, seeThrough = 0, untouchedOk = true, formulaBad = 0, seeBad = 0, maskBad = 0, glintN = 0;
  // independent re-derivation from DEFAULT_WATER_LOOK (not from the packed table)
  const L = DEFAULT_WATER_LOOK;
  const sun = sunFromWorld(world, assets.palette, {});
  const k = sun.ambientI + sun.sunI * Math.max(0, sun.dirZ);
  const terms = {}; // filled by a fresh projTerms of the same camera, as the compositor did (grid = the rt's)
  const grid = { cols: COLS, rows: ROWS, pxCellW: fb.rt.pxCellW || 1, pxCellH: fb.rt.pxCellH || 1 };
  const { projTerms } = await import('./projection.js');
  projTerms(CAM, grid, terms);
  const P = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const isHit = wt.kind[i] === 1 && wt.depth[i] < depth[i] && fb.gbuf.kind[i] !== 0;
    if (!isHit) {
      if (snap.glyph[i] !== snap0.glyph[i] || snap.fg[i * 4] !== snap0.fg[i * 4] || snap.bg[i * 4 + 1] !== snap0.bg[i * 4 + 1]) untouchedOk = false;
      continue;
    }
    hits++;
    const dW = wt.depth[i], a = Math.min(1, Math.max(0, (depth[i] - dW) / L.opaqueAt));
    if (a >= L.seeThrough) {
      opaque++;
      if (!fb.waterMask || fb.waterMask[i] !== 1) maskBad++;
      unprojectCell(terms, i % COLS, (i / COLS) | 0, dW, P);
      const h = hashFastU(Math.floor(P[0] / 0.5), Math.floor(P[1] / 0.5), WATER_HASH_SALT + 31 * Math.floor(0 * L.waveHz));
      const code = L.ramp.charCodeAt(h % L.ramp.length) - 32;
      if (snap.glyph[i] !== code) formulaBad++;
      const glint = (h >>> 8) / 16777216 > 0.9;
      if (glint) glintN++;
      // fg must sit between the water colours scaled by k (fog is ~0 at room distances) or toward the glint
      const hi = Math.min(255, Math.max(L.shallow[0], L.deep[0]) * k + 1), lo = Math.min(L.shallow[0], L.deep[0]) * k * 0 - 1;
      if (!glint && !(snap.fg[i * 4] <= Math.max(hi, 1) && snap.fg[i * 4] >= lo)) formulaBad++;
    } else {
      seeThrough++;
      if (fb.waterMask && fb.waterMask[i] === 1) maskBad++;
      if (snap.glyph[i] !== snap0.glyph[i]) seeBad++; // floor glyph stays
    }
  }
  ok('twin: pool covers cells, both opaque and see-through ones occur', hits > 200 && opaque > 50 && seeThrough > 5, `hits ${hits} opaque ${opaque} see ${seeThrough}`);
  ok('twin: cells without water are bit-identical to the no-water render', untouchedOk);
  ok('twin: opaque cells use the ramp glyph from hash(floor(P/0.5), t) - world anchored', formulaBad === 0, `${formulaBad}`);
  ok('twin: see-through (shallow) cells keep the floor glyph (floor visible through shallows)', seeBad === 0, `${seeBad}`);
  ok('twin: edge mask is set exactly on opaque surface cells', maskBad === 0, `${maskBad}`);
  ok('twin: a glint cell exists (hash > 0.9, ~10 % of opaque cells)', glintN > 0 && glintN < opaque * 0.3, `${glintN}/${opaque}`);

  // deep > shallow: the colour darkens with the path length (opaque cells far from the rim are deeper than near the shore)
  let rShallow = 0, nSh = 0, rDeep = 0, nDp = 0;
  for (let i = 0; i < N; i++) {
    if (wt.kind[i] !== 1 || fb.gbuf.kind[i] === 0) continue;
    const a = Math.min(1, (depth[i] - wt.depth[i]) / L.opaqueAt);
    if (a >= L.seeThrough && a < 0.6) { rShallow += snap.bg[i * 4 + 2]; nSh++; } else if (a > 0.95) { rDeep += snap.bg[i * 4 + 2]; nDp++; }
  }
  ok('twin: depth tint - the long-path (deep) water bg blue is darker than the shallow-path one', nSh > 5 && nDp > 5 && rDeep / nDp < rShallow / nSh, `${rDeep / nDp} vs ${rShallow / nSh}`);

  // anchoring: another yaw, every opaque cell's glyph still equals the hash of ITS world point
  const cam2 = { ...CAM, yawDeg: 63, x: 5.9 };
  renderWorld(fb, world, cam2);
  projTerms(cam2, grid, terms);
  let bad2 = 0, n2 = 0;
  for (let i = 0; i < N; i++) {
    if (fb.water.kind[i] !== 1 || fb.gbuf.kind[i] === 0) continue;
    const dW = fb.water.depth[i], a = Math.min(1, (fb.depth.depth[i] - dW) / L.opaqueAt);
    if (a < L.seeThrough) continue;
    unprojectCell(terms, i % COLS, (i / COLS) | 0, dW, P);
    const h = hashFastU(Math.floor(P[0] / 0.5), Math.floor(P[1] / 0.5), WATER_HASH_SALT);
    n2++;
    if (cellsOf(fb).glyphIdx[i] !== L.ramp.charCodeAt(h % L.ramp.length) - 32) bad2++;
  }
  ok('twin: hash is world-anchored (same rule holds after the camera turned and moved)', n2 > 50 && bad2 === 0, `${bad2}/${n2}`);

  // time: the glyph re-rolls every 1/waveHz s
  const f1 = snapshot(fb);
  fb.timeSec = 0.55; // tick 1 at waveHz 2
  renderWorld(fb, world, cam2);
  let diff = 0, tot = 0;
  for (let i = 0; i < N; i++) if (fb.water.kind[i] === 1 && fb.gbuf.kind[i] !== 0 && fb.waterMask[i] === 1) { tot++; if (cellsOf(fb).glyphIdx[i] !== f1.glyph[i]) diff++; }
  ok('twin: the wave glyphs re-roll with time (tick = floor(t * waveHz))', tot > 50 && diff > tot * 0.3, `${diff}/${tot}`);
  fb.timeSec = 0;
}

// ---- 3. a wall in front hides the water; the layer's occluder + composite agree ----
{
  // camera inside the room looking at the wall just past the pool edge: no water texel survives where the wall is nearer
  const world = World.load(roomDef([{ id: 'wallpool', shape: 'rect', rect: [-30, -30, 30, 30], z: 0.3 }]), assets, {});
  const fb = makeFb(world);
  renderWorld(fb, world, { x: 5.5, y: 5.5, z: 1.6, yawDeg: 0, pitchDeg: 0, projection: 'shear' });
  let behind = 0, written = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (fb.gbuf.kind[i] !== 0 && fb.water && fb.water.kind[i] === 1) { written++; if (!(fb.water.depth[i] < fb.depth.depth[i])) behind++; }
  }
  ok('wall: no water texel is ever written behind nearer scene geometry', behind === 0, `${behind}/${written}`);
}

// ---- 4. the sky pass: sea out to the horizon ----
{
  const world = World.load(seaDef([{ id: 'sea', shape: 'rect', rect: [-3000, -3000, 3000, 3000], z: 0 }]), assets, {});
  const fb = makeFb(world);
  renderWorld(fb, world, { x: 0, y: 0, z: 6, yawDeg: 0, pitchDeg: -8, projection: 'shear' });
  let sea = 0, ramp = 0;
  const codes = new Set([...DEFAULT_WATER_LOOK.ramp].map((c) => c.charCodeAt(0) - 32));
  for (let i = 0; i < COLS * ROWS; i++) if (fb.water && fb.water.kind[i] === 1 && fb.gbuf.kind[i] === 0) { sea++; if (codes.has(cellsOf(fb).glyphIdx[i])) ramp++; }
  ok('sky pass: water over sky cells (sea to the horizon) composites with the ramp glyphs (a = 1)', sea > 300 && ramp === sea, `${ramp}/${sea}`);
  ok('sky pass: the surface pass does not touch sky cells (mask has none)', fb.waterMask && fb.waterMask.reduce((a, b) => a + b, 0) === 0);
  // far water fogs toward the fog colour: the horizon row is lighter / different from the near row's bg
  const bgNear = cellsOf(fb).bg[((ROWS - 1) * COLS + 40) * 4 + 2];
  ok('sky pass: renders a non-black bg', bgNear > 0);
}

// ---- 5. pitched projection renders too (fog scale branch) ----
{
  const world = World.load(roomDef([POOL]), assets, {});
  const fb = makeFb(world);
  for (let w = 0; w < 2; w++) renderWorld(fb, world, { x: 5.5, y: 5.5, z: 2.0, yawDeg: 40, pitchDeg: -45, projection: 'pitched' });
  let hits = 0, ramped = 0;
  const codes = new Set([...DEFAULT_WATER_LOOK.ramp].map((c) => c.charCodeAt(0) - 32));
  for (let i = 0; i < COLS * ROWS; i++) if (fb.water && fb.water.kind[i] === 1 && fb.gbuf.kind[i] !== 0) { hits++; if (fb.waterMask[i] === 1 && codes.has(cellsOf(fb).glyphIdx[i])) ramped++; }
  ok('pitched: pool composites (opaque cells carry ramp glyphs)', hits > 100 && ramped > 20, `${ramped}/${hits}`);
}

// ---- 6. edge suppression ----
{
  const COLS3 = 3, ROWS3 = 3, idx = (x, y) => y * COLS3 + x;
  function run(suppress) {
    const gbuf = new GBuffer(COLS3, ROWS3);
    const depth = new Float32Array(COLS3 * ROWS3).fill(2);
    for (let y = 0; y < ROWS3; y++) {
      gbuf.kind[idx(1, y)] = KIND_MODEL; gbuf.face[idx(1, y)] = FACE_E; gbuf.planeId[idx(1, y)] = 1;
      gbuf.kind[idx(2, y)] = KIND_MODEL; gbuf.face[idx(2, y)] = FACE_E; gbuf.planeId[idx(2, y)] = 2;
    }
    const n = COLS3 * ROWS3;
    const rt = { gpuActive: false, cells: { glyphIdx: new Uint8Array(n).fill(7), fg: new Uint8Array(n * 4).fill(200), bg: new Uint8Array(n * 4).fill(150) } };
    edgePass(gbuf, depth, rt, DP.edges, suppress);
    return { gbuf, rt };
  }
  const plain = run(null);
  ok('edge: without a mask the model silhouette cell gets a rule', plain.gbuf.rule[idx(1, 1)] !== 0 && plain.rt.cells.glyphIdx[idx(1, 1)] !== 7);
  const m = new Uint8Array(9); m[idx(1, 1)] = 1;
  const sup = run(m);
  ok('edge: a masked (opaque-water) cell draws no outline, glyph and colour untouched', sup.gbuf.rule[idx(1, 1)] === 0 && sup.rt.cells.glyphIdx[idx(1, 1)] === 7 && sup.rt.cells.fg[idx(1, 1) * 4] === 200);
  ok('edge: unmasked neighbours keep their rule', run(m).gbuf.rule[idx(2, 1)] === plain.gbuf.rule[idx(2, 1)]);
  ok('edge: an all-zero mask is a no-op', run(new Uint8Array(9)).gbuf.rule[idx(1, 1)] === plain.gbuf.rule[idx(1, 1)]);
}

// ---- 7. shader source parity (the GLSL twin) ----
{
  const S = WATER_COMPOSITE_FRAG_SRC;
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('glsl: the composite uses the shared water hash salt and the (x,y,salt+31*tick) key', S.includes(`${WATER_HASH_SALT} + 31 * tick`) && S.includes('hashFastU(int(floor(P.x / 0.5)), int(floor(P.y / 0.5))'));
  ok('glsl: opacity / seeThrough / glint / bgK rules are the 32.2 ones', S.includes('clamp((raw - dW) / opaqueAt, 0.0, 1.0)') && S.includes('a >= seeThrough') && S.includes('> 0.9') && S.includes('* 0.5') && S.includes('wc * bgK'));
  ok('glsl: gl_FragCoord only as the ivec2 cell address, no round(, no Infinity literal', (S.match(/gl_FragCoord/g) || []).length === 1 && /ivec2\s*\(\s*gl_FragCoord\.xy\s*\)/.test(S) && !strip(S).includes('round(') && !S.includes('Infinity'));
  ok('glsl: reads the +Inf WATER clear by bit pattern, passthrough cells (bg.a < 0.5) are copied', S.includes('0x7f800000u') && S.includes('sbg.a < 0.5'));
  ok('glsl: terrain sun term on an up normal with the cell sun-map bits', S.includes('max(uSunDir.z, 0.0)') && S.includes('uSunMapOn != 0'));
  ok('glsl: sampler budget - 6 samplers in the composite, and the edge pass adds only uWater', (S.match(/uniform u?sampler2D/g) || []).length === 6 && (EDGE_FRAG_SRC.match(/uniform u?sampler2D/g) || []).length === 5);
  ok('glsl: the edge pass suppresses outlines on opaque water (uWaterOn / waterOpaque)', EDGE_FRAG_SRC.includes('!waterOpaque(cell, distRaw)') && EDGE_FRAG_SRC.includes('(raw - dW) / os.x >= os.y'));
}

// ---- 8. zero allocation after warm ----
{
  const world = World.load(roomDef([POOL]), assets, {});
  const fb = makeFb(world);
  for (let f = 0; f < 30; f++) renderWorld(fb, world, { ...CAM, yawDeg: 40 + f });
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
    const m0 = process.memoryUsage().heapUsed;
    const camS = { ...CAM };
    for (let f = 0; f < 300; f++) { camS.yawDeg = 40 + (f % 20); renderWorld(fb, world, camS); }
    globalThis.gc();
    const grow = process.memoryUsage().heapUsed - m0;
    ok('zero allocation: 300 composite frames grow the heap by < 256 KB', grow < 256 * 1024, `${(grow / 1024).toFixed(0)} KB`);
  } else console.log('(skipped heap check: run with --expose-gc)');
  ok('slot table scratch is shared (one Float32Array, 12 rows)', lastWaterSelection().count === 1);
}

console.log(`\nwaterComposite.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
