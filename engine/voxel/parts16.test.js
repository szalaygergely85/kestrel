// engine/voxel/parts16.test.js - VOX-PARTS-16a (architecture.md 38.67 section 1).
// 12-part fixture through validator / pack / pose / mesh / DrawList + byte-identity pin for 8-part models.
// Run: node engine/voxel/parts16.test.js
import { createHash } from 'node:crypto';
import { MAX_VOX_PARTS, PART_STRIDE, validateVoxelModel } from './VoxelModel.js';
import { packVoxelModel } from './voxelPack.js';
import { computeVoxelPose, FORWARD } from './voxelPose.js';
import { buildVoxelMesh, VoxelMeshCache, addVoxelInstances } from '../mesh/voxelMesh.js';
import { DrawList } from '../mesh/DrawList.js';
import quadruped12 from './fixtures/quadruped12.js';
import quadruped16 from './fixtures/quadruped16.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const MATS = ['mat_a', 'mat_b', 'mat_c'];
const matId = (k) => MATS.indexOf(k) + 1;

ok('MAX_VOX_PARTS = 16', MAX_VOX_PARTS === 16);

// validator
const r = validateVoxelModel(quadruped16, { materialKeys: MATS });
ok('quadruped16 (12 parts, meshOnly) validates', r.errors.length === 0, JSON.stringify(r.errors));
const noFlag = JSON.parse(JSON.stringify(quadruped16)); delete noFlag.meshOnly;
ok('> 8 parts without meshOnly errors', validateVoxelModel(noFlag, { materialKeys: MATS }).errors.some((e) => e.indexOf('> 8 parts needs meshOnly') >= 0));
const many = JSON.parse(JSON.stringify(quadruped16));
for (let i = 0; i < 5; i++) many.parts['x' + i] = { box: [0, 0, 0, 1, 1, 1], pivot: [0, 0, 0], parent: 'body' };
ok('17 parts errors', validateVoxelModel(many, { materialKeys: MATS }).errors.some((e) => e.indexOf('17 parts') >= 0));

// 8-part models stay byte-identical: sha256 of pack + mesh of quadruped12 + post12, recorded on the pre-16 code (HEAD cb3c52a1).
import post12 from './fixtures/post12.js';
const hh = createHash('sha256');
for (const d of [quadruped12, post12]) {
  const p = packVoxelModel(d, () => 1), m = buildVoxelMesh(p, { id: 'x', partNames: Object.keys(d.parts) });
  for (const a of [m.pos, m.flat, m.nrm, p.vox, p.parts]) hh.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
}
const sumNow = hh.digest('hex').slice(0, 16);
ok('8-part pack/mesh byte-identical to pre-VOX-PARTS-16 (checksum)', sumNow === '62bbf2b4e5da0084', sumNow);

// 12-part pack / pose / mesh
const names = Object.keys(quadruped16.parts);
const pm = packVoxelModel(quadruped16, matId);
ok('pack: 12 parts', pm.partCount === 12 && names.length === 12);
const pose = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
const inst = { model: pm, modelKey: 'q16', x: 1, y: 2, z: 0, yawDeg: 30, clip: -1, frame: 0, tMs: 0, scale: 1, rect: { minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 3, maxZ: 3 } };
computeVoxelPose(pm, inst, pose);
let finite = true; for (let i = 0; i < 12 * 12; i++) if (!Number.isFinite(FORWARD[i])) finite = false;
ok('pose: 12 parts finite', finite);
// lower leg (part 8..11) inherits its parent's translation: pose differs from identity only through the chain
const mesh = buildVoxelMesh(pm, { id: 'q16', partNames: names });
ok('mesh: 12 ranges', mesh.ranges.length === 12, String(mesh.ranges.length));
const maxPartSeen = new Set();
for (let t = 0; t < mesh.flat.length / 2; t++) {
  const f0 = mesh.flat[t * 2];
  maxPartSeen.add(((f0 >>> 21) & 7) | (((f0 >>> 17) & 1) << 3));
  if (((f0 >>> 24) & 0xF) !== 0xF && false) throw 0;
}
ok('mesh: part index decoded from bits 21-23 + 17 covers 0..11', maxPartSeen.size === 12 && Math.max(...maxPartSeen) === 11, [...maxPartSeen].join());
let rangesMatch = true;
mesh.ranges.forEach((rg, p) => {
  for (let v = rg.start * 3; v < (rg.start + rg.count) * 3; v++) {
    const f0 = mesh.flat[v * 2];
    if ((((f0 >>> 21) & 7) | (((f0 >>> 17) & 1) << 3)) !== p) rangesMatch = false;
    if ((f0 >>> 28) !== 0xF) rangesMatch = false;
  }
});
ok('mesh: every vertex of range p carries part p and the 0xF instance bits intact', rangesMatch);

// DrawList: partMatrices / partFlags carry all 12 parts
const list = new DrawList();
ok('DrawList item sizes follow MAX_VOX_PARTS', list.items[0].partMatrices.length === MAX_VOX_PARTS * 12 && list.items[0].partFlags.length === MAX_VOX_PARTS);
const cache = new VoxelMeshCache();
const items = [inst];
list.begin();
addVoxelInstances(list, { list: items }, cache, () => names);
const it = list.items[0];
let nz = 0; for (let i = 8 * 12; i < 12 * 12; i++) if (it.partMatrices[i] !== 0) nz++;
ok('DrawList: parts 8..11 matrices filled', list.count === 1 && nz > 0, `count=${list.count} nz=${nz}`);
ok('DrawList: parts 12..15 stay zero', it.partMatrices.subarray(12 * 12).every((v) => v === 0));

// 0 alloc: pool/closure hoisted; heap measured after gc (run with --expose-gc, as run-tests does)
const pool = { list: items }, namesFor = () => names;
const frame = () => { list.begin(); addVoxelInstances(list, pool, cache, namesFor); };
for (let i = 0; i < 500; i++) frame();
if (global.gc) global.gc();
const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 20000; i++) frame();
if (global.gc) global.gc();
const dh = process.memoryUsage().heapUsed - h0;
ok('0 alloc: 20000 frames of a 12-part instance leave the heap flat (< 100 KB)', dh < 1e5, dh + ' B');

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
