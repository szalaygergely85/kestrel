// engine/render/pitched.pipeline.test.js (RE-02a, docs/architecture.md 28.1 Amendment 2).
// Node-side checks of the pitched pipeline's shared pieces: the GLSL `cellRayPitched` twin (transpiled
// from the real shader source and compared with `unprojectPitched`), the fog-distance scale, sprite
// projection, the pitched screen-rect cull, the 28.1 throw, and zero per-frame allocation.
// Re-runs itself with --expose-gc when needed. Run: node engine/render/pitched.pipeline.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PROJ_NEAR, createPitchedTerms, pitchedTerms, unprojectPitched, worldToCell, screenRay,
  resolveProjection, assertProjectionRenderer, pitchedFogScale,
} from './projection.js';
import { CELL_RAY_PITCHED } from './gpu/glsl/common.js';
import { projectSprite } from './sprites.js';
import { VoxelPool } from './voxelPool.js';
import { computeProjectionPitched, instanceRect } from '../voxel/instanceRect.js';
import { renderWorld } from './compositor.js';
import { stabilizeCells } from './stable.js';
import { createRtsCamera, update as updateRtsCamera } from '../core/rtsCamera.js';
import quadruped12 from '../voxel/fixtures/quadruped12.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeLcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------------------
// (a1) GLSL cellRayPitched, transpiled mechanically from the shader source, == unprojectPitched.
// ---------------------------------------------------------------------------
{
  // vec3/vec2/ivec2 become plain {x,y,z} objects, `float x =` becomes `const x =`.
  const fnSrc = (name) => {
    const m = new RegExp(`(vec3|float) ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n\\}`).exec(CELL_RAY_PITCHED);
    if (!m) throw new Error(`GLSL function ${name} not found`);
    const params = m[2].split(',').map((p) => p.trim().split(/\s+/).pop());
    const body = m[3].replace(/\bfloat (\w+) =/g, 'const $1 =').replace(/\bvec3 (\w+) =/g, 'const $1 =')
      .replace(/\bfloat\(/g, 'FLOAT(').replace(/(\d)\.0\b/g, '$1');
    return `function ${name}(${params.join(', ')}) {${body}}`;
  };
  const js = `const vec3 = (x, y, z) => ({ x, y, z }); const FLOAT = (v) => v;\n${fnSrc('cellDirPitched')}\n${fnSrc('cellRayPitched')}\nreturn cellRayPitched;`;
  const cellRayPitched = new Function(js)();
  const rnd = makeLcg(11);
  const terms = createPitchedTerms();
  const out3 = new Float64Array(3);
  let worst = 0, n = 0;
  for (const pitch of [-55, -58, -60]) {
    for (let i = 0; i < 334; i++) {
      const cols = 100 + Math.floor(rnd() * 400), rows = 40 + Math.floor(rnd() * 160);
      const cam = { x: (rnd() - 0.5) * 500, y: (rnd() - 0.5) * 500, z: rnd() * 40, yawDeg: rnd() * 360, pitchDeg: pitch, vfovDeg: 36 };
      pitchedTerms(cam, { cols, rows, pxCellW: 1, pxCellH: 2 }, terms);
      const col = Math.floor(rnd() * cols), row = Math.floor(rnd() * rows), vd = 1 + rnd() * 300;
      unprojectPitched(terms, col, row, vd, out3);
      const g = cellRayPitched(
        { x: col, y: row }, { x: cols, y: rows }, { x: terms.eyeX, y: terms.eyeY, z: terms.eyeZ },
        { x: terms.fX, y: terms.fY, z: terms.fZ }, { x: terms.rX, y: terms.rY }, { x: terms.uX, y: terms.uY, z: terms.uZ },
        { x: terms.tanHalfX, y: terms.tanHalfY }, vd);
      worst = Math.max(worst, Math.abs(g.x - out3[0]), Math.abs(g.y - out3[1]), Math.abs(g.z - out3[2]));
      n++;
    }
  }
  ok('a1: transpiled GLSL cellRayPitched == unprojectPitched, 1000 cells at -55/-58/-60, <= 1e-9', n >= 1000 && worst <= 1e-9, `n=${n} worst=${worst}`);
}

// ---------------------------------------------------------------------------
// Fog distance = horizontal forward distance (A2 item 3).
// ---------------------------------------------------------------------------
{
  const rnd = makeLcg(12);
  const terms = createPitchedTerms();
  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  let worst = 0;
  for (let i = 0; i < 500; i++) {
    const cam = { x: 0, y: 0, z: 10, yawDeg: rnd() * 360, pitchDeg: -89 + rnd() * 120, vfovDeg: 36 };
    pitchedTerms(cam, { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 }, terms);
    const col = Math.floor(rnd() * 160), row = Math.floor(rnd() * 60);
    screenRay(terms, col, row, ray);
    const yaw = cam.yawDeg * Math.PI / 180;
    const direct = Math.max(0, ray.dx * Math.sin(yaw) + ray.dy * -Math.cos(yaw));
    worst = Math.max(worst, Math.abs(direct - pitchedFogScale(terms, row)));
  }
  ok('fog scale == max(0, dot(dir, horizontal forward)) on 500 random cells, <= 1e-12', worst <= 1e-12, `worst=${worst}`);
  pitchedTerms({ x: 0, y: 0, z: 5, yawDeg: 30, pitchDeg: 0, vfovDeg: 36 }, { cols: 100, rows: 50 }, terms);
  ok('fog scale at pitch 0 is 1 on the centre row (b = 0) and cosP = 1 everywhere', pitchedFogScale(terms, 25) === 1 && terms.cosP === 1 && terms.sinP === 0 && pitchedFogScale(terms, 0) === 1);
}

// ---------------------------------------------------------------------------
// (a2) projectSprite (pitched): the foot point round-trips through unprojectPitched/worldToCell.
// ---------------------------------------------------------------------------
{
  const rnd = makeLcg(13);
  const terms = createPitchedTerms();
  const ps = { depth: 0, fogDepth: 0, colCenter: 0, feetRow: 0, rowsOnScreen: 0 };
  const back = new Float64Array(3), c3 = new Float64Array(3);
  let worst = 0, worstCell = 0, n = 0;
  for (const pitch of [-55, -58, -60]) {
    for (let i = 0; i < 100; i++) {
      const cam = { x: 100 + rnd() * 50, y: 100 + rnd() * 50, z: 15 + rnd() * 10, yawDeg: rnd() * 360, pitchDeg: pitch, vfovDeg: 36 };
      pitchedTerms(cam, { cols: 400, rows: 150, pxCellW: 1, pxCellH: 2 }, terms);
      const yaw = cam.yawDeg * Math.PI / 180;
      const cb = { ptOn: true, pt: terms, dirX: Math.sin(yaw), dirY: -Math.cos(yaw), rightX: Math.cos(yaw), rightY: Math.sin(yaw), tanHalfHFov: 0, planeDistY: 0, horizonRow: 0, cols: 400 };
      // A point somewhere inside the view: unproject a random cell at a random depth.
      unprojectPitched(terms, rnd() * 400, rnd() * 150, 15 + rnd() * 40, c3);
      const px = c3[0], py = c3[1], pz = c3[2];
      if (!projectSprite(cb, cam, px, py, pz, 1.8, ps)) continue;
      unprojectPitched(terms, ps.colCenter - 0.5, ps.feetRow, ps.depth, back);
      worst = Math.max(worst, Math.abs(back[0] - px), Math.abs(back[1] - py), Math.abs(back[2] - pz));
      worldToCell(terms, px, py, pz, c3);
      worstCell = Math.max(worstCell, Math.abs(c3[0] + 0.5 - ps.colCenter), Math.abs(c3[1] - ps.feetRow));
      if (!(ps.rowsOnScreen > 0) || ps.fogDepth < 0) worst = Infinity;
      n++;
    }
  }
  ok('a2: pitched projectSprite foot point round-trips unprojectPitched (<= 1e-6 m) and worldToCell (<= 1e-6 cells)', n >= 250 && worst <= 1e-6 && worstCell <= 1e-6, `n=${n} worst=${worst} worstCell=${worstCell}`);
  const behind = projectSprite({ ptOn: true, pt: terms, dirX: 0, dirY: -1, rightX: 1, rightY: 0, tanHalfHFov: 0, planeDistY: 0, horizonRow: 0, cols: 400 },
    { x: 0, y: 0, z: 0 }, terms.eyeX - terms.fX * 50, terms.eyeY - terms.fY * 50, terms.eyeZ - terms.fZ * 50, 1, ps);
  ok('projectSprite: a point behind the eye plane is rejected', behind === false);
}

// ---------------------------------------------------------------------------
// (a2) pitched instanceRect never culls a box with a visible corner (64 boxes, RE-01 style).
// ---------------------------------------------------------------------------
{
  const registry = { keys: (k) => (k === 'model' ? ['bear'] : []), model: () => ({ voxel: quadruped12 }) };
  let nextId = 1;
  const idMap = new Map();
  const pool = new VoxelPool();
  pool.bind(registry, { idFor(k) { if (!idMap.has(k)) idMap.set(k, nextId++); return idMap.get(k); } });
  const pm = pool.models.get('bear');
  const grid = { cols: 200, rows: 80, pxCellW: 1, pxCellH: 2 };
  const cam = { x: 0, y: 0, z: 10, yawDeg: 25, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
  const terms = createPitchedTerms();
  pitchedTerms(cam, grid, terms);
  const proj = {};
  computeProjectionPitched(terms, proj);
  const pose = new Float64Array(64 * 16);
  const rect = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, minCol: 0, maxCol: 0, minRow: 0, maxRow: 0, empty: false };
  const rnd = makeLcg(14);
  const c3 = new Float64Array(3);
  let checked = 0, bad = 0;
  for (let i = 0; i < 64; i++) {
    const depth = 3 + rnd() * 120;
    const sideR = (rnd() - 0.5) * 2 * terms.tanHalfX * depth * 1.1, sideU = (rnd() - 0.5) * 2 * terms.tanHalfY * depth * 1.1;
    const inst = {
      model: pm, x: terms.eyeX + terms.fX * depth + terms.rX * sideR + terms.uX * sideU,
      y: terms.eyeY + terms.fY * depth + terms.rY * sideR + terms.uY * sideU,
      z: terms.eyeZ + terms.fZ * depth + terms.uZ * sideU, yawDeg: rnd() * 360, clip: -1, frame: 0, tMs: 0,
    };
    instanceRect(proj, pm, inst, pose, null, rect);
    let visible = false, covered = true;
    for (let c = 0; c < 8; c++) {
      worldToCell(terms, (c & 1) ? rect.maxX : rect.minX, (c & 2) ? rect.maxY : rect.minY, (c & 4) ? rect.maxZ : rect.minZ, c3);
      if (c3[2] <= PROJ_NEAR) continue;
      if (c3[0] >= -0.5 && c3[0] <= grid.cols - 0.5 && c3[1] >= -0.5 && c3[1] <= grid.rows - 0.5) visible = true;
      const col = Math.floor(c3[0] + 0.5), row = Math.floor(c3[1] + 0.5);
      if (col >= 0 && col < grid.cols && row >= 0 && row < grid.rows &&
        !(col >= rect.minCol && col <= rect.maxCol && row >= rect.minRow && row <= rect.maxRow)) covered = false;
    }
    if (!visible) continue;
    checked++;
    if (rect.empty || !covered) bad++;
  }
  ok('a2: pitched instanceRect never culls a box with a visible corner; rect covers every on-screen corner (64 boxes)', checked >= 20 && bad === 0, `checked=${checked} bad=${bad}`);

  // pool.project() takes the same path off cam.projection.
  const rt = { cols: 200, rows: 80, pxCellW: 1, pxCellH: 2 };
  pool.beginFrame();
  pool.pushInstance('bear', terms.eyeX + terms.fX * 30, terms.eyeY + terms.fY * 30, terms.eyeZ + terms.fZ * 30, 0);
  pool.project(cam, rt);
  ok('VoxelPool.project keeps an instance in front of a pitched camera', pool.list.length === 1);
  pool.beginFrame();
  pool.pushInstance('bear', 3, 0, 2, 0);
  pool.project({ x: 0, y: 5, z: 1, yawDeg: 0, pitchDeg: 0 }, rt);
  ok('VoxelPool.project without cam.projection takes the shear path (instance ahead kept)', pool.list.length === 1);

  pool.beginFrame();
  pool.pushInstance('bear', terms.eyeX + terms.fX * 30, terms.eyeY + terms.fY * 30, terms.eyeZ + terms.fZ * 30, 0);
  for (let i = 0; i < 50; i++) pool.project(cam, rt);
  let grew = Infinity; // best of 3 rounds: the heap number is GC-noisy, a real per-call allocation grows every round
  for (let r = 0; r < 3; r++) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5000; i++) pool.project(cam, rt);
    global.gc();
    grew = Math.min(grew, process.memoryUsage().heapUsed - before);
  }
  ok('a6 (Node part): pitched VoxelPool.project 5000 calls, heap delta < 64 KB', grew < 64 * 1024, `grew ${grew}`);
}

// ---------------------------------------------------------------------------
// (a5) 'pitched' + 'dda' throws; resolveProjection; stable.js refuses pitched.
// ---------------------------------------------------------------------------
{
  const pitchedCam = { x: 0, y: 0, z: 5, yawDeg: 0, pitchDeg: -58, projection: 'pitched' };
  const shearCam = { x: 0, y: 0, z: 5, yawDeg: 0, pitchDeg: 0 };
  const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  ok("a5: assertProjectionRenderer(pitched, 'dda') throws the 28.1 message",
    throwsMsg(() => assertProjectionRenderer(pitchedCam, 'dda')) === "cam.projection 'pitched' requires renderer 'mesh'");
  ok("a5: renderWorld({renderer:'dda'}, pitched cam) throws at the entry",
    throwsMsg(() => renderWorld({ renderer: 'dda', gpu: true }, null, pitchedCam)).includes("requires renderer 'mesh'"));
  ok('a5: renderWorld without a renderer field (dda default) throws on pitched',
    throwsMsg(() => renderWorld({ gpu: true }, null, pitchedCam)).includes("requires renderer 'mesh'"));
  ok("pitched + 'mesh' and shear + either renderer do not throw",
    throwsMsg(() => { assertProjectionRenderer(pitchedCam, 'mesh'); assertProjectionRenderer(shearCam, 'dda'); assertProjectionRenderer(shearCam, 'mesh'); }) === '');
  ok('resolveProjection: unset -> pitched on mesh (RE-02b), shear on dda, explicit wins',
    resolveProjection({ x: 0 }, 'mesh') === 'pitched' && resolveProjection({ x: 0 }, 'dda') === 'shear' && resolveProjection(pitchedCam, 'mesh') === 'pitched');
  const st = { cols: 2, rows: 2, glyph: new Uint8Array(4), fg: new Uint32Array(4), bg: new Uint32Array(4) };
  ok('stable.js throws on a pitched camera',
    throwsMsg(() => stabilizeCells(st, st, { ...shearCam, cols: 2, rows: 2 }, { ...pitchedCam, cols: 2, rows: 2 }, st)).includes('pitched'));
}

// ---------------------------------------------------------------------------
// rtsCamera writes the focus fields (A2 item 4).
// ---------------------------------------------------------------------------
{
  const rts = createRtsCamera({ bounds: { x0: 0, y0: 0, x1: 100, y1: 100 }, heightFn: () => 3 });
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0, vfovDeg: 36, projection: 'shear' };
  updateRtsCamera(rts, 0.016, {}, { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 }, cam);
  ok('rtsCamera.update writes cam.focusX/Y/Z', cam.focusX === rts.focusX && cam.focusY === rts.focusY && cam.focusZ === rts.focusZ && cam.projection === 'pitched');
}

console.log(`pitched.pipeline.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('FAIL: ' + f); console.error('FAIL'); process.exit(1); }
