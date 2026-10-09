// engine/chargen/mesh.test.js (CHARGEN-03): node engine/chargen/mesh.test.js
// Synthetic 22-bone grids (the real human kit is CHARGEN-01): a box per bone, no kit needed.
import { meshCharacter, sampleClip, eulerToQuat, quatToEuler, collapseRig, HUMANOID_PART_MAP, MAX_PARTS } from './index.js';
import { MAX_VOX_PARTS } from '../voxel/VoxelModel.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
ok('MAX_PARTS equals MAX_VOX_PARTS', MAX_PARTS === MAX_VOX_PARTS);

const SKEL = [
  ['Hips', null], ['Spine', 'Hips'], ['Chest', 'Spine'], ['Neck', 'Chest'], ['Head', 'Neck'], ['Jaw', 'Head'],
  ['LeftShoulder', 'Chest'], ['LeftUpperArm', 'LeftShoulder'], ['LeftLowerArm', 'LeftUpperArm'], ['LeftHand', 'LeftLowerArm'],
  ['RightShoulder', 'Chest'], ['RightUpperArm', 'RightShoulder'], ['RightLowerArm', 'RightUpperArm'], ['RightHand', 'RightLowerArm'],
  ['LeftUpperLeg', 'Hips'], ['LeftLowerLeg', 'LeftUpperLeg'], ['LeftFoot', 'LeftLowerLeg'], ['LeftToes', 'LeftFoot'],
  ['RightUpperLeg', 'Hips'], ['RightLowerLeg', 'RightUpperLeg'], ['RightFoot', 'RightLowerLeg'], ['RightToes', 'RightFoot'],
];
// Human-sized grid 36 x 20 x 76; one inclusive box [x0,y0,z0,x1,y1,z1] per bone. Stacked boxes touch (interior faces to cull).
const BOX = {
  Hips: [12, 6, 36, 23, 13, 41], Spine: [12, 6, 42, 23, 13, 51], Chest: [11, 5, 52, 24, 14, 60], Neck: [16, 8, 61, 19, 11, 63],
  Head: [14, 6, 64, 21, 13, 73], Jaw: [15, 5, 64, 20, 6, 66],
  LeftShoulder: [25, 7, 56, 27, 12, 60], LeftUpperArm: [28, 7, 50, 31, 12, 60], LeftLowerArm: [28, 7, 40, 31, 12, 49], LeftHand: [28, 7, 34, 31, 12, 39],
  RightShoulder: [8, 7, 56, 10, 12, 60], RightUpperArm: [4, 7, 50, 7, 12, 60], RightLowerArm: [4, 7, 40, 7, 12, 49], RightHand: [4, 7, 34, 7, 12, 39],
  LeftUpperLeg: [18, 6, 22, 23, 13, 35], LeftLowerLeg: [18, 7, 6, 23, 12, 21], LeftFoot: [18, 4, 1, 23, 13, 5], LeftToes: [18, 2, 0, 23, 3, 2],
  RightUpperLeg: [12, 6, 22, 17, 13, 35], RightLowerLeg: [12, 7, 6, 17, 12, 21], RightFoot: [12, 4, 1, 17, 13, 5], RightToes: [12, 2, 0, 17, 3, 2],
};
function makeClips() {
  return {
    rest: { duration: 100, loop: true, keys: [{ t: 0 }] },
    swing: {
      duration: 1000, loop: true,
      keys: [
        { t: 0, rot: { LeftUpperArm: [0, -40, 0], LeftLowerArm: [0, -10, 0], Head: [0, 0, -15], Spine: [3, 0, 0] }, pos: { Hips: [0, 0, 0] } },
        { t: 500, rot: { LeftUpperArm: [0, 40, 0], LeftLowerArm: [0, -50, 0], Head: [0, 0, 15], Spine: [3, 0, 0] }, pos: { Hips: [0, 0, 2] } },
      ],
    },
    spin: { // 510 degree twist: tests sign continuity and Euler unwrapping
      duration: 1000, loop: true,
      keys: [0, 250, 500, 750].map((t, i) => ({ t, rot: { Chest: [0, 0, 170 * i], LeftHand: [100 * i, 0, 0] } })),
    },
  };
}
function makeGrid() {
  const size = [36, 20, 76];
  const mat = new Uint8Array(size[0] * size[1] * size[2]), bone = new Uint8Array(mat.length);
  SKEL.forEach(([name], bi) => {
    const q = BOX[name];
    for (let z = q[2]; z <= q[5]; z++) for (let y = q[1]; y <= q[4]; y++) for (let x = q[0]; x <= q[3]; x++) {
      const i = x + 36 * (y + 20 * z);
      if (mat[i]) continue; // first bone wins (Jaw overlaps Head)
      mat[i] = 1 + ((x + y + z + (bi >> 2)) % 3 === 0 ? 1 : 0); // 2 materials, speckled
      bone[i] = bi;
    }
  });
  const bones = SKEL.map(([name, parent]) => {
    const q = BOX[name];
    return { name, parent, joint: [(q[0] + q[3] + 1) / 2, (q[1] + q[4] + 1) / 2, q[5] + 1] };
  });
  return { cellM: 0.025, size, anchor: [18, 9, 0], mat, bone, matKeys: ['a', 'b'], bones, mounts: {}, clips: makeClips() };
}

// ---- meshCharacter
const grid = makeGrid();
const t0 = performance.now();
const rig = meshCharacter(grid);
const buildMs = performance.now() - t0;
const m = rig.mesh;
ok('one range per bone', m.ranges.length === 22);
let sum = 0, contiguous = true;
m.ranges.forEach((r) => { if (r.start !== sum) contiguous = false; sum += r.count; });
ok('ranges contiguous and cover all quads', contiguous && sum === m.quads && m.mat.length === m.quads && m.pos.length === 12 * m.quads);

// brute-force exposed faces: key = "x,y,z,dir" -> owning bone + material
const [sx, sy, sz] = grid.size;
const at = (x, y, z) => x + sx * (y + sy * z);
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const expect = new Map();
for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
  const i = at(x, y, z);
  if (!grid.mat[i]) continue;
  DIRS.forEach((d, di) => {
    const nx = x + d[0], ny = y + d[1], nz = z + d[2];
    const inside = nx >= 0 && ny >= 0 && nz >= 0 && nx < sx && ny < sy && nz < sz;
    if (inside && grid.mat[at(nx, ny, nz)] && grid.bone[at(nx, ny, nz)] === grid.bone[i]) return; // same-bone neighbour hides the face; other bones leave a cap
    expect.set(`${x},${y},${z},${di}`, { bone: grid.bone[i], mat: grid.mat[i] });
  });
}
// rasterise the quads back into unit faces
const got = new Map();
let dup = 0, wrongBone = 0, wrongMat = 0, badWind = 0, notRect = 0;
const cm = grid.cellM, an = grid.anchor;
m.ranges.forEach((r, bi) => {
  for (let qd = r.start; qd < r.start + r.count; qd++) {
    const p = [];
    for (let k = 0; k < 4; k++) p.push([0, 1, 2].map((a) => Math.round(m.pos[12 * qd + 3 * k + a] / cm + an[a])));
    const nrm = [m.nrm[12 * qd], m.nrm[12 * qd + 1], m.nrm[12 * qd + 2]];
    const di = DIRS.findIndex((d) => d[0] === nrm[0] && d[1] === nrm[1] && d[2] === nrm[2]);
    const w = nrm.findIndex((v) => v !== 0);
    const lo = [0, 1, 2].map((a) => Math.min(...p.map((v) => v[a])));
    const hi = [0, 1, 2].map((a) => Math.max(...p.map((v) => v[a])));
    if (lo[w] !== hi[w]) notRect++;
    // winding: (p1-p0) x (p2-p0) must point along the normal
    const e1 = [0, 1, 2].map((a) => p[1][a] - p[0][a]), e2 = [0, 1, 2].map((a) => p[2][a] - p[0][a]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] <= 0) badWind++;
    const rng = [0, 1, 2].map((a) => (a === w ? [lo[a], lo[a] + 1] : [lo[a], hi[a]]));
    for (let z = rng[2][0]; z < rng[2][1]; z++) for (let y = rng[1][0]; y < rng[1][1]; y++) for (let x = rng[0][0]; x < rng[0][1]; x++) {
      const cell = [x, y, z];
      if (nrm[w] > 0) cell[w] = lo[w] - 1; // +face lies on the far side of its voxel
      const key = `${cell[0]},${cell[1]},${cell[2]},${di}`;
      if (got.has(key)) dup++;
      got.set(key, true);
      const e = expect.get(key);
      if (e) { if (e.bone !== bi) wrongBone++; if (e.mat !== m.mat[qd]) wrongMat++; }
    }
  }
});
ok('quads are rectangles in a face plane', notRect === 0, `${notRect}`);
ok('quad winding is counter-clockwise around the normal', badWind === 0, `${badWind}`);
ok('every exposed face covered exactly once, none extra (none hidden except by a same-bone voxel)', got.size === expect.size && dup === 0 && [...expect.keys()].every((k) => got.has(k)), `got ${got.size} expect ${expect.size} dup ${dup}`);
ok('no quad crosses bones (each face sits in its voxel bone range)', wrongBone === 0, `${wrongBone}`);
ok('quad material = voxel material', wrongMat === 0, `${wrongMat}`);
ok('cap pair at a bone boundary (Hips top / Spine bottom both emitted)', [...expect.keys()].some((k) => { const [x, y, z, d] = k.split(',').map(Number); return d === 4 && grid.mat[at(x, y, z + 1)] && grid.bone[at(x, y, z + 1)] !== grid.bone[at(x, y, z)] && got.has(k) && got.has(`${x},${y},${z + 1},5`); }));
ok('greedy merges faces', m.quads < expect.size, `${m.quads} vs ${expect.size}`);
ok('joints are metres from the anchor', Math.abs(rig.bones[0].joint[2] - 42 * cm) < 1e-6 && Math.abs(rig.bones[0].joint[0]) < 1e-6);
ok('meshCharacter deterministic', Buffer.compare(Buffer.from(meshCharacter(grid).mesh.pos.buffer), Buffer.from(m.pos.buffer)) === 0);
let best = 1e9;
for (let i = 0; i < 20; i++) { const a = performance.now(); meshCharacter(grid); best = Math.min(best, performance.now() - a); }
console.log(`BENCH synthetic 36x20x76 humanoid: ${m.quads} quads (${expect.size} raw faces), first call ${buildMs.toFixed(2)} ms, best of 20 ${best.toFixed(2)} ms`);
ok('synthetic quad count <= 8000', m.quads <= 8000, `${m.quads}`);
ok('meshCharacter <= 10 ms (warm)', best <= 10, `${best}`);

// ---- sampleClip
function matFromEuler(rx, ry, rz) { // Rz*Ry*Rx, row-major
  const r = (d) => (d * Math.PI) / 180;
  const cx = Math.cos(r(rx)), sX = Math.sin(r(rx)), cy = Math.cos(r(ry)), sY = Math.sin(r(ry)), cz = Math.cos(r(rz)), sZ = Math.sin(r(rz));
  return [cz * cy, cz * sY * sX - sZ * cx, cz * sY * cx + sZ * sX,
    sZ * cy, sZ * sY * sX + cz * cx, sZ * sY * cx - cz * sX,
    -sY, cy * sX, cy * cx];
}
function matFromQuat(x, y, z, w) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
{
  let worst = 0;
  const q = [0, 0, 0, 0];
  for (const e of [[0, 0, 0], [30, 0, 0], [0, 45, 0], [0, 0, 90], [20, -35, 70], [-120, 50, 170], [179, -89, -179], [10, 80, 10]]) {
    eulerToQuat(e[0], e[1], e[2], q, 0);
    const A = matFromEuler(...e), B = matFromQuat(...q);
    for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(A[i] - B[i]));
    const back = [0, 0, 0];
    quatToEuler(q[0], q[1], q[2], q[3], back, 0);
    const C = matFromEuler(...back);
    for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(A[i] - C[i]));
  }
  ok('quaternion equals Euler Rz*Ry*Rx (and the inverse) within 1e-6', worst < 1e-6, `${worst}`);

  const out = new Float64Array(4 * 22), hips = [0, 0, 0];
  const swing = rig.clips.swing;
  const iUA = rig.bones.findIndex((b) => b.name === 'LeftUpperArm');
  sampleClip(rig, swing, 0, out, hips);
  const exp = [0, 0, 0, 0];
  eulerToQuat(0, -40, 0, exp, 0);
  ok('sampleClip at a key = the key Euler (1e-6)', [0, 1, 2, 3].every((k) => Math.abs(out[4 * iUA + k] - exp[k]) < 1e-6));
  sampleClip(rig, swing, 250, out, hips);
  const midQ = matFromQuat(out[4 * iUA], out[4 * iUA + 1], out[4 * iUA + 2], out[4 * iUA + 3]);
  const midE = matFromEuler(0, 0, 0);
  ok('midpoint lerps the Euler angles (UpperArm 0 deg)', midQ.every((v, i) => Math.abs(v - midE[i]) < 1e-6));
  sampleClip(rig, swing, 500, out, hips);
  ok('Hips pos in metres', Math.abs(hips[2] - 2 * cm) < 1e-9, `${hips[2]}`);
  sampleClip(rig, swing, 1250, out, hips);
  const wrapped = new Float64Array(4 * 22);
  sampleClip(rig, swing, 250, wrapped, hips);
  ok('loop wraps time', out.every((v, i) => Math.abs(v - wrapped[i]) < 1e-9));
  ok('bones without keys are identity', out[0] === 0 && out[3] === 1);

  // allocation: a fresh minimal rig must be ~0 B/call; steady state after 100k warm-up calls
  const bytesPerCall = (rg, clip, nOut) => {
    const o2 = new Float64Array(nOut), hp = [0, 0, 0];
    const run = (n) => { for (let i = 0; i < n; i++) sampleClip(rg, clip, (i * 7) % 1000, o2, hp); };
    run(130000); // warm-up (tiering)
    // after a gc the first ~50k calls still show a one-off 1.6 MB (re-tiering); steady state is 0 B/call. Median of 7 windows.
    const w = [];
    for (let k = 0; k < 7; k++) { globalThis.gc?.(); run(50000); const h0 = process.memoryUsage().heapUsed; run(100000); w.push((process.memoryUsage().heapUsed - h0) / 100000); }
    return w.sort((a, b) => a - b)[3];
  };
  const mini = { cellM: 0.025, bones: [{ name: 'Hips' }, { name: 'Head' }] };
  const miniClip = { duration: 1000, loop: true, keys: [{ t: 0, rot: { Head: [0, 0, -15] }, pos: { Hips: [0, 0, 0] } }, { t: 500, rot: { Head: [0, 0, 15] }, pos: { Hips: [0, 0, 2] } }] };
  const bMini = bytesPerCall(mini, miniClip, 8), bFull = bytesPerCall(rig, swing, 88);
  console.log(`sampleClip allocation: mini rig ${bMini.toFixed(2)} B/call, 22-bone fixture ${bFull.toFixed(2)} B/call`);
  ok('sampleClip allocates ~0 B/call (isolated rig, 100k calls)', bMini < 2, `${bMini}`);
  ok('sampleClip allocates ~0 B/call on the 22-bone fixture (steady state)', bFull < 2, `${bFull}`);

  let flips = 0;
  for (const name of ['spin', 'swing']) {
    const prev = new Float64Array(4 * 22), cur = new Float64Array(4 * 22);
    sampleClip(rig, rig.clips[name], 0, prev, hips);
    for (let t = 1; t <= 2000; t++) {
      sampleClip(rig, rig.clips[name], t / 2, cur, hips);
      for (let b = 0; b < 22; b++) {
        const d = prev[4 * b] * cur[4 * b] + prev[4 * b + 1] * cur[4 * b + 1] + prev[4 * b + 2] * cur[4 * b + 2] + prev[4 * b + 3] * cur[4 * b + 3];
        if (d < 0.9) flips++;
      }
      prev.set(cur);
    }
  }
  ok('no sign flips over a 2 s sweep (dot with previous sample > 0.9)', flips === 0, `${flips}`);

}

// ---- collapseRig
{
  const pr = collapseRig(rig, HUMANOID_PART_MAP);
  ok('collapse gives <= 8 parts', pr.parts.length === 8 && pr.parts.length <= MAX_VOX_PARTS);
  ok('collapse mesh: one range per part, same quads', pr.mesh.ranges.length === 8 && pr.mesh.quads === m.quads && pr.mesh.ranges.reduce((s, r) => s + r.count, 0) === m.quads);
  const armL = pr.parts.find((p) => p.name === 'armL');
  const jUA = rig.bones.find((b) => b.name === 'LeftUpperArm');
  ok('part pivot = root bone joint (cells)', armL.pivot.every((v, k) => v === jUA.jointCells[k]));
  ok('part parents come first; head under chest', pr.parts.every((p, i) => p.parent < i) && pr.parts[pr.parts[2].parent].name === 'chest');
  for (const cname of Object.keys(rig.clips)) {
    const c = pr.clips[cname];
    ok(`clip ${cname}: 50 ms keys covering the duration`, c.durations.every((d) => d === 50) && c.frames.length * 50 === rig.clips[cname].duration);
  }
  const rest = pr.clips.rest.frames[0];
  ok('rest pose equals master rest (rot 0, pos 0)', Object.values(rest).every((e) => e.rot.every((v) => Math.abs(v) < 1e-9)) && rest.body.pos.every((v) => v === 0));
  const f0 = pr.clips.swing.frames[0];
  ok('armL rot = UpperArm master Euler', [0, -40, 0].every((v, k) => Math.abs(f0.armL.rot[k] - v) < 1e-6), JSON.stringify(f0.armL.rot));
  ok('body composes Spine (3 deg x)', Math.abs(f0.body.rot[0] - 3) < 1e-6);
  ok('body pos in cells', Math.abs(pr.clips.swing.frames[10].body.pos[2] - 2) < 1e-6);
  const zs = pr.clips.spin.frames.slice(0, 16).map((f) => f.chest.rot[2]); // the closing segment 510 -> 0 is a deliberate fast rewind
  let jump = 0;
  for (let i = 1; i < zs.length; i++) jump = Math.max(jump, Math.abs(zs[i] - zs[i - 1]));
  ok('collapsed Euler is unwrapped (no 360 jumps)', jump < 40, `${jump}`);
  ok('collapse deterministic', JSON.stringify(collapseRig(rig, HUMANOID_PART_MAP).clips) === JSON.stringify(pr.clips));
  let thrown = false;
  try { collapseRig(rig, HUMANOID_PART_MAP.slice(0, 7)); } catch { thrown = true; }
  ok('collapse throws when a bone is in no part', thrown);
  thrown = false;
  try { collapseRig({ ...rig, clips: { bad: { duration: 70, keys: [{ t: 0 }] } } }, HUMANOID_PART_MAP); } catch { thrown = true; }
  ok('collapse rejects durations that are not multiples of 50', thrown);
}

console.log(`chargen mesh.test: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
