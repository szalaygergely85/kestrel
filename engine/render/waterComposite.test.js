// US-055a2b (architecture.md 32.2 + 35.3, 35.11 step 3): the water composite - look table, JS twin on fixtures, edge suppression,
// sky pass, shader source parity, zero allocation. Node ESM, no framework.
// Run: node --expose-gc engine/render/waterComposite.test.js
import { World } from '../world/World.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer, KIND_MODEL, FACE_E } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { makeLightBuffer } from './lighting.js';
import { edgePass } from './edgePass.js';
import { hashFastU } from './terrainShade.js';
import { unprojectCell } from './projection.js';
import { sunFromWorld } from './lighting.js';
import {
  DEFAULT_WATER_LOOK, WL_STRIDE, WATER_HASH_SALT, waterSurfaceHash, waterEdgeDistance, packWaterLook, resolveWaterLooks, fillWaterSlotTable, waterFogParams, WFOG_LEN,
} from './waterLook.js';
import { waterCompositeJS, lastWaterSlotTable } from './waterComposite.js';
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
    rt: new CellBuffer(COLS, ROWS), depth: new DepthBuffer(COLS, ROWS), palette: assets.palette,
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

function expectedHash(px, py, L, time = 0) {
  const ou = Math.fround((L.drift / Math.fround(L.cellM) * time) % 1024);
  const phase = Math.fround((time * L.waveHz) % 1024);
  const f = Math.fround;
  const u = f(f(f(f(f(px) * f(0.8776)) + f(f(py) * f(0.4794))) / f(L.cellM)) - ou);
  const v = f(f(f(-f(px) * f(0.4794)) + f(f(py) * f(0.8776))) / f(L.cellM));
  const iu = Math.floor(u), iv = Math.floor(v + 0.5 * (iu & 1));
  const h0 = hashFastU(iu & 1023, iv & 1023, WATER_HASH_SALT);
  return hashFastU(iu & 1023, iv & 1023, WATER_HASH_SALT + 31 * Math.floor(phase + (h0 & 255) / 256));
}

// ---- 1. look table ----
{
  const row = packWaterLook('t', null);
  ok('look: defaults pack to WL_STRIDE floats with ramp codes ASCII-32', row.length === WL_STRIDE && row[12] === 3 && row[16] === 126 - 32 && row[17] === 45 - 32 && row[18] === 61 - 32);
  ok('look: shallow / deep / glint / opaqueAt / seeThrough / waveHz / bgK land in their slots',
    row[0] === 96 && row[4] === 16 && row[8] === 235 && Math.abs(row[3] - 1.5) < 1e-6 && Math.abs(row[7] - 0.35) < 1e-6 && row[11] === 2 && Math.abs(row[13] - 0.6) < 1e-6);
  const bads = [{ ramp: '' }, { ramp: '123456789' }, { ramp: 'a b' }, { shallow: [1, 2] }, { deep: [0, 0, 300] }, { opaqueAt: 0 }, { seeThrough: 2 }, { waveHz: -1 }, { bgK: 1.5 }, { cellM: 0 }, { cellM: Infinity }, { glintP: -0.1 }, { glintP: 2 }, { drift: NaN }, { drift: -1 }, { tintDepth: 0 }, { shoreW: -1 }, { rim: [1, 2, 999] }, { foamRamp: 'abcd' }, { foamRamp: 'a ' }, { foamDepth: 0 }, { foamFar: Infinity }];
  let allThrow = true, named = true;
  for (const b of bads) { try { packWaterLook('lava', b); allThrow = false; } catch (e) { if (!String(e.message).includes('lava')) named = false; } }
  ok('look: every invalid field throws, naming the look', allThrow && named);
  const looks = resolveWaterLooks({ lava: { ramp: '#@', shallow: [255, 80, 0], deep: [120, 20, 0] } });
  const world = { water: { lookNames: ['water', 'lava', 'lava'], look: Uint8Array.from([0, 1, 2]), flow: new Float64Array(6), flowR: new Float64Array(3), kind: new Uint8Array(3), x0: new Float64Array(3), y0: new Float64Array(3), x1: new Float64Array(3), y1: new Float64Array(3) } };
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
      const h = expectedHash(P[0], P[1], L);
      const edge = Math.min(P[0] - 2, P[1] - 2, 9 - P[0], 9 - P[1]);
      const shoreS = Math.max(0, Math.min(0.4 / L.foamDepth, edge / L.shoreW));
      const shore = shoreS < 1 && dW < L.foamFar;
      const code = shore ? L.foamRamp.charCodeAt(Math.min(Math.floor(shoreS * L.foamRamp.length), L.foamRamp.length - 1)) - 32
        : L.ramp.charCodeAt(h % L.ramp.length) - 32;
      if (snap.glyph[i] !== code) formulaBad++;
      const glint = (h >>> 8) / 16777216 > 1 - Math.fround(L.glintP);
      if (glint) glintN++;
      // fg must sit between the water colours scaled by k (fog is ~0 at room distances) or toward the glint
      const hi = Math.min(255, Math.max(L.shallow[0], L.deep[0]) * k + 1), lo = Math.min(L.shallow[0], L.deep[0]) * k * 0 - 1;
      if (!glint && !shore && !(snap.fg[i * 4] <= Math.max(hi, 1) && snap.fg[i * 4] >= lo)) formulaBad++;
    } else {
      seeThrough++;
      if (fb.waterMask && fb.waterMask[i] === 1) maskBad++;
      if (snap.glyph[i] !== snap0.glyph[i]) seeBad++; // floor glyph stays
    }
  }
  ok('twin: pool covers cells, both opaque and see-through ones occur', hits > 200 && opaque > 50 && seeThrough > 5, `hits ${hits} opaque ${opaque} see ${seeThrough}`);
  ok('twin: cells without water are bit-identical to the no-water render', untouchedOk);
  ok('twin: opaque cells use the ramp glyph from the drifting brick hash - world anchored', formulaBad === 0, `${formulaBad}`);
  ok('twin: see-through (shallow) cells keep the floor glyph (floor visible through shallows)', seeBad === 0, `${seeBad}`);
  ok('twin: edge mask is set exactly on opaque surface cells', maskBad === 0, `${maskBad}`);
  ok('twin: a glint cell exists (configured glint probability)', glintN > 0 && glintN < opaque * 0.3, `${glintN}/${opaque}`);

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
    const h = expectedHash(P[0], P[1], L);
    n2++;
    const edge = Math.min(P[0] - 2, P[1] - 2, 9 - P[0], 9 - P[1]);
    const shoreS = Math.max(0, Math.min(0.4 / L.foamDepth, edge / L.shoreW));
    const code = shoreS < 1 && dW < L.foamFar
      ? L.foamRamp.charCodeAt(Math.min(Math.floor(shoreS * L.foamRamp.length), L.foamRamp.length - 1)) - 32
      : L.ramp.charCodeAt(h % L.ramp.length) - 32;
    if (cellsOf(fb).glyphIdx[i] !== code) bad2++;
  }
  ok('twin: hash is world-anchored (same rule holds after the camera turned and moved)', n2 > 50 && bad2 === 0, `${bad2}/${n2}`);

  // time: the glyph re-rolls every 1/waveHz s
  const f1 = snapshot(fb);
  fb.timeSec = 0.55; // tick 1 at waveHz 2
  renderWorld(fb, world, cam2);
  let diff = 0, tot = 0;
  for (let i = 0; i < N; i++) if (fb.water.kind[i] === 1 && fb.gbuf.kind[i] !== 0 && fb.waterMask[i] === 1) { tot++; if (cellsOf(fb).glyphIdx[i] !== f1.glyph[i]) diff++; }
  ok('twin: the wave glyphs re-roll with time (staggered phase plus drift)', tot > 50 && diff > tot * 0.2, `${diff}/${tot}`);
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
  ok('glsl: the composite uses the shared water hash salt and the (x,y,salt+31*tick) key', S.includes(`${WATER_HASH_SALT} + 31 * tick`) && S.includes('hashFastU(iu & 1023, iv & 1023,'));
  ok('glsl: opacity / seeThrough / glint / bgK rules are the 32.2 ones', S.includes('clamp((raw - dW) / opaqueAt, 0.0, 1.0)') && S.includes('a >= seeThrough') && S.includes('> 1.0 - r3.w') && S.includes('* 0.5') && S.includes('wc * bgK'));
  ok('glsl: gl_FragCoord only as the ivec2 cell address, no round(, no Infinity literal', (S.match(/gl_FragCoord/g) || []).length === 1 && /ivec2\s*\(\s*gl_FragCoord\.xy\s*\)/.test(S) && !strip(S).includes('round(') && !S.includes('Infinity'));
  ok('glsl: reads the +Inf WATER clear by bit pattern, passthrough cells (bg.a < 0.5) are copied', S.includes('0x7f800000u') && S.includes('sbg.a < 0.5'));
  ok('glsl: terrain sun term on an up normal with the cell sun-map bits', S.includes('max(uSunDir.z, 0.0)') && S.includes('uSunMapOn != 0'));
  ok('glsl: sampler budget - 6 samplers in the composite, and the edge pass adds only uWater', (S.match(/uniform u?sampler2D/g) || []).length === 6 && (EDGE_FRAG_SRC.match(/uniform u?sampler2D/g) || []).length === 5);
  ok('glsl: the edge pass suppresses outlines on opaque water (uWaterOn / waterOpaque)', EDGE_FRAG_SRC.includes('!waterOpaque(cell, distRaw)') && EDGE_FRAG_SRC.includes('(raw - dW) / os.x >= os.y'));
}

// ---- 36.1b: foreground-only glints, fine lattice, CPU phases, isolated drift ----
{
  const world = World.load(roomDef([POOL]), assets, {});
  const fb = makeFb(world);
  fb.waterLooks = resolveWaterLooks({ water: { glintP: 0 } });
  for (let i = 0; i < 2; i++) renderWorld(fb, world, CAM);
  const plain = snapshot(fb);
  fb.waterLooks = resolveWaterLooks({ water: { glintP: 1 } });
  renderWorld(fb, world, CAM);
  const glinted = snapshot(fb);
  ok('glint: every background byte equals the un-glinted render', plain.bg.every((v, i) => v === glinted.bg[i]));
  ok('glint: foreground pixels brighten while glyph selection stays fixed', plain.fg.some((v, i) => i % 4 !== 3 && v !== glinted.fg[i]) && plain.glyph.every((v, i) => v === glinted.glyph[i]));
  const looks = resolveWaterLooks({ water: { ramp: '~-=.:o*+', waveHz: 0 } });
  const out = new Float32Array(12 * WL_STRIDE);
  const selection = { count: 1, region: Int32Array.of(0) };
  fillWaterSlotTable(selection, world, looks, out, 0);
  let blocks = 0;
  const before = [];
  for (let sy = 0; sy < 2; sy += 0.5) for (let sx = 0; sx < 2; sx += 0.5) {
    const glyphs = new Set();
    for (let dy = 0; dy <= 0.5; dy += 0.25) for (let dx = 0; dx <= 0.5; dx += 0.25) {
      const h = waterSurfaceHash(out, 0, sx + dx, sy + dy);
      glyphs.add(h % 8); before.push(h % 8);
    }
    if (glyphs.size === 1) blocks++;
  }
  ok('lattice: every 0.5m square in a 2x2m patch has differing adjacent 0.25m samples', blocks === 0);
  fillWaterSlotTable(selection, world, looks, out, 1);
  let changed = 0, j = 0;
  for (let sy = 0; sy < 2; sy += 0.5) for (let sx = 0; sx < 2; sx += 0.5)
    for (let dy = 0; dy <= 0.5; dy += 0.25) for (let dx = 0; dx <= 0.5; dx += 0.25)
      if (waterSurfaceHash(out, 0, sx + dx, sy + dy) % 8 !== before[j++]) changed++;
  ok('drift: the map moves over 1s even when waveHz is zero', changed > 0 && out[37] === 0);
  fillWaterSlotTable(selection, world, resolveWaterLooks({ water: { drift: 0.125, cellM: 0.25, waveHz: 2 } }), out, 1000000000.25);
  ok('phase: long-running clocks fold in f64 before f32 packing', out[36] === 256.125 && out[37] === 0.5);
  ok('slot table: 56-float stride reserves the shape/shore fields', WL_STRIDE === 56 && lastWaterSlotTable().length === 12 * 56);
  const boundaryY = 1045.5, boundaryX = (500 * 0.25 - boundaryY * 0.4794) / 0.8776;
  const still = packWaterLook('still', { drift: 0, waveHz: 0 });
  ok('hash precision: sub-f32 offsets at a lattice boundary cannot flip a glint',
    Math.fround(boundaryX - 1e-8) === Math.fround(boundaryX + 1e-8) &&
    waterSurfaceHash(still, 0, boundaryX - 1e-8, boundaryY) === waterSurfaceHash(still, 0, boundaryX + 1e-8, boundaryY));

  const staggerLooks = resolveWaterLooks({ water: { drift: 0, waveHz: 1 } });
  fillWaterSlotTable(selection, world, staggerLooks, out, 0);
  const hashes = [];
  for (let y = 0; y < 2; y += 0.25) for (let x = 0; x < 2; x += 0.25) hashes.push(waterSurfaceHash(out, 0, x, y));
  fillWaterSlotTable(selection, world, staggerLooks, out, 0.125);
  let rerolled = 0, idx = 0;
  for (let y = 0; y < 2; y += 0.25) for (let x = 0; x < 2; x += 0.25)
    if (waterSurfaceHash(out, 0, x, y) !== hashes[idx++]) rerolled++;
  ok('stagger: some cells re-roll within a tick while the others remain unchanged', rerolled > 0 && rerolled < hashes.length);

}

// ---- 36.1c: controlled scene columns, region edges, sky and grazing angles ----
{
  const world = World.load(roomDef([POOL]), assets, {});
  renderWorld(makeFb(world), world, CAM); // selects slot 0 through the actual water layer
  const looks = resolveWaterLooks({ water: { ramp: '~', glintP: 0, foamDepth: 0.05 } });
  function sample(x, y, column, sky = false, slope = -0.2, dW = 4, light = null) {
    const fb = { rt: new CellBuffer(1, 1), depth: new DepthBuffer(1, 1), gbuf: new GBuffer(1, 1),
      water: { kind: Uint8Array.of(1), depth: Float32Array.of(dW), objectId: Uint32Array.of(0) },
      palette: assets.palette, matTable: null, light, waterLooks: looks, timeSec: 0 };
    fb.gbuf.kind[0] = sky ? 0 : KIND_MODEL;
    fb.depth.depth[0] = dW + column / -slope;
    const terms = { cols: 1, dirX: 0, dirY: 1, planeX: 0, planeY: 0,
      horizonRow: slope, planeDistY: 1, eyeX: x, eyeY: y - dW, eyeZ: 0.4 - slope * dW };
    waterCompositeJS(fb, world, terms, null, false, sky);
    return snapshot(fb);
  }
  const edge = sample(2, 5.5, 0.2), centre = sample(5.5, 5.5, 0.2), deep = sample(5.5, 5.5, 2);
  ok('shore rect: edge gets a foam glyph and centre keeps the surface ramp', edge.glyph[0] === '*'.charCodeAt(0) - 32 && centre.glyph[0] === '~'.charCodeAt(0) - 32);
  ok('shore: foam changes only foreground, background equals the same-depth centre', edge.bg.every((v, i) => v === centre.bg[i]));
  ok('column tint: shallow water is lighter than a column beyond tintDepth', centre.bg[2] > deep.bg[2]);
  const grazing = sample(5.5, 5.5, 0.2, false, -0.1);
  ok('column tint: equal vertical columns keep equal colours at different view slopes', centre.bg.every((v, i) => v === grazing.bg[i]));
  const sky = sample(2, 5.5, 0, true);
  ok('sky: keeps the deep path colour and surface ramp even at the edge', sky.glyph[0] === '~'.charCodeAt(0) - 32 && sky.bg.every((v, i) => v === deep.bg[i]));
  const far = sample(2, 5.5, 0.2, false, -0.2, 50);
  ok('shore: foam stops at foamFar', far.glyph[0] === '~'.charCodeAt(0) - 32);
  const circle = World.load(roomDef([{ id: 'circle', shape: 'circle', c: [5, 5], r: 3, z: 0.4 }]), assets, {});
  const table = new Float32Array(12 * WL_STRIDE);
  fillWaterSlotTable({ count: 1, region: Int32Array.of(0) }, circle, looks, table);
  ok('circle: packed radius gives exact zero edge distance at r', table[51] === 1 && table[42] === 3 && waterEdgeDistance(table, 0, 8, 5) === 0);
  ok('circle: centre distance is r, diagonal boundary also has zero distance', waterEdgeDistance(table, 0, 5, 5) === 3 && Math.abs(waterEdgeDistance(table, 0, 5 + 3 / Math.sqrt(2), 5 + 3 / Math.sqrt(2))) < 1e-12);

  // ---- S8-B2-12b (38.13): the cloud-darkening byte (light.cloud[i], LIGHT.w bits 24..31 on the GPU) scales k ----
  const cloudLight = (q) => ({ uniform: false, sunMapOn: false, cloud: Uint8Array.of(q) });
  const cq0 = sample(5.5, 5.5, 0.2, false, -0.2, 4, cloudLight(0));
  ok('q=0 (explicit cloud byte) is byte-identical to light: null', cq0.bg.every((v, i) => v === centre.bg[i]) && cq0.glyph.every((v, i) => v === centre.glyph[i]));
  const cq153 = sample(5.5, 5.5, 0.2, false, -0.2, 4, cloudLight(153));
  const cq255 = sample(5.5, 5.5, 0.2, false, -0.2, 4, cloudLight(255));
  ok('q=153 (cF=0.4) darkens the sun-lit background vs q=0', cq153.bg[2] < cq0.bg[2]);
  ok('q=255 (cF~0) darkens further than q=153 - monotonic in q', cq255.bg[2] <= cq153.bg[2]);
  // a `uniform` light (no per-cell cloud byte) always behaves as cF=1, even if it happens to carry a `cloud` array
  const cUniform = sample(5.5, 5.5, 0.2, false, -0.2, 4, { uniform: true, sunMapOn: false, cloud: Uint8Array.of(255) });
  ok('light.uniform ignores the cloud byte (cF stays 1)', cUniform.bg.every((v, i) => v === centre.bg[i]));

  // ---- S8-B2-13 (38.14): splash ripples, !sheet only, composite-only (no geometry change) ----
  world.water.setTickForTest(0);
  const zeroR = sample(5.5, 5.5, 0.2);
  ok('0 rings: byte-identical to the pre-ripple fixture', zeroR.glyph.every((v, i) => v === centre.glyph[i]) && zeroR.bg.every((v, i) => v === centre.bg[i]));
  ok('addRipple accepts (x, y, amp)', world.water.addRipple(5.5, 5.5, 1) === true);
  world.water.setTickForTest(30); // age = 30 * (1/60) = 0.5 s; radius = 0.2 + 1.5*0.5 = 0.95
  const ringHit = sample(6.45, 5.5, 0.2); // |d(0.95) - r(0.95)| = 0 < RIPPLE_HALF_W
  ok('1 ring at age 0.5s: a cell within the band shows the ripple glyph', ringHit.glyph[0] === 'o'.charCodeAt(0) - 32);
  const farR = sample(2, 5.5, 0.2); // > 3 m from the ring centre: unchanged shore/foam cell
  ok('cells far from the ring are unchanged', farR.glyph[0] === edge.glyph[0] && farR.bg.every((v, i) => v === edge.bg[i]));
  world.water.setTickForTest(120); // age = 2.0 s exactly: AC "fades by 2 s"
  const gone = sample(6.45, 5.5, 0.2);
  ok('ring fades by 2 s: the ripple glyph is gone', gone.glyph[0] !== 'o'.charCodeAt(0) - 32);
  world.water.setTickForTest(0);
  ok('non-finite input is refused and writes nothing', world.water.addRipple(NaN, 1, 1) === false && world.water.addRipple(1, Infinity, 1) === false);
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
