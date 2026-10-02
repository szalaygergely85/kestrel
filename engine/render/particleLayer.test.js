// engine/render/particleLayer.test.js (US-053b, docs/architecture.md 32.1).
// Run: node [--expose-gc] engine/render/particleLayer.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createParticleLayer } from './particleLayer.js';
import { camBasis, projectSprite } from './sprites.js';
import { createParticles } from '../fx/particles.js';
import { D, DEF_STRIDE, MAX_RAMP } from '../fx/emitterDef.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(detail ? `${name} (${detail})` : name); }
}

const RT = { cols: 20, rows: 10, pxCellW: 1, pxCellH: 1 };
const CAM = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 }; // shear: forward = (0,-1), screen-right = (1,0)
const PALETTE = {
  shading: { fgMin: 0.2, fgGamma: 1, fgMaxGain: 2, tint: 1, cutoff: 0 },
  util: { fogFactor: () => 0 }, // no fog, unless a test overrides it
  fog: { interior: { color: 'fogCol' } },
  rgb: { fogCol: [9, 9, 9] },
};
const DARK = { ambient: new Float32Array(3), count: 0, sun: { on: false } }; // ambient 0 -> gain = fgMin = 0.2
const BRIGHT = { ambient: new Float32Array([200, 200, 200]), count: 0, sun: { on: false } }; // gain clamps to fgMaxGain = 2

/** `projectSprite`'s cell for (x,y,z) under the SAME camBasis the layer uses - the oracle for position tests. */
function expectCell(x, y, z, renderer = 'dda', cam = CAM) {
  const cb = camBasis(cam, RT, {}, renderer);
  const ps = {};
  if (!projectSprite(cb, cam, x, y, z, 0, ps)) return null;
  return { col: Math.floor(ps.colCenter), row: Math.floor(ps.feetRow), depth: Math.fround(ps.depth) };
}

/** Minimal fake ParticleSystem exposing exactly what `build()` reads (white-box control over age/life/def/position). */
function fakeDef({ emissive = false, emissiveFog = 0, codes, colors }) {
  return { n: codes.length, codes, colors, emissive, emissiveFog };
}
function fakeSystem(cap, defs, particles, emitters) {
  const defRec = new Float64Array(defs.length * DEF_STRIDE);
  const defGlyphs = new Uint16Array(defs.length * MAX_RAMP);
  const defColors = new Uint8Array(defs.length * MAX_RAMP * 3);
  defs.forEach((d, di) => {
    defRec[di * DEF_STRIDE + D.RAMP_LEN] = d.n;
    defRec[di * DEF_STRIDE + D.EMISSIVE] = d.emissive ? 1 : 0;
    defRec[di * DEF_STRIDE + D.EMISSIVE_FOG] = d.emissiveFog;
    for (let i = 0; i < d.n; i++) {
      defGlyphs[di * MAX_RAMP + i] = d.codes[i];
      const c = d.colors[i];
      defColors[(di * MAX_RAMP + i) * 3] = c[0]; defColors[(di * MAX_RAMP + i) * 3 + 1] = c[1]; defColors[(di * MAX_RAMP + i) * 3 + 2] = c[2];
    }
  });
  const px = new Float64Array(cap), py = new Float64Array(cap), pz = new Float64Array(cap);
  const age = new Int32Array(cap), life = new Int32Array(cap);
  const def = new Uint8Array(cap), em = new Int16Array(cap), alive = new Uint8Array(cap);
  particles.forEach((p, i) => {
    px[i] = p.x; py[i] = p.y; pz[i] = p.z; age[i] = p.age; life[i] = p.life; def[i] = p.def; em[i] = p.em || 0; alive[i] = 1;
  });
  const E = 4;
  const used = new Uint8Array(E), live = new Int32Array(E), ex = new Float64Array(E), ey = new Float64Array(E), ez = new Float64Array(E);
  (emitters || []).forEach((e, s) => { used[s] = 1; live[s] = e.live === undefined ? 1 : e.live; ex[s] = e.x; ey[s] = e.y; ez[s] = e.z; });
  return { cap, px, py, pz, age, life, def, em, alive, defRec, defGlyphs, defColors, DEF_STRIDE, MAX_RAMP, emitters: { used, live, x: ex, y: ey, z: ez } };
}

function cellBytes(layer, col, row) {
  const i = row * RT.cols + col, o = i * 4;
  return { r: layer.part[o], g: layer.part[o + 1], b: layer.part[o + 2], glyph: layer.part[o + 3], z: layer.partZ[i] };
}

// ---- 1. ramp index at age 0, life-2 and life-1 (integer/stepped, no lerp) ----
{
  const life = 8;
  const defA = fakeDef({ codes: [65, 66, 67, 68], colors: [[50, 50, 50], [100, 100, 100], [150, 150, 150], [200, 200, 200]] });
  const pts = [{ x: 0, y: -5, z: 0 }, { x: 1, y: -5, z: 0 }, { x: 2, y: -5, z: 0 }];
  const cells = pts.map((p) => expectCell(p.x, p.y, p.z));
  ok('setup: 3 distinct cells for the ramp-index fixture', new Set(cells.map((c) => `${c.col},${c.row}`)).size === 3);
  const ps = fakeSystem(3, [defA], [
    { ...pts[0], age: 0, life, def: 0 },
    { ...pts[1], age: life - 2, life, def: 0 },
    { ...pts[2], age: life - 1, life, def: 0 },
  ], [{ x: 0, y: -5, z: 0, live: 3 }]);
  const layer = createParticleLayer();
  layer.bind(RT.cols, RT.rows);
  layer.build(ps, CAM, RT, DARK, null, PALETTE, 'dda');
  const gain = 0.2; // DARK ambient -> Lm=0 -> gain = fgMin
  // i = floor(age*n/life): age0->0, age6->floor(6*4/8)=3, age7->floor(7*4/8)=3
  const want = [Math.round(50 * gain), Math.round(200 * gain), Math.round(200 * gain)];
  cells.forEach((c, k) => {
    const got = cellBytes(layer, c.col, c.row);
    ok(`ramp index @ particle ${k} (age ${pts[k] === pts[0] ? 0 : life - (k === 1 ? 2 : 1)})`, got.r === want[k], `got ${got.r} want ${want[k]}`);
  });
}

// ---- 2. skip glyph ' ' (code 32): no write, cell stays empty ----
{
  const defSp = fakeDef({ codes: [65, 32], colors: [[9, 9, 9], [9, 9, 9]] });
  const pt = { x: 0, y: -5, z: 0 };
  const c = expectCell(pt.x, pt.y, pt.z);
  const ps = fakeSystem(1, [defSp], [{ ...pt, age: 1, life: 2, def: 0 }], [{ x: 0, y: -5, z: 0 }]); // i=floor(1*2/2)=1 -> glyph ' '
  const layer = createParticleLayer();
  layer.bind(RT.cols, RT.rows);
  layer.build(ps, CAM, RT, DARK, null, PALETTE, 'dda');
  ok('space glyph: cell left untouched', layer.partZ[c.row * RT.cols + c.col] === 0 && layer.stats.cells === 0);
}

// ---- 3. tie: two particles at the exact same point -> the lower slot wins ----
{
  const defLo = fakeDef({ codes: [65], colors: [[111, 111, 111]] });
  const defHi = fakeDef({ codes: [65], colors: [[222, 222, 222]] });
  const pt = { x: 0, y: -5, z: 0 };
  const c = expectCell(pt.x, pt.y, pt.z);
  const ps = fakeSystem(2, [defLo, defHi], [
    { ...pt, age: 0, life: 10, def: 0 }, // slot 0
    { ...pt, age: 0, life: 10, def: 1 }, // slot 1, same exact point -> exact depth tie
  ], [{ x: 0, y: -5, z: 0, live: 2 }]);
  const layer = createParticleLayer();
  layer.bind(RT.cols, RT.rows);
  layer.build(ps, CAM, RT, DARK, null, PALETTE, 'dda');
  const got = cellBytes(layer, c.col, c.row);
  const gain = 0.2;
  ok('tie: lower slot (slot 0) wins', got.r === Math.round(111 * gain), `got ${got.r}`);
}

// ---- 4. emissive ignores light; non-emissive is gain-shaded like a sprite ----
{
  const defEm = fakeDef({ emissive: true, codes: [65], colors: [[80, 80, 80]] });
  const defLit = fakeDef({ codes: [65], colors: [[80, 80, 80]] });
  const pts = [{ x: 0, y: -5, z: 0 }, { x: 3, y: -5, z: 0 }];
  const cells = pts.map((p) => expectCell(p.x, p.y, p.z));
  const ps = fakeSystem(2, [defEm, defLit], [
    { ...pts[0], age: 0, life: 10, def: 0, em: 0 },
    { ...pts[1], age: 0, life: 10, def: 1, em: 0 },
  ], [{ x: 0, y: -5, z: 0, live: 2 }]);
  const layer = createParticleLayer();
  layer.bind(RT.cols, RT.rows);
  layer.build(ps, CAM, RT, BRIGHT, null, PALETTE, 'dda');
  const em = cellBytes(layer, cells[0].col, cells[0].row);
  const lit = cellBytes(layer, cells[1].col, cells[1].row);
  ok('emissive: raw colour, ignores the bright light', em.r === 80, `got ${em.r}`);
  ok('non-emissive: gain-shaded (brighter under BRIGHT ambient)', lit.r === Math.min(255, 160), `got ${lit.r}`);
}

// ---- 5. pitched and shear cells match projectSprite for the same point ----
{
  const defA = fakeDef({ codes: [65], colors: [[70, 70, 70]] });
  const pt = { x: 1.3, y: -6.2, z: 0.4 };
  for (const [label, renderer, cam] of [
    ['shear', 'dda', CAM],
    ['pitched', 'mesh', { x: 0, y: 0, z: 0, yawDeg: 10, pitchDeg: -15 }],
  ]) {
    const want = expectCell(pt.x, pt.y, pt.z, renderer, cam);
    const ps = fakeSystem(1, [defA], [{ ...pt, age: 0, life: 10, def: 0 }], [{ x: pt.x, y: pt.y, z: pt.z }]);
    const layer = createParticleLayer();
    layer.bind(RT.cols, RT.rows);
    layer.build(ps, cam, RT, DARK, null, PALETTE, renderer);
    const idx = want ? want.row * RT.cols + want.col : -1;
    ok(`${label}: particle lands on the same cell as projectSprite`, want && layer.partZ[idx] !== 0, JSON.stringify(want));
    if (want) ok(`${label}: depth matches projectSprite (f32)`, layer.partZ[idx] === want.depth, `${layer.partZ[idx]} vs ${want.depth}`);
  }
}

// ---- 6. dirty-row union (this frame's touched rows + last frame's wiped rows) ----
{
  const defA = fakeDef({ codes: [65], colors: [[70, 70, 70]] });
  const pt1 = { x: 0, y: -5, z: 0 }; // some row R1
  const pt2 = { x: 0, y: -9, z: -3 }; // a different row R2 (farther + lower)
  const c1 = expectCell(pt1.x, pt1.y, pt1.z), c2 = expectCell(pt2.x, pt2.y, pt2.z);
  ok('setup: the two dirty-row fixture points land on different rows', c1.row !== c2.row);
  const ps1 = fakeSystem(1, [defA], [{ ...pt1, age: 0, life: 10, def: 0 }], [{ x: 0, y: -5, z: 0 }]);
  const ps2 = fakeSystem(1, [defA], [{ ...pt2, age: 0, life: 10, def: 0 }], [{ x: 0, y: -9, z: -3 }]);
  const layer = createParticleLayer();
  layer.bind(RT.cols, RT.rows);
  layer.build(ps1, CAM, RT, DARK, null, PALETTE, 'dda');
  ok('frame 1: minRow/maxRow at the first point\'s row', layer.minRow === c1.row && layer.maxRow === c1.row);
  ok('frame 1: no previous dirty rows yet', layer.prevMaxRow < layer.prevMinRow);
  layer.build(ps2, CAM, RT, DARK, null, PALETTE, 'dda');
  ok('frame 2: minRow/maxRow at the second point\'s row', layer.minRow === c2.row && layer.maxRow === c2.row);
  ok('frame 2: prevMinRow/prevMaxRow cover the first frame\'s wiped row', layer.prevMinRow === c1.row && layer.prevMaxRow === c1.row);
}

// ---- 7. zero allocation over 1000 builds (--expose-gc) ----
{
  const ps = createParticles({ capacity: 2048, seed: 1 });
  const id = ps.defineEmitter('load', {
    rate: 2000, life: [2, 2], speed: [1, 3], spreadDeg: 35, accelZ: 0.4, drag: 1, wind: 0, maxLive: 2048,
    glyphs: '@Oo. ', colors: [[255, 200, 50], [255, 150, 30], [200, 100, 20], [100, 60, 10], [0, 0, 0]],
  });
  const h = ps.createEmitter(id, 0, -5, 0);
  ps.setOn(h, true);
  const layer = createParticleLayer();
  layer.bind(RT.cols, RT.rows);
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 };
  // Warm up JIT AND the pool's steady state (ring recycling at the 2048
  // cap) before measuring - a cold pool still growing toward maxLive churns
  // through emitter/def combinations the JIT hasn't specialised yet, which
  // reads as heap growth that has nothing to do with build()'s own cost.
  for (let i = 0; i < 3000; i++) { ps.step(); layer.build(ps, cam, RT, DARK, null, PALETTE, 'dda'); }
  if (typeof globalThis.gc === 'function') {
    gc(); const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) { ps.step(); layer.build(ps, cam, RT, DARK, null, PALETTE, 'dda'); }
    gc(); const grew = process.memoryUsage().heapUsed - before;
    ok('zero heap growth over 1000 build() calls', grew < 64 * 1024, `${grew} bytes`);
  }

  // ---- budget (warn-only; architecture.md 32.8 item 2): 500 live <= 0.1 ms, 2048 live <= 0.3 ms ----
  function timeBuildAt(targetLive) {
    const sys2 = createParticles({ capacity: 2048, seed: 1 });
    const defId = sys2.defineEmitter('bench', {
      rate: 0, life: [600, 600], speed: [0, 0], box: [2, 2, 0], glyphs: '@', colors: [[200, 200, 200]], maxLive: 2048,
    });
    const hh = sys2.createEmitter(defId, 0, -10, 0);
    sys2.burst(hh, targetLive);
    sys2.step();
    const lay = createParticleLayer();
    lay.bind(RT.cols, RT.rows);
    for (let i = 0; i < 20; i++) lay.build(sys2, cam, RT, DARK, null, PALETTE, 'dda'); // warm up
    const t0 = process.hrtime.bigint();
    const N = 200;
    for (let i = 0; i < N; i++) lay.build(sys2, cam, RT, DARK, null, PALETTE, 'dda');
    const t1 = process.hrtime.bigint();
    return { ms: Number(t1 - t0) / 1e6 / N, live: sys2.stats.live };
  }
  const b500 = timeBuildAt(500);
  const b2048 = timeBuildAt(2048);
  console.log(`[particleLayer] build() budget: ${b500.live} live = ${b500.ms.toFixed(4)} ms, ${b2048.live} live = ${b2048.ms.toFixed(4)} ms`);
  ok('budget (warn-only): 500 live build() <= 0.1 ms', true, `${b500.ms.toFixed(4)} ms (bar 0.1 ms, informational)`);
  ok('budget (warn-only): 2048 live build() <= 0.3 ms', true, `${b2048.ms.toFixed(4)} ms (bar 0.3 ms, informational)`);
}

console.log(`\n[particleLayer.test.js] ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((m) => console.error(`  FAIL: ${m}`)); process.exit(1); }
