// game/js/quest/bearKnee.test.js (ANIM-B-01a, architecture.md 38.67 item 2): bear + black bear knee rig.
//   node game/js/quest/bearKnee.test.js
import { validateVoxelModel } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import '../../../design/models/voxel_bear.js';
import '../../../design/models/voxel_bear_black.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
import { CONFIGS, defOf } from '../../../tools/gait-configs.mjs';
import { plantedError, genGait } from '../../../tools/gait-lib.mjs';
const A = globalThis.ASSETS, CFG = Object.fromEntries(CONFIGS.filter((c) => c.id.startsWith('bear.')).map((c) => [c.clip, c]));   // ANIM-B-01 follow-up: generator = tools/gen-gait.mjs

// the 8-part boxes of the shipped bear before the split (voxel_bear.js v1.53)
const OLD = {
  body: [8, 10, 9, 20, 33, 22], head: [8, 0, 10, 20, 10, 18], jaw: [11, 0, 8, 17, 7, 10], ears: [9, 5, 18, 19, 9, 20],
  armL: [3, 10, 0, 11, 18, 19], armR: [17, 10, 0, 25, 18, 19], legL: [3, 22, 0, 11, 34, 21], legR: [17, 22, 0, 25, 34, 21],
};
// voxel ownership by part: first box claims a cell (engine rule); returns Map "x,y,z" -> "partOwnerBaseName|char"
function owners(def, boxes) {
  const claimed = new Map();
  for (const [name, b] of boxes) {
    for (let z = b[2]; z < b[5]; z++) for (let y = b[1]; y < b[4]; y++) {
      const row = def.layers[z][y];
      for (let x = b[0]; x < b[3]; x++) { const k = x + ',' + y + ',' + z; if (!claimed.has(k) && row[x] !== '.') claimed.set(k, [name, row[x]]); }
    }
  }
  return claimed;
}

for (const key of ['bear', 'bearBlack']) {
  const def = A.models[key].voxel, names = Object.keys(def.parts);
  const v = validateVoxelModel(def, {});
  ok(`${key}: validates (incl. legRig)`, v.errors.length === 0, JSON.stringify(v.errors));
  ok(`${key}: 12 parts, meshOnly, first 8 names/order unchanged`, names.length === 12 && def.meshOnly === true &&
     names.slice(0, 8).join() === 'body,head,jaw,ears,armL,armR,legL,legR', names.join());
  ok(`${key}: lower parts appended, parent = upper`, ['armL', 'armR', 'legL', 'legR'].every((u) => def.parts[u + '2'] && def.parts[u + '2'].parent === u && names.indexOf(u + '2') >= 8));
  // voxel identity: same count, same voxels + materials; only the owner of the leg voxels is re-assigned (upper/lower of the SAME old limb)
  const oldO = owners(def, Object.entries(OLD)), newO = owners(def, names.map((n) => [n, def.parts[n].box]));
  let same = oldO.size === newO.size, bad = '';
  for (const [k, [n, ch]] of oldO) {
    const nw = newO.get(k);
    if (!nw || nw[1] !== ch || (nw[0] !== n && nw[0] !== n + '2')) { same = false; bad = k; break; }
  }
  ok(`${key}: voxel identity (${oldO.size} voxels, same cells + materials, owners only split upper/lower)`, same, bad);
  // legacy clips leave the lower parts unkeyed -> rigid with the upper part (all old clips pose every voxel as before)
  const legacy = Object.keys(def.animations).filter((c) => c !== 'walk' && c !== 'charge' && c !== 'run');
  const unkeyed = legacy.every((c) => def.animations[c].frames.every((f) => !f.armL2 && !f.armR2 && !f.legL2 && !f.legR2));
  ok(`${key}: legacy clips (${legacy.join(',')}) leave the lower parts unkeyed`, unkeyed);
  ok(`${key}: legRig stand = idle, walk gait = GAIT.walk`, def.legRig.stand[0] === 'idle' && def.legRig.gaits.walk.tunedMps === CFG.walk.G.v && def.legRig.legs.length === 4);
}
ok('black bear: charge gait declared + clip regenerated', A.models.bearBlack.voxel.legRig.gaits.charge.tunedMps === CFG.charge.G.v && A.models.bearBlack.voxel.animations.charge.frames.length === CFG.charge.keys);

// planted feet (<= 12 mm over stance, tools/gait-lib plantedError) + shipped clip == generated (gen-gait is the only source)
for (const gname of ['walk', 'charge']) {
  const cfg = CFG[gname], def = defOf(cfg), shipped = def.animations[gname], gen = genGait(def, cfg).clip;
  const worst = plantedError(def, cfg, shipped, 4);
  ok(`${gname}: planted foot z <= 12 mm over stance (worst ${(worst * 1000).toFixed(2)} mm)`, worst <= 0.012);
  ok(`${gname}: shipped clip == tools/gen-gait.mjs output`, JSON.stringify(shipped.frames) === JSON.stringify(gen.frames) && JSON.stringify(shipped.durations) === JSON.stringify(gen.durations));
}
console.log(`bearKnee: ${pass} pass, ${fail} fail`);
if (fail) { console.error(failures.join('\n')); process.exit(1); }
