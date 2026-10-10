// engine/chargen/rig.test.js - RIG-02b (docs/architecture.md 38.32 item 8 b, c, d + e errors): node engine/chargen/rig.test.js
// Tiny synthetic rigs: a box per bone (no kit needed).
import { meshCharacter, sampleClip, collapseRig, riggedModelDef } from './index.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { buildVoxelMesh, addVoxelInstances, VoxelMeshCache } from '../mesh/voxelMesh.js';
import { computeVoxelPose, voxelMountWorld, FORWARD } from '../voxel/voxelPose.js';
import { PART_STRIDE, MAX_VOX_PARTS } from '../voxel/VoxelModel.js';
import { VoxelPool } from '../render/voxelPool.js';
import { DrawList } from '../mesh/DrawList.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function gridOf(bones, boxes, matOf, clips, mounts = {}) {
  const size = [24, 12, 30];
  const mat = new Uint8Array(size[0] * size[1] * size[2]), bone = new Uint8Array(mat.length);
  bones.forEach(([name], bi) => {
    const q = boxes[name];
    for (let z = q[2]; z <= q[5]; z++) for (let y = q[1]; y <= q[4]; y++) for (let x = q[0]; x <= q[3]; x++) {
      const i = x + 24 * (y + 12 * z);
      mat[i] = matOf(bi); bone[i] = bi;
    }
  });
  return {
    cellM: 0.025, size, anchor: [10, 5, 0], mat, bone, matKeys: ['a', 'b'], mounts, clips,
    bones: bones.map(([name, parent]) => { const q = boxes[name]; return { name, parent, joint: [(q[0] + q[3] + 1) / 2, (q[1] + q[4] + 1) / 2, q[5] + 1] }; }),
  };
}
const matId = (k) => ({ a: 10, b: 11 })[k];

// ---- (b) pose equivalence: computeVoxelPose FORWARD vs rigid FK from chargen sampleClip quaternions
const BONES = [['Hips', null], ['Head', 'Hips'], ['Jaw', 'Head'], ['LeftUpperArm', 'Hips']];
const BOXES = { Hips: [6, 3, 10, 13, 6, 15], Head: [7, 3, 16, 12, 6, 21], Jaw: [8, 1, 16, 11, 2, 19], LeftUpperArm: [14, 3, 10, 17, 6, 15] };
const CLIPS = {
  arm: { duration: 500, loop: true, keys: [{ t: 0 }, { t: 250, rot: { LeftUpperArm: [45, 0, 0] } }, { t: 400, rot: { LeftUpperArm: [45, 0, 45], Jaw: [0, 20, 0] } }] },
  jaw: { duration: 300, loop: true, keys: [{ t: 0, rot: { Jaw: [0, 25, 10] } }, { t: 150, rot: { Jaw: [15, -25, 0], Head: [0, 0, 30] } }] },
  hips: { duration: 300, loop: true, keys: [{ t: 0, pos: { Hips: [0, 0, 0] } }, { t: 150, pos: { Hips: [2, -1, 3] } }] },
};
const grid = gridOf(BONES, BOXES, (bi) => 1 + (bi & 1), CLIPS, { hand_r: [15.5, 4.5, 11], mouth: [9.5, 1.5, 17] });
const rigged = meshCharacter(grid);
const partMap = [
  { name: 'body', bones: ['Hips'], parent: null }, { name: 'head', bones: ['Head'], parent: 'body' },
  { name: 'jaw', bones: ['Jaw'], parent: 'head' }, { name: 'armL', bones: ['LeftUpperArm'], parent: 'body' },
];
const partRig = collapseRig(rigged, partMap);
const def = riggedModelDef(partRig);
const pm = packVoxelModel(def.voxel, matId);
ok('rig pm: no atlas, rig set, partCount', pm.vox.length === 0 && pm.rig === def.voxel.rig && pm.partCount === 4 && pm.emissiveLight === null);
ok('all local vertex coords are integers >= 0', def.voxel.rig.pos.every((v) => v >= 0 && Number.isInteger(v)));
ok('matIds resolved via matIdFor', pm.matIds[1] === 10 && pm.matIds[2] === 11);
ok('mount parts: nearest joint (hand_r -> armL, mouth -> jaw)', def.voxel.mounts.hand_r.part === 'armL' && def.voxel.mounts.mouth.part === 'jaw');

const qmulv = (q, v) => { // rotate v by quaternion q (x,y,z,w)
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const nb = rigged.bones.length;
const quat = new Float64Array(4 * nb), hips = [0, 0, 0];
const inst = { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1, fromClip: -1, fromW: 0, addPart: -1 };
const pout = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
const cellM = rigged.cellM;
let worst = 0;
for (const cname of Object.keys(CLIPS)) {
  const ci = pm.clipIndex[cname];
  for (const f of [3, 4, 5, 7]) {
    sampleClip(rigged, CLIPS[cname], f * 50, quat, hips);
    const Rw = [], Jw = []; // rigid FK in metres from the anchor
    rigged.bones.forEach((b, i) => {
      const q = [quat[4 * i], quat[4 * i + 1], quat[4 * i + 2], quat[4 * i + 3]];
      if (b.parent == null) { Rw[i] = q; Jw[i] = b.joint.map((j, a) => j + hips[a]); return; }
      const pi = rigged.bones.findIndex((x) => x.name === b.parent);
      Rw[i] = qmul(Rw[pi], q);
      const off = qmulv(Rw[pi], b.joint.map((j, a) => j - rigged.bones[pi].joint[a]));
      Jw[i] = Jw[pi].map((j, a) => j + off[a]);
    });
    inst.clip = ci; inst.frame = f; inst.tMs = 0;
    computeVoxelPose(pm, inst, pout);
    rigged.bones.forEach((b, bi) => { // one part per bone, same index
      const r = rigged.mesh.ranges[bi];
      for (let v = 4 * r.start; v < 4 * (r.start + r.count); v++) {
        const p = [0, 1, 2].map((a) => rigged.mesh.pos[3 * v + a] - b.joint[a]);
        const rv = qmulv(Rw[bi], p);
        const fk = rv.map((c, a) => c + Jw[bi][a]);
        const lc = [0, 1, 2].map((a) => def.voxel.rig.pos[3 * v + a]);
        const o = bi * 12;
        for (let a = 0; a < 3; a++) {
          const w = FORWARD[o + 3 * a] * lc[0] + FORWARD[o + 3 * a + 1] * lc[1] + FORWARD[o + 3 * a + 2] * lc[2] + FORWARD[o + 9 + a];
          worst = Math.max(worst, Math.abs(w - fk[a]) / cellM);
        }
      }
    });
  }
}
ok(`pose equivalence FORWARD vs rigid FK (arm x/z, jaw, head, hips pos) max ${worst.toExponential(2)} cells < 1e-3`, worst < 1e-3);

// ---- (c) mesh parity vs a native voxel model of the same 2-part grid
{
  const B2 = [['Hips', null], ['Head', 'Hips']];
  const X2 = { Hips: [4, 3, 2, 9, 6, 7], Head: [5, 3, 12, 8, 6, 15] };
  const g2 = gridOf(B2, X2, (bi) => 1 + bi, {});
  const pr2 = collapseRig(meshCharacter(g2), [{ name: 'body', bones: ['Hips'], parent: null }, { name: 'head', bones: ['Head'], parent: 'body' }]);
  const d2 = riggedModelDef(pr2);
  const rpm = packVoxelModel(d2.voxel, matId);
  const [sx, sy, sz] = g2.size;
  const layers = [];
  for (let z = 0; z < sz; z++) { const rows = []; for (let y = 0; y < sy; y++) { let s = ''; for (let x = 0; x < sx; x++) s += ['.', '1', '2'][g2.mat[x + sx * (y + sy * z)]]; rows.push(s); } layers.push(rows); }
  const native = { version: 1, cellM: 0.025, size: g2.size, anchor: g2.anchor, mats: { 1: 'a', 2: 'b' }, layers,
    parts: { body: { box: [4, 3, 2, 10, 7, 8], pivot: [0, 0, 0] }, head: { box: [5, 3, 12, 9, 7, 16], pivot: [0, 0, 0], parent: 'body' } } };
  const npm = packVoxelModel(native, matId);
  const names = ['body', 'head'];
  const rm = buildVoxelMesh(rpm, { id: 'r', partNames: names }), nm = buildVoxelMesh(npm, { id: 'n', partNames: names });
  ok('mesh parity: same triangle count', rm.triCount === nm.triCount && rm.triCount === 24, `${rm.triCount} vs ${nm.triCount}`);
  const f1 = (m) => Array.from(m.flat).filter((_, i) => i % 2 === 1).sort((a, b) => a - b).join();
  ok('mesh parity: same multiset of flat1', f1(rm) === f1(nm));
  const rg = d2.voxel.anchor;
  const shift = [rg[0] - g2.anchor[0], rg[1] - g2.anchor[1], rg[2] - g2.anchor[2]];
  const bb = (m, r) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let v = 3 * r.start; v < 3 * (r.start + r.count); v++) for (let a = 0; a < 3; a++) { const c = m.pos[3 * v + a]; lo[a] = Math.min(lo[a], c); hi[a] = Math.max(hi[a], c); } return lo.concat(hi); };
  let same = rm.ranges.length === 2 && nm.ranges.length === 2;
  for (let p = 0; same && p < 2; p++) {
    const a = bb(rm, rm.ranges[p]), b = bb(nm, nm.ranges[p]);
    for (let k = 0; k < 6; k++) if (Math.abs(a[k] - (b[k] + shift[k % 3])) > 1e-5) same = false;
  }
  ok('mesh parity: same per-range bbox (anchor-shifted)', same);
  ok('every rig flat0 layer >= 0 and below 4096', Array.from(rm.flat).filter((_, i) => i % 2 === 0).every((f) => (f & 0x3FFFF) < 4096));
  ok('LOD1 get returns the LOD0 mesh for a rig pm', (() => { const c = new VoxelMeshCache(); return c.get(rpm, 'r', names, 1) === c.get(rpm, 'r', names, 0); })());
}

// ---- (d) pool
{
  const tiny = { voxel: { version: 1, cellM: 0.1, size: [2, 2, 2], anchor: [1, 1, 0], mats: { 1: 'a' }, layers: [['11', '11'], ['11', '11']], parts: { b: { box: [0, 0, 0, 2, 2, 2], pivot: [1, 1, 0] } } } };
  const registry = { keys: () => ['hero', 'tiny'], model: (k) => (k === 'hero' ? def : tiny) };
  const pool = new VoxelPool();
  pool.bind(registry, { idFor: matId });
  const hero = pool.models.get('hero');
  ok('pool: rig model is meshOnly, voxel model is not', hero.meshOnly === true && pool.models.get('tiny').meshOnly === false);
  const cam = { x: 0, y: 4, z: 1, yawDeg: 0, pitchDeg: 0 }, rt = { cols: 80, rows: 40, pxCellW: 1, pxCellH: 2 };
  const ent = (id, voxel) => ({ id, transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } });
  const e1 = ent(1, { model: 'hero' }), e2 = ent(2, { model: 'hero', partRot: { part: 'jaw', rx: 0, ry: 30, rz: 0 } });
  const frame = () => {
    pool.beginFrame();
    pool.pushInstance('hero', 0, 0, 0, 0); pool.pushInstance('tiny', 1, 0, 0, 0);
    pool.project(cam, rt); pool.projectShadow();
  };
  frame();
  ok('pool: project + projectShadow queue both models', pool.list.length === 2 && pool.shadowList.length === 2);
  const dl = new DrawList();
  addVoxelInstances(dl, pool, new VoxelMeshCache(), (k) => Object.keys(registry.model(k).voxel.parts));
  ok('addVoxelInstances: one draw per instance, rig item carries partCount part matrices', dl.count === 2 && dl.items[0].partMatrices.slice(0, 48).some((v) => v !== 0) && dl.items[0].partFlags.length >= 4, String(dl.count));
  pool.beginFrame(); pool._queueEntity(e1); pool._queueEntity(e2);
  pool.project(cam, rt);
  ok('objectIdFor works for rig entities', pool.objectIdFor(e1) >= 0x8000 && pool.objectIdFor(e2) >= 0x8000 && pool.objectIdFor(e1) !== pool.objectIdFor(e2));
  const L = (i) => Float64Array.from(pool.list[i].pose.subarray(0, 4 * PART_STRIDE));
  const a = L(0), b = L(1);
  const differs = (p) => { for (let c = 0; c < 12; c++) if (a[p * PART_STRIDE + c] !== b[p * PART_STRIDE + c]) return true; return false; };
  ok('partRot jaw: pose differs only in the jaw part', pool.list.length === 2 && !differs(0) && !differs(1) && differs(2) && !differs(3));
  const o = [0, 0, 0];
  const mw = voxelMountWorld(hero, { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1 }, 'hand_r', o);
  ok('voxelMountWorld hand_r resolves', mw === o && o.every(Number.isFinite));
  if (global.gc) {
    for (let i = 0; i < 20; i++) frame();
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200; i++) frame();
    global.gc();
    const grown = process.memoryUsage().heapUsed - before;
    ok('rig pool: repeated push+project+projectShadow allocates nothing material', grown < 200000, String(grown));
  } else console.log('SKIP zero-alloc (run with --expose-gc)');
}

// ---- (e) errors
{
  const off = { ...partRig, mesh: { ...partRig.mesh, pos: partRig.mesh.pos.map((v, i) => (i === 0 ? v + 0.4 * partRig.cellM : v)) } };
  let msg = ''; try { riggedModelDef(off); } catch (e) { msg = e.message; }
  ok('off-grid vertex throws "not a voxel-grid mesh"', /not a voxel-grid mesh/.test(msg), msg);
  const many = { ...partRig, parts: Array.from({ length: 9 }, (_, i) => ({ ...partRig.parts[0], name: 'p' + i })) };
  msg = ''; try { riggedModelDef(many); } catch (e) { msg = e.message; }
  ok('> 8 parts throws', /max 8/.test(msg), msg);
  const bad = { ...def.voxel, rig: { ...def.voxel.rig, ranges: [] } };
  msg = ''; try { packVoxelModel(bad, matId); } catch (e) { msg = e.message; }
  ok('malformed rig header throws a clear message', /packVoxelModel \(rig\)/.test(msg), msg);
  const skewPos = def.voxel.rig.pos.slice(); skewPos[0] += 1;
  const skew = packVoxelModel({ ...def.voxel, rig: { ...def.voxel.rig, pos: skewPos } }, matId);
  msg = ''; try { buildVoxelMesh(skew, { id: 's', partNames: Object.keys(def.voxel.parts) }); } catch (e) { msg = e.message; }
  ok('non-rectangle quad throws', /buildRiggedMesh/.test(msg), msg);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
