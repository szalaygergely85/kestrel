// US-141a (architecture.md 35.4): flow look - slot flow block, streak hash (linear + radial), JS composite vs the GLSL twin
// expression, still pools unchanged, zero allocation. Node ESM.
// Run: node --expose-gc engine/render/waterFlow.test.js
import { World } from '../world/World.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { makeLightBuffer } from './lighting.js';
import { hashFastU } from './terrainShade.js';
import {
  WL_STRIDE, WATER_FLOW_SALT, FLOW_MIN, packWaterLook, resolveWaterLooks, fillWaterSlotTable, flowStreakHit, diamondAngle,
} from './waterLook.js';
import { WATER_COMPOSITE_FRAG_SRC } from './gpu/glsl/waterComposite.frag.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import '../../design/water-looks.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

const COLS = 80, ROWS = 40;
const POOL = { id: 'pool', shape: 'rect', rect: [2, 2, 9, 9], z: 0.4 };
const CAM = { x: 5.5, y: 5.5, z: 1.6, yawDeg: 40, pitchDeg: -25, projection: 'shear' };
const roomDef = (water) => ({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [], water });
function makeFb(world, looks) {
  const matTable = bindShading(assets.palette, assets.detailPass, 1);
  if (world.structures[0]) bindLevel(matTable, world.structures[0].level);
  return {
    rt: new CellBuffer(COLS, ROWS), depth: new DepthBuffer(COLS, ROWS), palette: assets.palette,
    gbuf: new GBuffer(COLS, ROWS), matTable, detailPass: null, lights: null, light: makeLightBuffer(COLS, ROWS),
    timeSec: 0, loop: { stats: {} }, renderer: 'mesh', waterLooks: looks,
  };
}
const cellsOf = (fb) => fb.rt.cells || fb.rt;
const HASH = 35 - 32; // '#' - 32 (a glyph no other water glyph uses)
const looks = resolveWaterLooks({ water: { streak: '#', streakK: 0.5 } });
const sel = (n) => ({ count: n, region: Int32Array.from([0, 1, 2, 3]) });
const worldOf = (list) => World.load(roomDef(list), assets, {});

// ---- 1. look: defaults, designer looks, validation ----
{
  const row = packWaterLook('d', null);
  ok('look: defaults streak "-" (13), L 1, W 0.35, K 0.7 at 24..27', row[24] === 45 - 32 && row[25] === 1 && Math.abs(row[26] - 0.35) < 1e-6 && Math.abs(row[27] - 0.7) < 1e-6 && row.length === WL_STRIDE);
  const L = globalThis.ASSETS.waterLooks;
  let allOk = true;
  for (const n of Object.keys(L)) { const r = packWaterLook(n, L[n]); if (r[24] !== L[n].streak.charCodeAt(0) - 32 || Math.abs(r[25] - L[n].streakLen) > 1e-6 || Math.abs(r[27] - L[n].streakK) > 1e-6) allOk = false; }
  ok('look: the designer looks (design/water-looks.js) carry their streak fields into the row', allOk && Object.keys(L).length >= 3);
  ok('look: bad streak / len / W / K throw naming the look',
    ['streak', 'streakLen', 'streakW', 'streakK'].every((k, i) => { const e = threw(() => packWaterLook('bogus', { [k]: [' ', 0, -1, 2][i] })); return e && e.includes('bogus') && e.includes(k); }));
}

// ---- 2. slot flow block ----
{
  const world = worldOf([
    { id: 'a', shape: 'rect', rect: [2, 2, 9, 9], z: 0.4, flow: [3, 4] },
    { id: 'b', shape: 'circle', c: [20, 20], r: 5, z: 0.4, flow: [1, 0], flowRadial: -2 },
    { id: 'c', shape: 'rect', rect: [30, 2, 39, 9], z: 0.4, flow: [0.04, 0] },
    { id: 'd', shape: 'rect', rect: [50, 2, 59, 9], z: 0.4 },
  ]);
  const out = new Float32Array(12 * WL_STRIDE);
  fillWaterSlotTable(sel(4), world, looks, out, 0.5);
  const R = (s) => out.subarray(s * WL_STRIDE + 28, s * WL_STRIDE + 36);
  ok('slot a: linear, fhat (0.6, 0.8), |f| 5, o = 5 * 0.5', R(0)[4] === 1 && Math.abs(R(0)[0] - 0.6) < 1e-6 && Math.abs(R(0)[1] - 0.8) < 1e-6 && R(0)[2] === 5 && R(0)[3] === 2.5);
  ok('slot b: radial wins, mode 2, |s| 2, o = -2 * 0.5, centre, angular count 4r/W', R(1)[4] === 2 && R(1)[2] === 2 && R(1)[3] === -1 && R(1)[5] === 20 && R(1)[6] === 20 && R(1)[7] === Math.round(20 / 0.35));
  ok('slot c: |f| < 0.05 is still water (mode 0); slot d too', R(2)[4] === 0 && R(3)[4] === 0 && FLOW_MIN === 0.05);
  fillWaterSlotTable(sel(1), world, looks, out, 1e6);
  ok('o is folded mod 1024 L (f64) for a huge timeSec', Math.abs(R(0)[3]) < 1024);
}

// ---- 3. streak hash behaviour (JS) ----
{
  const t = new Float32Array(WL_STRIDE);
  t[25] = 1; t[26] = 0.35; t[27] = 0.7; t[28] = 1; t[29] = 0; t[30] = 2; t[32] = 1; // flows +x at 2 m/s
  const hits = (o, ox = 0, oy = 0) => { t[31] = o; let s = ''; for (let i = 0; i < 400; i++) s += flowStreakHit(t, 0, ox + (i % 20) * 0.5 + 0.1, oy + Math.floor(i / 20) * 0.35 + 0.1) ? '1' : '0'; return s; };
  const base = hits(0);
  let n1 = 0; for (const c of base) n1 += c === '1' ? 1 : 0;
  ok('streak density follows streakK (~30 % of cells)', n1 > 400 * 0.18 && n1 < 400 * 0.42, `${n1}/400`);
  ok('advection: offset o shifts the pattern downstream by o metres (x - o)', hits(3, 0) === hits(0, -3) && hits(0.5) !== base);
  ok('the hash is periodic in o (1024 L): the wrap of o is seamless', hits(1024) === base && hits(-1024) === base);
  t[32] = 0;
  ok('mode 0 (still) never streaks', !hits(0).includes('1'));
  // radial: outward travel for +s
  t[32] = 2; t[33] = 0; t[34] = 0; t[35] = 20; t[30] = 1;
  const ring = (o) => { t[31] = o; let s = ''; for (let i = 0; i < 300; i++) s += flowStreakHit(t, 0, 0.5 + i * 0.1, 0) ? '1' : '0'; return s; };
  const r0 = ring(0);
  ok('radial: a streak at distance a moves to a + o (outward for + speed)', ring(2).slice(20) === r0.slice(0, 280) && r0.includes('1'));
  ok('diamond angle: quadrants 0..4, monotone, no NaN at the origin',
    diamondAngle(1, 0) === 0 && diamondAngle(0, 1) === 1 && diamondAngle(-1, 0) === 2 && diamondAngle(0, -1) === 3 && diamondAngle(0, 0) === 0);
}

// ---- 4. JS expression == GLSL expression (f32 emulation of the shader text) ----
{
  const S = WATER_COMPOSITE_FRAG_SRC;
  ok('glsl: the streak block repeats the 35.4 expressions in the JS order',
    S.includes(`hashFastU(ia & 1023, int(fib) & 1023, ${WATER_FLOW_SALT})`) && S.includes('fa = P.x * r7.x + P.y * r7.y;') && S.includes('fib = floor((-P.x * r7.y + P.y * r7.x) / r6.z);') &&
    S.includes('int ia = int(floor((fa - r7.w) / r6.y));') && S.includes('> r6.w) glyph = r6.x;') && S.includes('float diamondAngle(') && S.includes('diamondAngle(ddx, ddy) * 0.25 * r8.w'));
  const f32 = Math.fround;
  // transcription of the GLSL (every operation rounded to f32) - the table row is the same Float32Array on both sides
  const glsl = (t, px, py) => {
    const mode = t[32]; if (!(mode > 0.5)) return false;
    let fa, fib;
    if (mode < 1.5) { fa = f32(f32(px * t[28]) + f32(py * t[29])); fib = Math.floor(f32(f32(f32(-px * t[29]) + f32(py * t[28])) / t[26])); }
    else {
      const ddx = f32(px - t[33]), ddy = f32(py - t[34]);
      fa = f32(Math.sqrt(f32(f32(ddx * ddx) + f32(ddy * ddy))));
      fib = Math.min(Math.floor(f32(f32(diamondAngle(ddx, ddy) * 0.25) * t[35])), t[35] - 1);
    }
    const ia = Math.floor(f32(f32(fa - t[31]) / t[25]));
    return (hashFastU(ia & 1023, fib & 1023, WATER_FLOW_SALT) >>> 8) * (1 / 16777216) > t[27];
  };
  const T = new Float32Array(WL_STRIDE);
  T[25] = 1; T[26] = 0.35; T[27] = 0.6;
  let agree = 0, total = 0;
  for (const cfg of [[1, 0.8, 0.6, 3, 2.7, 0, 0, 0], [1, -0.28, 0.96, 6, 11.3, 0, 0, 0], [2, 0, 0, 4, -3.2, 12, 8, 57]]) {
    T[32] = cfg[0]; T[28] = cfg[1]; T[29] = cfg[2]; T[30] = cfg[3]; T[31] = cfg[4]; T[33] = cfg[5]; T[34] = cfg[6]; T[35] = cfg[7];
    for (let i = 0; i < 4000; i++) { const px = 5 + (i % 63) * 0.173, py = 3 + Math.floor(i / 63) * 0.211; total++; if (flowStreakHit(T, 0, px, py) === glsl(T, px, py)) agree++; }
  }
  ok('twin parity: JS (f64 point) vs the f32 GLSL transcription agree on >= 99.5 % of points', agree / total >= 0.995, `${agree}/${total}`);
}

// ---- 5. rendered composite ----
{
  const flowing = worldOf([{ ...POOL, flow: [2, 0] }]);
  const still = worldOf([POOL]);
  const stillFlow0 = worldOf([{ ...POOL, flow: [0, 0] }]);
  const count = (fb) => { const g = cellsOf(fb).glyphIdx; let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === HASH) n++; return n; };
  const render = (w, timeSec) => { const fb = makeFb(w, looks); fb.timeSec = timeSec; renderWorld(fb, w, CAM); return fb; };
  const a = render(flowing, 0), b = render(flowing, 0.5), s = render(still, 0), s0 = render(stillFlow0, 0);
  ok('render: flowing water shows streak glyphs, still water none', count(a) > 15 && count(s) === 0, `${count(a)} / ${count(s)}`);
  ok('render: streaks run (frame at t = 0.5 differs from t = 0)', cellsOf(a).glyphIdx.some((g, i) => g !== cellsOf(b).glyphIdx[i]) && count(b) > 15);
  const gs = cellsOf(s).glyphIdx, g0 = cellsOf(s0).glyphIdx, fs = cellsOf(s).fg, f0 = cellsOf(s0).fg;
  let same = true; for (let i = 0; i < gs.length; i++) if (gs[i] !== g0[i]) same = false; for (let i = 0; i < fs.length; i++) if (fs[i] !== f0[i]) same = false;
  ok('render: a pool with flow [0,0] is identical to a pool without flow (still pools unchanged)', same);
  const fast = worldOf([{ ...POOL, flow: [6, 0] }]);
  ok('render: 6 m/s differs from 2 m/s at the same time', cellsOf(render(fast, 1)).glyphIdx.some((g, i) => g !== cellsOf(render(flowing, 1)).glyphIdx[i]));

  if (typeof globalThis.gc === 'function') {
    const fb = makeFb(flowing, looks), cam = { ...CAM };
    for (let f = 0; f < 30; f++) { fb.timeSec = f * 0.016; renderWorld(fb, flowing, cam); }
    globalThis.gc();
    const m0 = process.memoryUsage().heapUsed;
    for (let f = 0; f < 300; f++) { fb.timeSec = f * 0.016; cam.yawDeg = 40 + (f % 20); renderWorld(fb, flowing, cam); }
    globalThis.gc();
    const grow = process.memoryUsage().heapUsed - m0;
    ok('zero allocation: 300 flowing-water frames grow the heap by < 256 KB', grow < 256 * 1024, `${(grow / 1024).toFixed(0)} KB`);
  } else console.log('(skipped heap check: run with --expose-gc)');
}

console.log(`waterFlow(render).test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((x) => console.error('FAIL:', x)); process.exit(1); }
