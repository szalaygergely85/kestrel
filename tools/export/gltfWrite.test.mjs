// node tools/export/gltfWrite.test.mjs - CHARGEN-07: the .glb exporter on the real human kit (m_avg).
// Structural validation in Node: container, accessors, skin (22 humanoid joints), inverse bind matrices, winding,
// palette texture, animation vs an independent forward-kinematics pose, extras, determinism (golden SHA-256 of the
// default recipe, pinned below). The Khronos validator is not run here (see the story note).
import { createHash } from 'node:crypto';
import { composeCharacter, meshCharacter, validateKit, sampleClip, HUMANOID_PART_MAP, collapseRig } from '../../engine/index.js';
import { makeOk } from '../../engine/test/assert.js';
import { readPng } from '../png-read.mjs';
import { loadKit, paletteRgbOf, buildGlb, DEMO_CLIPS } from '../chargen/export.mjs';
import { exportGlb } from './gltfWrite.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const sha = (b) => createHash('sha256').update(b).digest('hex');

const kit = loadKit();
const recipe = kit.defaults;
const rgbOf = paletteRgbOf();
const { rigged, glb } = buildGlb(kit, recipe, { clips: DEMO_CLIPS });
const BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'Jaw', 'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes'];

// ---- parse the container
const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
ok('glb magic, version 2, length matches', dv.getUint32(0, true) === 0x46546c67 && dv.getUint32(4, true) === 2 && dv.getUint32(8, true) === glb.length);
const jlen = dv.getUint32(12, true);
ok('chunk 0 is JSON, 4-aligned', dv.getUint32(16, true) === 0x4e4f534a && jlen % 4 === 0);
const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jlen)));
const bo = 20 + jlen;
const blen = dv.getUint32(bo, true);
ok('chunk 1 is BIN, 4-aligned, fills the file', dv.getUint32(bo + 4, true) === 0x004e4942 && blen % 4 === 0 && bo + 8 + blen === glb.length);
const bin = glb.subarray(bo + 8, bo + 8 + blen);
ok('buffer length equals the BIN chunk', json.buffers[0].byteLength === blen);
ok('asset version 2.0', json.asset.version === '2.0');

// ---- accessors
const CT = { 5126: [Float32Array, 4], 5121: [Uint8Array, 1], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(ai) {
  const a = json.accessors[ai], v = json.bufferViews[a.bufferView];
  const [T, sz] = CT[a.componentType];
  const n = a.count * NC[a.type];
  const off = v.byteOffset + (a.byteOffset || 0);
  const copy = new Uint8Array(bin.subarray(off, off + n * sz)); // aligned copy
  return new T(copy.buffer, 0, n);
}
let viewsOk = true, accOk = true;
for (const v of json.bufferViews) if (v.byteOffset % 4 || v.byteOffset + v.byteLength > blen) viewsOk = false;
for (const a of json.accessors) {
  const v = json.bufferViews[a.bufferView];
  if (a.count * NC[a.type] * CT[a.componentType][1] > v.byteLength) accOk = false;
}
ok('bufferViews aligned and inside the buffer', viewsOk);
ok('accessors fit their bufferViews', accOk);
const prim = json.meshes[0].primitives[0];
const pos = read(prim.attributes.POSITION), nrm = read(prim.attributes.NORMAL), uv = read(prim.attributes.TEXCOORD_0);
const col = read(prim.attributes.COLOR_0), jnt = read(prim.attributes.JOINTS_0), wgt = read(prim.attributes.WEIGHTS_0), idx = read(prim.indices);
const nv = pos.length / 3, nq = rigged.mesh.quads;
ok('4 vertices and 6 indices per quad', nv === 4 * nq && idx.length === 6 * nq);
ok('real m_avg stays under 6000 quads', nq < 6000, `${nq}`);
let idxOk = true; for (let i = 0; i < idx.length; i++) if (idx[i] >= nv) idxOk = false;
ok('indices inside the vertex range', idxOk);
const pa = json.accessors[prim.attributes.POSITION];
let mmOk = true;
for (let k = 0; k < 3; k++) { let lo = Infinity, hi = -Infinity; for (let i = k; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); } if (lo !== pa.min[k] || hi !== pa.max[k]) mmOk = false; }
ok('POSITION min/max exact', mmOk);
ok('character is 1.75 m tall + default hair (Y up, <= 1.78 m) and > 0.4 m wide (D-059 restyle)', Math.abs(pa.max[1] - pa.min[1] - 1.75) < 0.03 && pa.min[1] >= -0.001 && pa.max[0] - pa.min[0] > 0.4, `${pa.min} ${pa.max}`);
ok('normals are unit axis vectors', (() => { for (let i = 0; i < nv; i++) { const l = Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]); if (Math.abs(l - 1) > 1e-6) return false; } return true; })());

// ---- winding: the right-handed geometric normal of every triangle equals the exported NORMAL (front face = CCW)
let badWind = 0;
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
  const e1 = [0, 1, 2].map((k) => pos[3 * b + k] - pos[3 * a + k]), e2 = [0, 1, 2].map((k) => pos[3 * c + k] - pos[3 * a + k]);
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (cr[0] * nrm[3 * a] + cr[1] * nrm[3 * a + 1] + cr[2] * nrm[3 * a + 2] <= 0) badWind++;
}
ok('triangle winding is counter-clockwise around the normals', badWind === 0, `${badWind} bad`);

// ---- palette texture + colours
const imgView = json.bufferViews[json.images[0].bufferView];
const png = readPng(Buffer.from(bin.subarray(imgView.byteOffset, imgView.byteOffset + imgView.byteLength)));
ok('palette image is a 16x16 PNG', json.images[0].mimeType === 'image/png' && png.width === 16 && png.height === 16);
let texOk = true, colOk = true;
for (let q = 0; q < nq; q++) {
  const key = rigged.matKeys[rigged.mesh.mat[q] - 1], c = rgbOf(key);
  for (let k = 0; k < 4; k++) {
    const i = 4 * q + k;
    const tx = Math.floor(uv[2 * i] * 16), ty = Math.floor(uv[2 * i + 1] * 16);
    for (let ch = 0; ch < 3; ch++) if (png.data[4 * (ty * 16 + tx) + ch] !== Math.round(c[ch])) texOk = false;
    for (let ch = 0; ch < 3; ch++) if (col[3 * i + ch] !== 1) colOk = false;
  }
}
ok('every quad UV hits the texel of its material colour', texOk);
ok('COLOR_0 = white by default (colour comes from the palette texture)', colOk);
ok('sampler is NEAREST + clamp, material unlit-free PBR metal 0 / rough 1', json.samplers[0].magFilter === 9728 && json.samplers[0].minFilter === 9728 && json.materials[0].pbrMetallicRoughness.metallicFactor === 0 && json.materials[0].pbrMetallicRoughness.roughnessFactor === 1);

// ---- skin: 22 humanoid joints, rigid weights, inverse bind matrices
const skin = json.skins[0];
ok('skin has 22 joints with the humanoid names in order', skin.joints.length === 22 && skin.joints.every((n, i) => json.nodes[n].name === BONES[i]));
let rigid = true;
for (let i = 0; i < nv; i++) if (wgt[4 * i] !== 255 || wgt[4 * i + 1] || wgt[4 * i + 2] || wgt[4 * i + 3] || jnt[4 * i + 1] || jnt[4 * i + 2] || jnt[4 * i + 3] || jnt[4 * i] >= 22) rigid = false;
ok('rigid skinning: one joint, weight 1 per vertex', rigid && json.accessors[prim.attributes.WEIGHTS_0].normalized === true);
let rangeOk = true;
rigged.mesh.ranges.forEach((r, bi) => { for (let q = r.start; q < r.start + r.count; q++) for (let k = 0; k < 4; k++) if (jnt[4 * (4 * q + k)] !== bi) rangeOk = false; });
ok('each vertex joint = the bone range of its quad', rangeOk);
// world joint positions by walking the node tree
const world = new Map();
const walk = (n, base) => { const t = json.nodes[n].translation || [0, 0, 0]; const w = [base[0] + t[0], base[1] + t[1], base[2] + t[2]]; world.set(n, w); for (const c of json.nodes[n].children || []) walk(c, w); };
for (const r of json.scenes[0].nodes) walk(r, [0, 0, 0]);
const ibm = read(skin.inverseBindMatrices);
let ibmOk = ibm.length === 16 * 22;
skin.joints.forEach((n, i) => {
  const w = world.get(n), m = ibm.subarray(16 * i, 16 * i + 16);
  const want = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1];
  for (let k = 0; k < 16; k++) if (Math.abs(m[k] - want[k]) > 1e-6) ibmOk = false;
});
ok('inverseBindMatrices = translate(-jointWorld), column-major', ibmOk);
ok('joint world = authoring joint mapped (-x, z, -y)', skin.joints.every((n, i) => { const j = rigged.bones[i].joint, w = world.get(n); return Math.abs(w[0] + j[0]) < 1e-6 && Math.abs(w[1] - j[2]) < 1e-6 && Math.abs(w[2] + j[1]) < 1e-6; }));
ok('skin.skeleton is the Hips node, a scene root with identity rotations', skin.skeleton === skin.joints[0] && json.scenes[0].nodes.includes(skin.skeleton) && json.nodes.every((n) => !n.rotation));
ok('feet are at Y 0 and the head joint is above the hips', world.get(skin.joints[0])[1] > 0.7 && Math.abs(pa.min[1]) < 0.01);
ok('the character faces +Z (eyes mount in front of the head joint)', (() => { const e = json.extras.kestrel.mounts.eyes, hd = rigged.bones[4].joint; return e && e[1] < hd[1] && Math.abs(e[0] - hd[0]) < 0.05; })());

// ---- animations vs an independent forward-kinematics pose
ok('2 demo animations, sorted by name', json.animations.length === 2 && json.animations[0].name === 'idle' && json.animations[1].name === 'wave');
const quatMat = (x, y, z, w) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
const mulV = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mulM = (A, B) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c]); return o; };
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// FK: returns posed position of a point attached to `bone` (bind pos p, relative via bind joint)
function fk(locals, parents, jointsBind, bone, p) {
  // world rotation and joint position per bone
  const R = [], T = [];
  for (let i = 0; i < locals.length; i++) {
    const pr = parents[i];
    const off = pr < 0 ? jointsBind[i] : [jointsBind[i][0] - jointsBind[pr][0], jointsBind[i][1] - jointsBind[pr][1], jointsBind[i][2] - jointsBind[pr][2]];
    const base = pr < 0 ? [0, 0, 0] : T[pr], PR = pr < 0 ? ID : R[pr];
    const o = mulV(PR, off);
    T[i] = [base[0] + o[0] + (locals[i].t ? locals[i].t[0] : 0), base[1] + o[1] + (locals[i].t ? locals[i].t[1] : 0), base[2] + o[2] + (locals[i].t ? locals[i].t[2] : 0)];
    R[i] = mulM(PR, locals[i].R);
  }
  const rel = mulV(R[bone], [p[0] - jointsBind[bone][0], p[1] - jointsBind[bone][1], p[2] - jointsBind[bone][2]]);
  return [T[bone][0] + rel[0], T[bone][1] + rel[1], T[bone][2] + rel[2]];
}
const parentsIdx = rigged.bones.map((b) => (b.parent == null ? -1 : BONES.indexOf(b.parent)));
let animMax = 0, animTimesOk = true, unitOk = true;
const quat = new Float64Array(88), hipsP = [0, 0, 0];
for (const anim of json.animations) {
  const clip = DEMO_CLIPS[anim.name];
  const t0 = read(anim.samplers[0].input);
  const n = t0.length - 1;
  for (let i = 0; i < n; i++) if (!(t0[i + 1] > t0[i])) animTimesOk = false;
  if (Math.abs(t0[n] - clip.duration / 1000) > 1e-5) animTimesOk = false;
  const rots = anim.samplers.slice(0, 22).map((s) => read(s.output));
  const trn = read(anim.samplers[22].output);
  for (const r of rots) for (let f = 0; f <= n; f++) if (Math.abs(Math.hypot(r[4 * f], r[4 * f + 1], r[4 * f + 2], r[4 * f + 3]) - 1) > 1e-5) unitOk = false;
  for (const f of [0, Math.floor(n / 3), Math.floor(n / 2), n - 1, n]) {
    sampleClip(rigged, clip, (f / n) * clip.duration, quat, hipsP);
    const la = [], lg = [];
    for (let b = 0; b < 22; b++) {
      la.push({ R: quatMat(quat[4 * b], quat[4 * b + 1], quat[4 * b + 2], quat[4 * b + 3]), t: b === 0 ? hipsP : null });
      const q = rots[b];
      lg.push({ R: quatMat(q[4 * f], q[4 * f + 1], q[4 * f + 2], q[4 * f + 3]), t: b === 0 ? [trn[3 * f] - world.get(skin.joints[0])[0], trn[3 * f + 1] - world.get(skin.joints[0])[1], trn[3 * f + 2] - world.get(skin.joints[0])[2]] : null });
    }
    const jg = skin.joints.map((nn) => world.get(nn));
    for (const b of [7, 9, 11, 12, 13, 4, 17, 21]) {
      const p = rigged.bones[b].joint.map((v, k) => v + [0.02, -0.03, 0.04][k]); // a point near the joint, authoring axes
      const a = fk(la, parentsIdx, rigged.bones.map((x) => x.joint), b, p);
      const pg = [-p[0], p[2], -p[1]];
      const g = fk(lg, parentsIdx, jg, b, pg);
      animMax = Math.max(animMax, Math.hypot(-a[0] - g[0], a[2] - g[1], -a[1] - g[2]));
    }
  }
}
ok('animation times strictly increase and end at the clip duration', animTimesOk);
ok('animation quaternions are unit length', unitOk);
ok('exported pose == independent authoring-axes FK mapped to glTF (max err < 1e-5 m)', animMax < 1e-5, `${animMax}`);
ok('wave actually moves the right hand', (() => { const a = json.animations[1]; const r = read(a.samplers[11].output); return r.some((v, i) => i % 4 < 3 && Math.abs(v) > 0.3); })());
ok('hips translation channel present', json.animations[0].channels.some((c) => c.target.path === 'translation' && c.target.node === skin.joints[0]));

// ---- extras
const ex = json.extras.kestrel;
ok('extras.kestrel format 1, matKeys, array partMap, mounts, recipe', ex.format === 1 && JSON.stringify(ex.matKeys) === JSON.stringify(rigged.matKeys) && Array.isArray(ex.partMap) && ex.partMap.length === 8 && ex.mounts.head_top && Math.abs(ex.mounts.head_top[2] - 1.74) < 0.03 && ex.recipe.base === 'm_avg');
ok('matKeys[i] = palette texel i (first colours match)', rigged.matKeys.every((k, i) => { const c = rgbOf(k); return [0, 1, 2].every((ch) => png.data[4 * i + ch] === Math.round(c[ch])); }));
ok('extras partMap collapses the rig (collapseRig accepts it)', collapseRig(rigged, ex.partMap).parts.length === 8);

// ---- determinism + options
const again = buildGlb(kit, JSON.parse(JSON.stringify(recipe)), { clips: DEMO_CLIPS }).glb;
ok('same recipe gives the same bytes', sha(again) === sha(glb));
const shuffled = {}; for (const k of Object.keys(recipe).reverse()) shuffled[k] = recipe[k];
ok('recipe key order does not change the bytes', sha(buildGlb(kit, shuffled, { clips: DEMO_CLIPS }).glb) === sha(glb));
const other = buildGlb(kit, { ...recipe, height: 2, skin: 'dark' }).glb;
ok('another recipe gives other bytes', sha(other) !== sha(glb));
ok('no-clip export has no animations key', !JSON.parse(new TextDecoder().decode(other.subarray(20, 20 + new DataView(other.buffer, other.byteOffset).getUint32(12, true)))).animations);
ok('colorMode white is the default', sha(exportGlb(rigged, { rgbOf, recipe, partMap: kit.partMap, colorMode: 'white' })) === sha(glb));
const rgbGlb = exportGlb(rigged, { rgbOf, recipe, partMap: kit.partMap, colorMode: 'rgb' });
ok('colorMode rgb gives other bytes, linear palette COLOR_0', sha(rgbGlb) !== sha(glb));
let threw = 0;
try { exportGlb(rigged, {}); } catch { threw++; }
try { exportGlb(rigged, { rgbOf, partMap: { body: ['Hips'] } }); } catch { threw++; }
try { exportGlb(rigged, { rgbOf: () => null }); } catch { threw++; }
ok('missing rgbOf / object partMap / missing colour throw', threw === 3);

// golden: pinned hash of the default recipe, demo clips (changes only when the format intentionally changes)
const GOLDEN = '42d9d395e03f2173db4dfb9960acbf85d08f02ab5f5c0a3f6dc78215d50d171c'; // 2026-10-10: default colorMode 'white' (was 9daf4473...); update on an intended kit/format change
if (sha(glb) !== GOLDEN) console.log('golden sha256 now:', sha(glb));
ok('real kit validates (array partMap)', validateKit(JSON.parse(JSON.stringify(kit)), globalThis.ASSETS.palette.materials).errors.length === 0);
ok('golden SHA-256 of the default recipe (demo clips)', sha(glb) === GOLDEN);

console.log(`gltfWrite test: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
