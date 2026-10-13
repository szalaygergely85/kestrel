// engine/render/lighting.alloc.test.js (LIGHT-ALLOC-01): the JS-twin lightSurfaces allocates ~0 B/cell on the base path
// (AO off) incl. point lights, sun and cloud-shadow terms, and its output is byte-identical to the pre-refactor code (hash).
// Same re-spawn flags as horizonAo.alloc.test.js. Self-test: LA_MUTATE=1 allocates per cell and MUST fail.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
const newUsed = () => { const s = v8.getHeapSpaceStatistics(); for (let i = 0; i < s.length; i++) if (s[i].space_name === 'new_space') return s[i].space_used_size; return 0; };
const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--min-semi-space-size=64', '--no-concurrent-recompilation'];
const MUTATE = process.env.LA_MUTATE === '1';
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) {
  const res = spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
const { LightSet, lightSurfaces, setLook, makeLightBuffer } = await import('./lighting.js');
const { FACE_U, FACE_S } = await import('./GBuffer.js');

const FLOOR = 0.3570456373959812, WALL = 0.303488791786584;
const rt = { pxCellW: 1, pxCellH: 1 };
const cam = { x: 0, y: 0, z: 2, yawDeg: 20, pitchDeg: -80 };
function makeScene(rich) {
  const ls = new LightSet();
  ls.ambient[0] = 0.2; ls.ambient[1] = 0.25; ls.ambient[2] = 0.3;
  if (rich) {
    setLook(ls, { hemi: null, ao: null, clouds: { seed: 7, wind: [1, 0.5], shadow: { strength: 0.6, scale: 0.05, cover: 0.5, soft: 0.2, deckH: 60 } } });
    ls.count = 2;
    for (let i = 0; i < 2; i++) {
      ls.on[i] = 1; ls.visW[i] = 0; ls.visH[i] = 0;
      ls.pos[i * 4] = 0.1 * i; ls.pos[i * 4 + 1] = 0.05; ls.pos[i * 4 + 2] = 1; ls.pos[i * 4 + 3] = 4;
      ls.col[i * 4] = 1; ls.col[i * 4 + 1] = 0.8; ls.col[i * 4 + 2] = 0.5;
    }
    ls.sun.on = true; ls.sun.dir[0] = 0.3; ls.sun.dir[1] = 0.2; ls.sun.dir[2] = 0.9; ls.sun.col.set([1, 0.9, 0.8]);
  }
  ls.update(0, null);
  return ls;
}
const RING = new Array(1024).fill(null);
const n = 60000, CALLS = 8, WARM = 200;
const k6 = new Uint8Array(n).fill(1), f6 = new Uint8Array(n).fill(FACE_U), d6 = new Float32Array(n).fill(FLOOR);
for (let q = 0; q < n; q += 7) { f6[q] = FACE_S; d6[q] = WALL; }
for (let q = 0; q < n; q += 11) d6[q] = FLOOR * (1 + (q % 13) / 20);
const g6 = { kind: k6, face: f6, aoD: new Float32Array(n), cols: n, rows: 1 };
const lb6 = makeLightBuffer(n, 1);
const fb6 = { gbuf: g6, depth: { depth: d6 }, rt, light: lb6, timeSec: 3 };

function hashRgb() { // FNV-1a over the float bits of rgb
  const u = new Uint32Array(lb6.rgb.buffer, lb6.rgb.byteOffset, lb6.rgb.length); let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const EXPECT = { base: 0x77841da5, rich: 0x0e769901 }; // FNV hashes of the PRE-refactor output (computed before LIGHT-ALLOC-01)
const scenes = { base: makeScene(false), rich: makeScene(true) };
for (let i = 0; i < WARM; i++) { lightSurfaces(fb6, scenes.base, cam, null); lightSurfaces(fb6, scenes.rich, cam, null); }
function garbagePerCall(ls) {
  global.gc();
  const h0 = newUsed();
  for (let i = 0; i < CALLS; i++) {
    lightSurfaces(fb6, ls, cam, null);
    if (MUTATE) for (let q = 0; q < n; q++) { RING[q & 1023] = [q, q]; RING[(q + 1) & 1023] = [q, q]; RING[(q + 2) & 1023] = [q, q]; }
  }
  return (newUsed() - h0) / CALLS;
}
garbagePerCall(scenes.base); garbagePerCall(scenes.rich);
const BUDGET = 262144 / CALLS; // 256 KB per 8 calls
let ok = true;
for (const k of ['base', 'rich']) {
  const b = garbagePerCall(scenes[k]);
  lightSurfaces(fb6, scenes[k], cam, null);
  const h = hashRgb();
  const hashOk = MUTATE || EXPECT[k] === null || h === EXPECT[k];
  const good = b < BUDGET && hashOk;
  ok = ok && good;
  console.log(`${good ? 'PASS' : 'FAIL'}: lightSurfaces ${k}: ${b.toFixed(0)} B/call (${(b / n).toFixed(2)} B/cell, budget ${BUDGET}), hash 0x${h.toString(16)}${hashOk ? '' : ' MISMATCH'}`);
}
if (!MUTATE) {
  const r = spawnSync(process.execPath, [...FLAGS, SELF], { env: { ...process.env, LA_MUTATE: '1' }, encoding: 'utf8' });
  const mutFailed = r.status !== 0 && /FAIL/.test(r.stdout || '');
  console.log(`${mutFailed ? 'PASS' : 'FAIL'}: mutation self-test (per-cell allocation is detected)`);
  if (!mutFailed) ok = false;
}
process.exit(ok ? 0 : 1);
