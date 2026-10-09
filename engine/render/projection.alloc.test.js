// engine/render/projection.alloc.test.js (PITCHED-ALLOC-01): pitchedTermsInto is bit-identical to the pre-refactor pitchedTerms
// (legacy copy below) over 1e3 random pitched + ortho cameras, and allocates < 8 B/call over 1e5 calls.
// Same re-spawn flags as lighting.alloc.test.js. Self-test: PA_MUTATE=1 boxes per call and MUST fail.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
const newUsed = () => { const s = v8.getHeapSpaceStatistics(); for (let i = 0; i < s.length; i++) if (s[i].space_name === 'new_space') return s[i].space_used_size; return 0; };
const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--min-semi-space-size=64', '--no-concurrent-recompilation'];
const MUTATE = process.env.PA_MUTATE === '1';
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) {
  const res = spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
const { createPitchedTerms, pitchedTerms, pitchedTermsInto, fpVfovDeg, ORTHO_BACK_M, PROJ_NEAR, pitchedProjection, orthoProjection } = await import('./projection.js');

// ---- legacy reference (verbatim pre-refactor body) ----
function legacyPitchedTerms(cam, grid, out) {
  const isOrtho = cam.projection === 'ortho';
  const pLim = isOrtho ? 90 : 89;
  if (cam.pitchDeg < -pLim || cam.pitchDeg > pLim) {
    throw new Error(`pitchedTerms: pitchDeg ${cam.pitchDeg} out of range [-${pLim}, ${pLim}]`);
  }
  if (isOrtho && !(cam.orthoHalfH > 0)) {
    throw new Error(`pitchedTerms: ortho needs orthoHalfH > 0 (got ${cam.orthoHalfH})`);
  }
  const cols = grid.cols, rows = grid.rows;
  const yawRad = (cam.yawDeg * Math.PI) / 180;
  const p = (cam.pitchDeg * Math.PI) / 180;
  const fx = Math.sin(yawRad), fy = -Math.cos(yawRad);
  const cosP = Math.cos(p), sinP = Math.sin(p);

  const fX = cosP * fx, fY = cosP * fy, fZ = sinP;
  const rX = Math.cos(yawRad), rY = Math.sin(yawRad);
  const uX = -sinP * fx, uY = -sinP * fy, uZ = cosP;

  const aspect = (cols * (grid.pxCellW || 1)) / (rows * (grid.pxCellH || 1));
  const vfovDeg = cam.vfovDeg || fpVfovDeg(grid);
  const tanHalfY = Math.tan((vfovDeg * Math.PI) / 180 / 2);
  const tanHalfX = tanHalfY * aspect;

  out.projection = isOrtho ? 'ortho' : 'pitched';
  out.near = PROJ_NEAR;
  out.cols = cols; out.rows = rows; out.aspect = aspect;
  if (isOrtho) {
    // eye = focus - ORTHO_BACK_M*F when the cam carries a focus, else cam.x/y/z is the eye
    const hasF = cam.focusX !== undefined;
    out.eyeX = hasF ? cam.focusX - ORTHO_BACK_M * fX : cam.x;
    out.eyeY = hasF ? cam.focusY - ORTHO_BACK_M * fY : cam.y;
    out.eyeZ = hasF ? cam.focusZ - ORTHO_BACK_M * fZ : cam.z;
  } else {
    out.eyeX = cam.x; out.eyeY = cam.y; out.eyeZ = cam.z;
  }
  out.ortho = isOrtho ? 1 : 0;
  out.halfH = isOrtho ? cam.orthoHalfH : 0;
  out.halfW = isOrtho ? cam.orthoHalfH * aspect : 0;
  out.fX = fX; out.fY = fY; out.fZ = fZ;
  out.rX = rX; out.rY = rY;
  out.uX = uX; out.uY = uY; out.uZ = uZ;
  // ortho: the tanHalf slots carry halfW/halfH (38.19), so a/b below are already metres
  out.tanHalfX = isOrtho ? out.halfW : tanHalfX; out.tanHalfY = isOrtho ? out.halfH : tanHalfY;
  out.yawDeg = cam.yawDeg; out.pitchDeg = cam.pitchDeg; out.vfovDeg = vfovDeg;
  out.cosP = cosP; out.sinP = sinP;

  if (isOrtho) orthoProjection(out, out.M); else pitchedProjection(out, out.M);
  return out;
}

let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const grids = [{ cols: 100, rows: 50, pxCellW: 1, pxCellH: 2 }, { cols: 64, rows: 48, pxCellW: 0, pxCellH: 0 }, { cols: 200, rows: 60, pxCellW: 0, pxCellH: 3 }];
const cams = [];
for (let i = 0; i < 1024; i++) { // one object shape for every camera (as the renderer's cam is), so the call sites stay monomorphic
  const ortho = i & 1;
  cams.push({
    x: rnd() * 200 - 100, y: rnd() * 200 - 100, z: rnd() * 60, yawDeg: rnd() * 720 - 360, pitchDeg: -rnd() * (ortho ? 90 : 89),
    vfovDeg: i % 3 ? 20 + rnd() * 70 : 0,
    projection: ortho ? 'ortho' : 'pitched', orthoHalfH: ortho ? 1 + rnd() * 40 : 0,
    focusX: ortho && i % 4 === 1 ? rnd() * 50 : undefined, focusY: rnd() * 50, focusZ: rnd() * 9,
  });
}
let ok = true;
if (!MUTATE) {
  const same = (a, b) => Object.is(a, b);
  let bad = 0;
  const ref = createPitchedTerms(), got = createPitchedTerms(), wrap = createPitchedTerms();
  for (let i = 0; i < 1000; i++) {
    const g = grids[i % 3], c = cams[i];
    legacyPitchedTerms(c, g, ref); pitchedTermsInto(got, c, g); pitchedTerms(c, g, wrap);
    for (const k of Object.keys(ref)) {
      if (k === 'M') { for (let j = 0; j < 16; j++) if (!same(ref.M[j], got.M[j]) || !same(ref.M[j], wrap.M[j])) bad++; }
      else if (!same(ref[k], got[k]) || !same(ref[k], wrap[k])) bad++;
    }
  }
  console.log(`${bad === 0 ? 'PASS' : 'FAIL'}: pitchedTermsInto / pitchedTerms bit-identical to legacy over 1000 cameras (${bad} diffs)`);
  if (bad) ok = false;
  let threw = false; try { pitchedTermsInto(got, { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -95 }, grids[0]); } catch { threw = true; }
  console.log(`${threw ? 'PASS' : 'FAIL'}: out-of-range pitch still throws`); if (!threw) ok = false;
}
const out = createPitchedTerms(), RING = new Array(64).fill(null);
const N = 1e5;
function run() { for (let i = 0; i < N; i++) { pitchedTermsInto(out, cams[i & 1023], grids[i % 3]); if (MUTATE) RING[i & 63] = [i, i]; } }
run(); run(); global.gc();
const h0 = newUsed(); run(); const b = (newUsed() - h0) / N;
const good = b < 8;
console.log(`${good ? 'PASS' : 'FAIL'}: pitchedTermsInto ${b.toFixed(2)} B/call over ${N} calls (budget 8)`);
ok = ok && good;
if (!MUTATE) {
  const r = spawnSync(process.execPath, [...FLAGS, SELF], { env: { ...process.env, PA_MUTATE: '1' }, encoding: 'utf8' });
  const mutFailed = r.status !== 0 && /FAIL/.test(r.stdout || '');
  console.log(`${mutFailed ? 'PASS' : 'FAIL'}: mutation self-test (per-call allocation is detected)`);
  if (!mutFailed) ok = false;
}
process.exit(ok ? 0 : 1);
