// PERF-09 bench + identity check: computeVoxelPose / rectFromForward, current tree vs the pre-PERF-09 copies (git HEAD).
//   node tools/bench-pose.mjs           (needs a git checkout; writes two temp refs next to the sources, deletes them)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = [];
function ref(rel, patch) {
  const src = execSync(`git show HEAD:${rel}`, { cwd: root, maxBuffer: 1 << 26 }).toString().replace(/from '\.\/voxelPose\.js'/g, "from './voxelPose.ref.tmp.mjs'");
  const out = path.join(root, rel.replace(/\.js$/, '.ref.tmp.mjs'));
  fs.writeFileSync(out, src); tmp.push(out); return pathToFileURL(out).href;
}
// dynamic, computed paths (a bench is the one place that may reach into engine internals; check-deps only scans static imports)
const eng = (rel) => import(pathToFileURL(path.join(root, 'engine', rel)).href);
const { packVoxelModel } = await eng('voxel/voxelPack.js');
const quadruped16 = (await eng('voxel/fixtures/quadruped16.js')).default;
const { MAX_VOX_PARTS, PART_STRIDE } = await eng('voxel/VoxelModel.js');
const NEWP = await eng('voxel/voxelPose.js'), NEWR = await eng('voxel/instanceRect.js');
let OLDP, OLDR;
try {
  OLDP = await import(ref('engine/voxel/voxelPose.js'));
  OLDR = await import(ref('engine/voxel/instanceRect.js'));
} finally { /* removed after the run */ }

const pm = packVoxelModel(quadruped16, () => 1);
const clips = pm.clips ? pm.clips.length : 0;
const mkInst = (i) => ({ x: 3 + i * 0.37, y: 5 - i * 0.21, z: 1, yawDeg: (i * 23.7) % 360, clip: clips ? i % clips : -1, frame: i % 3, tMs: (i * 13) % 80, scale: 1 });
const outN = new Float64Array(MAX_VOX_PARTS * PART_STRIDE), outO = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
const pabN = new Float64Array(MAX_VOX_PARTS * 6), pabO = new Float64Array(MAX_VOX_PARTS * 6);
const proj = { cols: 480, rows: 180, pitched: true, ortho: false, near: 0.05, eyeX: 0, eyeY: -8, eyeZ: 2, fX: 0, fY: 1, fZ: 0, rX: 1, rY: 0, uX: 0, uY: 0, uZ: 1, tanHalfX: 1.2, tanHalfY: 0.5, planeDet: 1 };
const same = (a, b, n) => { for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i])) return false; return true; };
let bad = 0;
for (let i = 0; i < 400; i++) {
  const inst = mkInst(i);
  NEWP.computeVoxelPose(pm, inst, outN); const fN = Float64Array.from(NEWP.FORWARD.subarray(0, pm.partCount * 12));
  OLDP.computeVoxelPose(pm, inst, outO); const fO = Float64Array.from(OLDP.FORWARD.subarray(0, pm.partCount * 12));
  if (!same(outN, outO, pm.partCount * PART_STRIDE) || !same(fN, fO, fN.length)) bad++;
  const rN = {}, rO = {};
  NEWR.rectFromForward(proj, pm, fN, pabN, rN); OLDR.rectFromForward(proj, pm, fO, pabO, rO);
  if (JSON.stringify(rN) !== JSON.stringify(rO) || !same(pabN, pabO, pm.partCount * 6)) bad++;
}
console.log(`identity: ${bad === 0 ? 'OK' : 'MISMATCH x' + bad} (400 poses, ${pm.partCount} parts, ${clips} clips)`);

function time(label, fn, n = 20000) {
  for (let i = 0; i < 2000; i++) fn(i);
  const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) fn(i);
  const us = Number(process.hrtime.bigint() - t) / 1000 / n; console.log(label.padEnd(28), us.toFixed(3), 'us/call'); return us;
}
const insts = Array.from({ length: 64 }, (_, i) => mkInst(i)); const F = Float64Array.from(NEWP.FORWARD);
const rr = {};
time('pose OLD', (i) => OLDP.computeVoxelPose(pm, insts[i & 63], outO));
time('pose NEW', (i) => NEWP.computeVoxelPose(pm, insts[i & 63], outN));
time('rectFromForward OLD', () => OLDR.rectFromForward(proj, pm, F, null, rr));
time('rectFromForward NEW', () => NEWR.rectFromForward(proj, pm, F, null, rr));
for (const f of tmp) fs.unlinkSync(f);
process.exit(bad ? 1 : 0);
