// engine/render/horizonAo.alloc.test.js (TEST-FLAKY-AO-01): the AO pass of lightSurfaces adds ~0 garbage.
// Moved out of lighting.test.js: heapUsed deltas need a deterministic heap, so this file re-spawns itself with the same flags
// as WgCellPipeline.frameAlloc.test.js (big semi-space = no scavenge inside the measurement, sync tier-up, warm-up first).
// Run: node engine/render/horizonAo.alloc.test.js   (self-test: HAO_MUTATE=1 allocates per cell and MUST fail)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
const newUsed = () => { const s = v8.getHeapSpaceStatistics(); for (let i = 0; i < s.length; i++) if (s[i].space_name === 'new_space') return s[i].space_used_size; return 0; };

const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--min-semi-space-size=64', '--no-concurrent-recompilation'];
const MUTATE = process.env.HAO_MUTATE === '1';
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) {
  const res = spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

const { LightSet, lightSurfaces, setLook, makeLightBuffer } = await import('./lighting.js');
const { FACE_U, FACE_S } = await import('./GBuffer.js');

const FLOOR = 0.3570456373959812, WALL = 0.303488791786584;
const rt = { pxCellW: 1, pxCellH: 1 };
const cam = { x: 0, y: 0, z: 2, yawDeg: 0, pitchDeg: -80 };
function makeAoLights(strength) {
  const ls = new LightSet();
  ls.ambient[0] = 0.2; ls.ambient[1] = 0.25; ls.ambient[2] = 0.3;
  if (strength > 0) setLook(ls, { hemi: null, clouds: null, ao: { strength, radiusM: 1.5, bias: 0.1, maxCells: 2 } });
  ls.update(0, null);
  return ls;
}

const RING = new Array(1024).fill(null); // mutation sink (keeps the stores observable)
const n = 60000, CALLS = 8, WARM = 200;
const k6 = new Uint8Array(n).fill(1), f6 = new Uint8Array(n).fill(FACE_U), d6 = new Float32Array(n).fill(FLOOR);
for (let q = 0; q < n; q += 7) { f6[q] = FACE_S; d6[q] = WALL; }
const g6 = { kind: k6, face: f6, aoD: new Float32Array(n), cols: n, rows: 1 };
const lOn = makeAoLights(1), lOff = makeAoLights(0), lb6 = makeLightBuffer(n, 1);
const fb6 = { gbuf: g6, depth: { depth: d6 }, rt, light: lb6 };

// Warm both paths until call sites have tiered up, then measure heapUsed BEFORE gc over CALLS calls (AO-on minus AO-off).
for (let i = 0; i < WARM; i++) { lightSurfaces(fb6, lOn, cam, null); lightSurfaces(fb6, lOff, cam, null); }
function garbagePerCall(ls) {
  global.gc();
  const h0 = newUsed();
  for (let i = 0; i < CALLS; i++) {
    lightSurfaces(fb6, ls, cam, null);
    if (MUTATE && ls === lOn) for (let q = 0; q < n; q++) { RING[q & 1023] = [q, q]; RING[(q + 1) & 1023] = [q, q]; RING[(q + 2) & 1023] = [q, q]; } // per-cell allocation: must blow the budget
  }
  return (newUsed() - h0) / CALLS;
}
garbagePerCall(lOff); garbagePerCall(lOn); // settle round (order effects), second round is measured
const off = garbagePerCall(lOff), on = garbagePerCall(lOn);
const delta = on - off, BUDGET = 262144;
const good = delta < BUDGET;
console.log(`${good ? 'PASS' : 'FAIL'}: AO pass adds ~0 garbage over 60k cells (< 256 KB/call over AO-off): on ${on.toFixed(0)} off ${off.toFixed(0)} delta ${delta.toFixed(0)} B/call`);

if (!MUTATE) {
  const r = spawnSync(process.execPath, [...FLAGS, SELF], { env: { ...process.env, HAO_MUTATE: '1' }, encoding: 'utf8' });
  const mutFailed = r.status !== 0 && /FAIL/.test(r.stdout || '');
  console.log(`${mutFailed ? 'PASS' : 'FAIL'}: mutation self-test (per-cell allocation is detected)`);
  if (!mutFailed) process.exit(1);
}
process.exit(good ? 0 : 1);
