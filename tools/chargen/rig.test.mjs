// node tools/chargen/rig.test.mjs - RIG-02a (docs/architecture.md 38.32 item 8 a + e): buildGlb -> readRiggedGlb ->
// riggedFromGlb vs the direct composeCharacter -> meshCharacter model, and collapseRig of both.
import { readRiggedGlb, riggedFromGlb, collapseRig, HUMANOID_PART_MAP } from '../../engine/index.js';
import { makeOk } from '../../engine/test/assert.js';
import { loadKit, buildGlb, DEMO_CLIPS } from './export.mjs';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const near = (a, b, e) => Math.abs(a - b) <= e;

const kit = loadKit();
const { rigged: direct, glb } = buildGlb(kit, kit.defaults, { clips: DEMO_CLIPS });
const raw = readRiggedGlb(glb, 'rt');
const back = riggedFromGlb(raw);

// ---- bones / sides
ok('same bone names, order and parents', direct.bones.length === back.bones.length
  && direct.bones.every((b, i) => b.name === back.bones[i].name && (b.parent ?? null) === back.bones[i].parent));
let jerr = 0;
direct.bones.forEach((b, i) => b.joint.forEach((v, a) => { jerr = Math.max(jerr, Math.abs(v - back.bones[i].joint[a])); }));
ok(`joints within 1e-5 m (max ${jerr.toExponential(2)})`, jerr < 1e-5);
const bi = (m, n) => m.bones.find((b) => b.name === n);
ok('LeftHand stays at -x, RightHand at +x', bi(back, 'LeftHand').joint[0] < 0 && bi(back, 'RightHand').joint[0] > 0
  && Math.sign(bi(back, 'LeftHand').joint[0]) === Math.sign(bi(direct, 'LeftHand').joint[0]));
ok('Head above Hips, y matches (front/back not swapped)', bi(back, 'Head').joint[2] > bi(back, 'Hips').joint[2] && near(bi(back, 'Jaw').joint[1], bi(direct, 'Jaw').joint[1], 1e-5));

// ---- mesh
ok('quad count equal', direct.mesh.quads === back.mesh.quads);
let perr = 0;
for (let i = 0; i < direct.mesh.pos.length; i++) perr = Math.max(perr, Math.abs(direct.mesh.pos[i] - back.mesh.pos[i]));
ok(`quad positions within 1e-5 m, same per-bone order (max ${perr.toExponential(2)})`, perr < 1e-5);
ok('normals equal', direct.mesh.nrm.every((v, i) => v === back.mesh.nrm[i]));
ok('mat + matKeys equal', direct.mesh.mat.every((v, i) => v === back.mesh.mat[i]) && direct.matKeys.join() === back.matKeys.join());
ok('ranges equal', direct.mesh.ranges.every((r, i) => r.start === back.mesh.ranges[i].start && r.count === back.mesh.ranges[i].count));
ok('mounts equal in cells from the anchor', Object.keys(direct.mounts).every((k) => {
  const h = direct.bones[0], anchor = h.jointCells.map((c, a) => c - h.joint[a] / direct.cellM);
  return direct.mounts[k].every((v, a) => near(v - anchor[a], back.mounts[k][a], 1e-3));
}));

// ---- collapseRig of both
const pd = collapseRig(direct, HUMANOID_PART_MAP), pb = collapseRig(back, HUMANOID_PART_MAP);
ok('PartRig anchorCells: direct = grid anchor (Hips jointCells - joint/cellM), from-glb = 0', pd.anchorCells.every((v, a) => near(v, direct.bones[0].jointCells[a] - direct.bones[0].joint[a] / direct.cellM, 1e-9)) && pb.anchorCells.every((v) => Math.abs(v) < 1e-9));
ok('pivotM per part equal', pd.parts.every((p, i) => p.pivotM.every((v, a) => near(v, pb.parts[i].pivotM[a], 1e-5))));
ok('pivot - anchor = pivotM / cellM', pd.parts.every((p) => p.pivot.every((v, a) => near(v - pd.anchorCells[a], p.pivotM[a] / pd.cellM, 1e-4))));
ok('same clips', Object.keys(pd.clips).sort().join() === Object.keys(pb.clips).sort().join() && Object.keys(pd.clips).length === 2);
for (const name of Object.keys(pd.clips)) {
  const a = pd.clips[name], b = pb.clips[name];
  ok(`clip ${name}: loop flag kept (${a.loop})`, a.loop === b.loop && a.durations.length === b.durations.length);
  let rerr = 0, herr = 0;
  a.frames.forEach((fa, f) => {
    for (const part of Object.keys(fa)) {
      fa[part].rot.forEach((v, k) => { rerr = Math.max(rerr, Math.abs(v - b.frames[f][part].rot[k])); });
      if (fa[part].pos) fa[part].pos.forEach((v, k) => { herr = Math.max(herr, Math.abs(v - b.frames[f][part].pos[k])); });
    }
  });
  ok(`clip ${name}: rot within 0.5 deg (max ${rerr.toFixed(3)}), Hips pos within 1e-3 cells (max ${herr.toExponential(2)})`, rerr < 0.5 && herr < 1e-3);
}

// ---- loop=false survives
const noLoop = { ...DEMO_CLIPS, wave: { ...DEMO_CLIPS.wave, loop: false } };
const r2 = readRiggedGlb(buildGlb(kit, kit.defaults, { clips: noLoop }).glb, 'nl');
ok('clip loop=false read from extras', r2.clips.find((c) => c.name === 'wave').loop === false && r2.clips.find((c) => c.name === 'idle').loop === true);

// ---- errors (item 8 e, 02a part)
const throws = (name, fn, re) => { try { fn(); ok(name, false); } catch (e) { ok(`${name} (${e.message})`, re.test(e.message)); } };
throws('non-Kestrel glb', () => riggedFromGlb({ ...raw, extras: null }), /not a Kestrel character/);
throws('non-identity rest rotation', () => riggedFromGlb({ ...raw, bones: raw.bones.map((b, i) => (i === 3 ? { ...b, rest: { ...b.rest, r: [0.1, 0, 0, 0.995] } } : b)) }), /rest rotation/);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
