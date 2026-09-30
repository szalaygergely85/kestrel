// engine/render/stable.test.js (US-073 step 1, docs/backlog.md PC-B QUEUE 3
// item 13, docs/architecture.md 25.6). Synthetic 2-frame buffers per
// history-off rule, a baseline accept-history case (glyph hysteresis +
// fg/bg blend/snap), and a scripted strafe sequence showing the stabilized
// output changes fewer glyphs frame-to-frame than the raw (unstabilized)
// input. Zero-allocation gate on repeated calls (`--expose-gc`).
// Run: node engine/render/stable.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stabilizeCells, YAW_DISABLE_DEG } from './stable.js';
import { KIND_NONE, KIND_WALL, KIND_MODEL } from './GBuffer.js';
import { projTerms, unprojectCell } from './projection.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a uniform StableFrame (every cell the same), with per-cell overrides. */
function makeFrame(cols, rows, defaults, overrides = {}) {
  const n = cols * rows;
  const f = {
    cols, rows,
    glyph: new Uint16Array(n).fill(defaults.glyph ?? 0),
    level: new Uint8Array(n).fill(defaults.level ?? defaults.glyph ?? 0),
    fg: new Uint32Array(n).fill(defaults.fg ?? 0),
    bg: new Uint32Array(n).fill(defaults.bg ?? 0),
    kind: new Uint8Array(n).fill(defaults.kind ?? KIND_WALL),
    planeId: new Int32Array(n).fill(defaults.planeId ?? 1),
    u: new Float32Array(n).fill(defaults.u ?? 0),
    v: new Float32Array(n).fill(defaults.v ?? 0),
    z: new Float32Array(n).fill(defaults.z ?? 5),
    rule: new Uint8Array(n).fill(defaults.rule ?? 0),
    playing: new Uint8Array(n).fill(defaults.playing ?? 0),
    detail: new Float32Array(n).fill(defaults.detail ?? 16),
  };
  for (const [field, perCell] of Object.entries(overrides)) {
    for (const [idx, val] of Object.entries(perCell)) f[field][idx] = val;
  }
  return f;
}

function makeOut(cols, rows) {
  const n = cols * rows;
  return { glyph: new Uint16Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n) };
}

const CAM0 = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0, cols: 1, rows: 1 };

// ---------------------------------------------------------------------------
// 1. Baseline accept-history case: identical camera both frames (a pure
// round-trip identity of stabilizeCells' internal reprojection algebra,
// true for ANY chosen z - see stable.js's own doc comment), so history is
// always geometrically eligible; only the per-cell rules below are exercised.
// ---------------------------------------------------------------------------

{
  const prev = makeFrame(1, 1, { glyph: 10, fg: 0x102030, bg: 0, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { glyph: 11, fg: 0x203040, bg: 0, u: 0.5, v: 0.5 });
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, CAM0, out);
  ok('glyph within one ramp level: keeps previous glyph', out.glyph[0] === 10, `got ${out.glyph[0]}`);
}
{
  const prev = makeFrame(1, 1, { glyph: 10, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { glyph: 13, u: 0.5, v: 0.5 });
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, CAM0, out);
  ok('glyph beyond one ramp level: snaps to current glyph', out.glyph[0] === 13, `got ${out.glyph[0]}`);
}
// ARCH CHANGES (2026-09-29 opus batch 2, item 2): `level` (not raw `glyph`
// codes) decides the "one ramp level" hysteresis - real glyph codes are NOT
// ramp-ordered, so a small `level` delta with a large `glyph` delta must
// still keep history, and vice versa.
{
  // level differs by 1 (within one ramp level) but glyph codes are far apart
  // (not ramp-ordered) - history must still be kept (the OLD glyph-diff rule
  // would have wrongly snapped here: |97 - 42| = 55 > 1).
  const prev = makeFrame(1, 1, { glyph: 42, level: 5, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { glyph: 97, level: 6, u: 0.5, v: 0.5 });
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, CAM0, out);
  ok('level within one ramp level keeps previous glyph even when raw glyph codes are far apart',
    out.glyph[0] === 42, `got ${out.glyph[0]}`);
}
{
  // level differs by 2 (beyond one ramp level) but glyph codes are adjacent
  // (not ramp-ordered) - history must be rejected (the OLD glyph-diff rule
  // would have wrongly kept history here: |43 - 42| = 1 <= 1).
  const prev = makeFrame(1, 1, { glyph: 42, level: 5, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { glyph: 43, level: 7, u: 0.5, v: 0.5 });
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, CAM0, out);
  ok('level beyond one ramp level snaps to current glyph even when raw glyph codes are adjacent',
    out.glyph[0] === 43, `got ${out.glyph[0]}`);
}
{
  // All channels differ by 16 (<=48): full mix(prev,cur,0.5).
  const prev = makeFrame(1, 1, { fg: 0x102030, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { fg: 0x203040, u: 0.5, v: 0.5 });
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, CAM0, out);
  ok('fg/bg blend when every channel within snap threshold', out.fg[0] === 0x182838, `got ${out.fg[0].toString(16)}`);
}
{
  // R differs by 239 (>48, snaps to cur's R); G/B differ by 32 (<=48, blend).
  const prev = makeFrame(1, 1, { fg: 0x102030, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { fg: 0xFF4050, u: 0.5, v: 0.5 });
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, CAM0, out);
  ok('fg channel beyond snap threshold snaps independently of other channels', out.fg[0] === 0xFF3040, `got ${out.fg[0].toString(16)}`);
}
{
  // kind/planeId mismatch: history rejected even with identical camera and matching u/v.
  const prev = makeFrame(1, 1, { glyph: 10, kind: KIND_WALL, planeId: 1, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { glyph: 11, kind: KIND_WALL, planeId: 2, u: 0.5, v: 0.5 });
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, CAM0, out);
  ok('planeId mismatch rejects history', out.glyph[0] === 11, `got ${out.glyph[0]}`);
}
{
  // u/v drift beyond 0.5/detail: history rejected.
  const prev = makeFrame(1, 1, { glyph: 10, u: 0.0, v: 0.0, detail: 16 });
  const cur = makeFrame(1, 1, { glyph: 11, u: 0.9, v: 0.0, detail: 16 }); // dUV = 0.9 >> 0.5/16
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, CAM0, out);
  ok('UV drift beyond 0.5/detail rejects history', out.glyph[0] === 11, `got ${out.glyph[0]}`);
}

// ---------------------------------------------------------------------------
// 2. History-off rules (25.6), one synthetic 2-frame buffer per rule.
// ---------------------------------------------------------------------------

{
  // Yaw change > 3 deg: whole frame falls back to `cur` even though the
  // per-cell geometry would otherwise accept history.
  const prev = makeFrame(1, 1, { glyph: 10, fg: 0x102030, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { glyph: 11, fg: 0x203040, u: 0.5, v: 0.5 });
  const camB = { ...CAM0, yawDeg: YAW_DISABLE_DEG + 1 };
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, camB, out);
  ok('yaw change > 3 deg disables history for the whole frame',
    out.glyph[0] === 11 && out.fg[0] === 0x203040, `glyph=${out.glyph[0]} fg=${out.fg[0].toString(16)}`);
}
{
  const prev = makeFrame(1, 1, { glyph: 10, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { glyph: 11, u: 0.5, v: 0.5 });
  const camB = { ...CAM0, teleport: true };
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, camB, out);
  ok('teleport disables history for the whole frame', out.glyph[0] === 11, `got ${out.glyph[0]}`);
}
{
  // setGrid, explicit flag.
  const prev = makeFrame(1, 1, { glyph: 10, u: 0.5, v: 0.5 });
  const cur = makeFrame(1, 1, { glyph: 11, u: 0.5, v: 0.5 });
  const camB = { ...CAM0, gridChanged: true };
  const out = makeOut(1, 1);
  stabilizeCells(prev, cur, CAM0, camB, out);
  ok('setGrid (explicit flag) disables history for the whole frame', out.glyph[0] === 11, `got ${out.glyph[0]}`);
}
{
  // setGrid, implicit via a resolution change between prev and cur.
  const prev = makeFrame(1, 1, { glyph: 10, u: 0.5, v: 0.5 });
  const cur = makeFrame(2, 1, { glyph: 11, u: 0.5, v: 0.5 });
  const camPrev = { ...CAM0, cols: 1, rows: 1 };
  const camCur = { ...CAM0, cols: 2, rows: 1 };
  const out = makeOut(2, 1);
  stabilizeCells(prev, cur, camPrev, camCur, out);
  ok('setGrid (resolution change) disables history for the whole frame',
    out.glyph[0] === 11 && out.glyph[1] === 11, `got [${out.glyph[0]}, ${out.glyph[1]}]`);
}
{
  // Edge cells (rule != 0): per-cell, not global - cell 0 is interior and
  // blends, cell 1 is an edge cell and is always recomputed.
  const camB = { ...CAM0, cols: 2, rows: 1 };
  const prev = makeFrame(2, 1, { glyph: 10, u: 0.5, v: 0.5 });
  const cur = makeFrame(2, 1, { glyph: 11, u: 0.5, v: 0.5 }, { rule: { 1: 1 } });
  const out = makeOut(2, 1);
  stabilizeCells(prev, cur, camB, camB, out);
  ok('edge cell (rule != 0) is always recomputed while its neighbour blends',
    out.glyph[0] === 10 && out.glyph[1] === 11, `got [${out.glyph[0]}, ${out.glyph[1]}]`);
}
{
  // Kind-8 cells of playing animations: per-cell, not global.
  const camB = { ...CAM0, cols: 2, rows: 1 };
  const prev = makeFrame(2, 1, { glyph: 10, kind: KIND_MODEL, u: 0.5, v: 0.5 });
  const cur = makeFrame(2, 1, { glyph: 11, kind: KIND_MODEL, u: 0.5, v: 0.5 }, { playing: { 1: 1 } });
  const out = makeOut(2, 1);
  stabilizeCells(prev, cur, camB, camB, out);
  ok('kind-8 cell mid-clip (playing) is always recomputed while its non-playing neighbour blends',
    out.glyph[0] === 10 && out.glyph[1] === 11, `got [${out.glyph[0]}, ${out.glyph[1]}]`);
}
// ARCH CHANGES (2026-09-29 opus batch 2, item 3): sky (kind===KIND_NONE) and
// non-finite/<=0 `z` cells are always recomputed - per-cell, not global.
{
  const camB = { ...CAM0, cols: 2, rows: 1 };
  const prev = makeFrame(2, 1, { glyph: 10, kind: KIND_NONE, u: 0.5, v: 0.5 });
  const cur = makeFrame(2, 1, { glyph: 11, kind: KIND_NONE, u: 0.5, v: 0.5 });
  const out = makeOut(2, 1);
  stabilizeCells(prev, cur, camB, camB, out);
  ok('sky cell (kind===KIND_NONE) is always recomputed', out.glyph[0] === 11, `got ${out.glyph[0]}`);
}
{
  // Cell 0: non-finite z (NaN). Cell 1: z <= 0. Both always recomputed; a
  // normal cell 2 (default z=5) still blends as the control.
  const camB = { ...CAM0, cols: 3, rows: 1 };
  const prev = makeFrame(3, 1, { glyph: 10, u: 0.5, v: 0.5 });
  const cur = makeFrame(3, 1, { glyph: 11, u: 0.5, v: 0.5 }, { z: { 0: NaN, 1: 0 } });
  const out = makeOut(3, 1);
  stabilizeCells(prev, cur, camB, camB, out);
  ok('non-finite z is always recomputed', out.glyph[0] === 11, `got ${out.glyph[0]}`);
  ok('z <= 0 is always recomputed', out.glyph[1] === 11, `got ${out.glyph[1]}`);
  ok('control cell with a normal z still blends', out.glyph[2] === 10, `got ${out.glyph[2]}`);
}

// ---------------------------------------------------------------------------
// 3. Scripted strafe sequence: fewer changed glyphs with stabilization than
// without, on a synthetic scene with per-frame dither flicker.
// ---------------------------------------------------------------------------

{
  const COLS = 48, ROWS = 24;
  const FRAMES = 24;
  const WALL_Y = 0; // camera at y=12 looking toward -Y (yawDeg=0): wall must be "ahead", i.e. at smaller y
  const PLANE_ID = 777;

  /** Builds frame `t`'s raw (unstabilized) StableFrame for a fronto-parallel
   * wall at y=WALL_Y, camera strafing sideways. Glyph = a smooth function of
   * the world hit point plus an ordered-dither term that flips some cells by
   * exactly one ramp level every frame even though the true surface value is
   * static - the flicker source temporal stability exists to smooth. */
  function buildFrame(t, cam) {
    const terms = projTerms(cam, { cols: COLS, rows: ROWS }, {});
    const f = makeFrame(COLS, ROWS, { kind: KIND_WALL, planeId: PLANE_ID, rule: 0, playing: 0, detail: 1 });
    const P = [0, 0, 0];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = row * COLS + col;
        const cameraX = (2 * (col + 0.5)) / COLS - 1;
        const rayDirY = terms.dirY + terms.planeY * cameraX;
        const dist = (WALL_Y - terms.eyeY) / rayDirY;
        unprojectCell(terms, col, row, dist, P);
        f.z[i] = dist;
        f.u[i] = P[0];
        f.v[i] = P[2];
        const base = 4 + Math.round(((Math.sin(P[0] * 0.7) + Math.cos(P[2] * 0.9)) * 0.5 + 0.5) * 8); // 4..12
        const dither = ((col + row + t) % 3 === 0) ? 1 : 0; // flips ~1/3 of cells every frame
        f.glyph[i] = base + dither;
        f.level[i] = f.glyph[i]; // ramp-ordered by construction in this synthetic scene
        const shade = 40 + Math.round(((Math.sin(P[0] * 0.5) + 1) * 0.5) * 60); // 40..100
        f.fg[i] = (shade << 16) | (shade << 8) | shade;
        f.bg[i] = 0;
      }
    }
    return f;
  }

  const cams = [];
  const frames = [];
  for (let t = 0; t < FRAMES; t++) {
    const cam = { x: t * 0.03, y: 12, z: 1.6, yawDeg: 0, pitchDeg: 0, cols: COLS, rows: ROWS };
    cams.push(cam);
    frames.push(buildFrame(t, cam));
  }

  let rawChanges = 0;
  let stabChanges = 0;
  let prevOutGlyph = frames[0].glyph.slice();
  let prevOutFg = frames[0].fg.slice();
  let prevOutBg = frames[0].bg.slice();
  const out = makeOut(COLS, ROWS);

  for (let t = 1; t < FRAMES; t++) {
    const prevGeom = frames[t - 1];
    const historyFrame = {
      cols: COLS, rows: ROWS,
      kind: prevGeom.kind, planeId: prevGeom.planeId, u: prevGeom.u, v: prevGeom.v,
      z: prevGeom.z, rule: prevGeom.rule, playing: prevGeom.playing, detail: prevGeom.detail,
      glyph: prevOutGlyph, level: prevOutGlyph, fg: prevOutFg, bg: prevOutBg,
    };
    stabilizeCells(historyFrame, frames[t], cams[t - 1], cams[t], out);

    for (let i = 0; i < COLS * ROWS; i++) {
      if (frames[t].glyph[i] !== frames[t - 1].glyph[i]) rawChanges++;
      if (out.glyph[i] !== prevOutGlyph[i]) stabChanges++;
    }
    prevOutGlyph = out.glyph.slice();
    prevOutFg = out.fg.slice();
    prevOutBg = out.bg.slice();
  }

  const reductionPct = 100 * (1 - stabChanges / rawChanges);
  console.log(`[strafe sequence] raw changed-glyph count: ${rawChanges}, stabilized: ${stabChanges} (${reductionPct.toFixed(1)}% fewer)`);
  ok('strafe sequence: stabilized output changes fewer glyphs than raw', stabChanges < rawChanges,
    `raw=${rawChanges} stabilized=${stabChanges}`);
}

// ---------------------------------------------------------------------------
// 4. Zero-allocation gate (--expose-gc), same pattern as ME-09's bvh.test.js.
// ---------------------------------------------------------------------------

{
  const COLS = 64, ROWS = 32;
  const n = COLS * ROWS;
  const prev = makeFrame(COLS, ROWS, { glyph: 10, fg: 0x102030, bg: 0x010101, kind: KIND_WALL, planeId: 5, u: 0.5, v: 0.5, z: 5, detail: 16 });
  const cur = makeFrame(COLS, ROWS, { glyph: 11, fg: 0x203040, bg: 0x020202, kind: KIND_WALL, planeId: 5, u: 0.5, v: 0.5, z: 5, detail: 16 });
  const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0, cols: COLS, rows: ROWS };
  const out = makeOut(COLS, ROWS);

  function callOnce() { stabilizeCells(prev, cur, cam, cam, out); }

  for (let i = 0; i < 200; i++) callOnce(); // warm up (JIT)
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) callOnce();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('2000 calls: no significant heap growth (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (n=${n})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
