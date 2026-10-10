// node tools/export/fbxWrite.test.mjs - CHARGEN-10: the static binary FBX 7.4 exporter on the real human kit.
// An independent minimal binary-FBX reader (below) parses the bytes: header, node offsets, footer, geometry vs the mesh,
// winding vs normals, UV / colour layers, material + texture connections, units/axes, determinism, golden SHA-256.
import { createHash } from 'node:crypto';
import { makeOk } from '../../engine/test/assert.js';
import { readPng } from '../png-read.mjs';
import { loadKit, paletteRgbOf, buildGlb, DEMO_CLIPS } from '../chargen/export.mjs';
import { sampleClip } from '../../engine/index.js';
import { exportFbx } from './fbxWrite.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const sha = (b) => createHash('sha256').update(b).digest('hex');

const kit = loadKit();
const rgbOf = paletteRgbOf();
const { rigged } = buildGlb(kit, kit.defaults);
let { fbx, png } = exportFbx(rigged, { rgbOf });

// ---- reader
let dv = new DataView(fbx.buffer, fbx.byteOffset, fbx.byteLength);
const dec = new TextDecoder();
function readProp(o) {
  const t = String.fromCharCode(fbx[o++]);
  switch (t) {
    case 'C': return [t, fbx[o], o + 1];
    case 'I': return [t, dv.getInt32(o, true), o + 4];
    case 'D': return [t, dv.getFloat64(o, true), o + 8];
    case 'L': return [t, Number(dv.getBigInt64(o, true)), o + 8];
    case 'S': { const n = dv.getUint32(o, true); return [t, dec.decode(fbx.subarray(o + 4, o + 4 + n)), o + 4 + n]; }
    case 'R': { const n = dv.getUint32(o, true); return [t, fbx.slice(o + 4, o + 4 + n), o + 4 + n]; }
    default: {
      const n = dv.getUint32(o, true), enc = dv.getUint32(o + 4, true), len = dv.getUint32(o + 8, true), w = t === 'i' || t === 'f' ? 4 : 8;
      if (enc !== 0 || len !== n * w) throw new Error('array encoding/length');
      const a = new Array(n);
      for (let i = 0; i < n; i++) { const p = o + 12 + i * w; a[i] = t === 'i' ? dv.getInt32(p, true) : t === 'd' ? dv.getFloat64(p, true) : t === 'f' ? dv.getFloat32(p, true) : Number(dv.getBigInt64(p, true)); }
      return [t, a, o + 12 + len];
    }
  }
}
function readAll(buf) { // same reader on another buffer: swap the module-level views, parse, swap back
  const sf = fbx, sd = dv; try { fbx = buf; dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); return readNodes(HEAD.length + 4).nodes; } finally { fbx = sf; dv = sd; }
}
let offsetsOk = true;
function readNodes(o, end) { // child list ending in a 13-byte null record
  const out = [];
  for (;;) {
    const endOff = dv.getUint32(o, true), np = dv.getUint32(o + 4, true), pl = dv.getUint32(o + 8, true), nl = fbx[o + 12];
    if (endOff === 0) { if (np || pl || nl) offsetsOk = false; return { nodes: out, next: o + 13 }; }
    const name = dec.decode(fbx.subarray(o + 13, o + 13 + nl));
    let p = o + 13 + nl;
    const props = [];
    for (let i = 0; i < np; i++) { const [t, v, n] = readProp(p); props.push({ t, v }); p = n; }
    if (p - (o + 13 + nl) !== pl) offsetsOk = false;
    let kids = [];
    if (p < endOff) { const r = readNodes(p, endOff); kids = r.nodes; p = r.next; }
    if (p !== endOff) offsetsOk = false;
    out.push({ name, props, kids });
    o = endOff;
  }
}
const HEAD = 'Kaydara FBX Binary  \0\x1a\0';
ok('header magic + version 7400', dec.decode(fbx.subarray(0, HEAD.length)) === HEAD && dv.getUint32(HEAD.length, true) === 7400);
const top = readNodes(HEAD.length + 4);
ok('every node end offset / props length is exact, null records zero', offsetsOk);
const roots = top.nodes;
const find = (list, name) => list.find((n) => n.name === name);
const footStart = top.next;
const footEnd = fbx.length - 4 - 120 - 16;
ok('footer: id, zeros, 16-aligned padding, version, 120 zero bytes, magic', fbx[footStart] === 0xfa && fbx[fbx.length - 16] === 0xf8 && dv.getUint32(footEnd, true) === 7400 && footEnd % 16 === 0 && fbx.subarray(footEnd + 4, footEnd + 124).every((b) => b === 0) && fbx.subarray(footStart + 16, footStart + 20).every((b) => b === 0));
ok('top-level order', roots.map((n) => n.name).join() === 'FBXHeaderExtension,FileId,CreationTime,Creator,GlobalSettings,Documents,References,Definitions,Objects,Connections,Takes');

// ---- global settings: Y up, +Z front, cm
const gs = find(roots, 'GlobalSettings').kids.find((n) => n.name === 'Properties70').kids;
const gprop = (n) => gs.find((p) => p.props[0].v === n).props[4].v;
ok('Y-up, front +Z, X coord, centimetres', gprop('UpAxis') === 1 && gprop('UpAxisSign') === 1 && gprop('FrontAxis') === 2 && gprop('FrontAxisSign') === 1 && gprop('CoordAxis') === 0 && gprop('UnitScaleFactor') === 1);

// ---- geometry vs the mesh
const objs = find(roots, 'Objects').kids;
const geo = find(objs, 'Geometry');
const verts = find(geo.kids, 'Vertices').props[0].v, pvi = find(geo.kids, 'PolygonVertexIndex').props[0].v;
const nq = rigged.mesh.quads;
ok('4 vertices and 4 polygon indices per quad, one negated end per polygon', verts.length === 12 * nq && pvi.length === 4 * nq && pvi.every((v, i) => (i % 4 === 3) === (v < 0)));
let posOk = true;
const m = rigged.mesh;
for (let i = 0; i < 4 * nq; i++) {
  if (Math.abs(verts[3 * i] + m.pos[3 * i] * 100) > 1e-9 || Math.abs(verts[3 * i + 1] - m.pos[3 * i + 2] * 100) > 1e-9 || Math.abs(verts[3 * i + 2] + m.pos[3 * i + 1] * 100) > 1e-9) posOk = false;
}
ok('positions are the authoring positions in Y-up centimetres', posOk);
let ymin = Infinity, ymax = -Infinity;
for (let i = 1; i < verts.length; i += 3) { ymin = Math.min(ymin, verts[i]); ymax = Math.max(ymax, verts[i]); }
console.log(`height ${(ymax - ymin).toFixed(1)} cm, ymin ${ymin.toFixed(1)}`);
ok('character is ~1.75 m (cm) tall, feet at y 0', Math.abs(ymin) < 1e-6 && ymax > 150 && ymax < 200);

// winding: polygon face normal agrees with the stored normal
const nrm = find(find(geo.kids, 'LayerElementNormal').kids, 'Normals').props[0].v;
let windOk = true, nrmUnit = true;
for (let q = 0; q < nq; q++) {
  const ix = [0, 1, 2].map((k) => pvi[4 * q + k]);
  const P = ix.map((i) => [verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]]);
  const e1 = P[1].map((v, k) => v - P[0][k]), e2 = P[2].map((v, k) => v - P[0][k]);
  const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const nn = nrm.slice(12 * q, 12 * q + 3);
  if (c[0] * nn[0] + c[1] * nn[1] + c[2] * nn[2] <= 0) windOk = false;
  if (Math.abs(Math.hypot(...nn) - 1) > 1e-6) nrmUnit = false;
}
ok('counter-clockwise winding matches the normals', windOk);
ok('normals are unit length', nrmUnit && nrm.length === 12 * nq);

// ---- UV layer hits the palette texel of each quad's material
const pngImg = readPng(Buffer.from(png));
const uvL = find(geo.kids, 'LayerElementUV').kids;
const uv = find(uvL, 'UV').props[0].v, uvIdx = find(uvL, 'UVIndex').props[0].v;
let uvOk = uvIdx.length === 4 * nq;
for (let q = 0; q < nq; q++) {
  const key = rigged.matKeys[rigged.mesh.mat[q] - 1], c = rgbOf(key);
  for (let j = 0; j < 4; j++) {
    const k = uvIdx[4 * q + j];
    const tx = Math.floor(uv[2 * k] * 16), ty = Math.floor(uv[2 * k + 1] * 16);
    for (let ch = 0; ch < 3; ch++) if (pngImg.data[4 * (ty * 16 + tx) + ch] !== Math.round(c[ch])) uvOk = false;
  }
}
ok('every polygon vertex UV hits the texel of its material colour', uvOk);

// ---- colour layer: white by default
const colL = find(geo.kids, 'LayerElementColor').kids;
ok('colour layer is white by default', find(colL, 'Colors').props[0].v.join() === '1,1,1,1' && find(colL, 'ColorIndex').props[0].v.every((v) => v === 0));
const rgb = exportFbx(rigged, { rgbOf, colorMode: 'rgb' }).fbx;
ok('colorMode rgb gives other bytes', sha(rgb) !== sha(fbx));
ok('colorMode white is the default', sha(exportFbx(rigged, { rgbOf, colorMode: 'white' }).fbx) === sha(fbx));

// ---- material, texture, connections
const mat = find(objs, 'Material'), tex = find(objs, 'Texture'), model = find(objs, 'Model');
ok('one Model(Mesh), Geometry, Material, Texture', objs.length === 4 && model.props[2].v === 'Mesh' && find(tex.kids, 'RelativeFilename').props[0].v === 'palette.png');
const id = (n) => n.props[0].v;
const cons = find(roots, 'Connections').kids.map((c) => c.props.map((p) => p.v).join('|'));
ok('connections: model->root, geometry->model, material->model, texture->material DiffuseColor',
  cons.includes(`OO|${id(model)}|0`) && cons.includes(`OO|${id(geo)}|${id(model)}`) && cons.includes(`OO|${id(mat)}|${id(model)}`) && cons.includes(`OP|${id(tex)}|${id(mat)}|DiffuseColor`));
ok('palette png decodes 16x16 and matches the palette', pngImg.width === 16 && pngImg.height === 16);

// ---- CHARGEN-11: skeleton + skin + bind pose
{
  const sk = exportFbx(rigged, { rgbOf, skeleton: true }).fbx;
  ok('skeleton export differs from static (static is pinned by the golden below)', sha(sk) !== sha(fbx));
  const rd = readAll(sk);
  const o2 = find(rd, 'Objects').kids;
  const limbs = o2.filter((n) => n.name === 'Model' && n.props[2].v === 'LimbNode');
  const bn = (n) => n.props[1].v.split('\0')[0];
  ok('22 LimbNode models', limbs.length === 22 && rigged.bones.length === 22);
  const idOf = new Map(limbs.map((n) => [bn(n), n.props[0].v]));
  const limbIds = new Set(limbs.map((l) => l.props[0].v));
  const cons2 = find(rd, 'Connections').kids.map((c) => c.props.map((p) => p.v));
  const parentOf = (bid) => cons2.find((c) => c[0] === 'OO' && c[1] === bid && (c[2] === 0 || limbIds.has(c[2])))?.[2];
  ok('LimbNode names and parents match the rig', rigged.bones.every((b) => idOf.get(b.name) !== undefined && parentOf(idOf.get(b.name)) === (b.parent == null ? 0 : idOf.get(b.parent))));
  ok('exactly one root bone, connected to the scene root', limbs.filter((l) => parentOf(l.props[0].v) === 0).length === 1);
  const geo2 = find(o2, 'Geometry'), skin = o2.find((n) => n.name === 'Deformer' && n.props[2].v === 'Skin');
  ok('skin deformer connects to the geometry', cons2.some((c) => c[0] === 'OO' && c[1] === skin.props[0].v && c[2] === geo2.props[0].v));
  const clusters = o2.filter((n) => n.name === 'Deformer' && n.props[2].v === 'Cluster');
  ok('one cluster per bone, under the skin, linked to its bone', clusters.length === 22 && clusters.every((c) => {
    const cid = c.props[0].v, link = cons2.find((x) => x[0] === 'OO' && x[2] === cid && limbIds.has(x[1]));
    return cons2.some((x) => x[0] === 'OO' && x[1] === cid && x[2] === skin.props[0].v) && link && idOf.get(bn(c)) === link[1];
  }));
  const cnt = new Array(4 * nq).fill(0);
  let wOk = true, tlOk = true;
  for (const c of clusters) {
    const ix = find(c.kids, 'Indexes').props[0].v, w = find(c.kids, 'Weights').props[0].v;
    if (ix.length !== w.length || !w.every((x) => x === 1)) wOk = false;
    ix.forEach((i) => cnt[i]++);
    const b = rigged.bones.find((x) => x.name === bn(c)), tl = find(c.kids, 'TransformLink').props[0].v;
    if (Math.abs(tl[12] + b.joint[0] * 100) > 1e-9 || Math.abs(tl[13] - b.joint[2] * 100) > 1e-9 || Math.abs(tl[14] + b.joint[1] * 100) > 1e-9 || tl[15] !== 1) tlOk = false;
  }
  ok('every vertex is in exactly one cluster, weights 1.0', cnt.every((c) => c === 1) && wOk);
  ok('cluster TransformLink = bone joint in Y-up cm', tlOk);
  const pose = find(o2, 'Pose'), pn = pose.kids.filter((k) => k.name === 'PoseNode').map((k) => find(k.kids, 'Node').props[0].v);
  ok('bind pose has all 22 bones + the mesh', find(pose.kids, 'NbPoseNodes').props[0].v === 23 && limbs.every((l) => pn.includes(l.props[0].v)) && pn.includes(id(find(o2, 'Model'))));
  ok('skeleton export is deterministic', sha(exportFbx(rigged, { rgbOf, skeleton: true }).fbx) === sha(sk));
}

// ---- CHARGEN-12: animation stacks
{
  const cr = buildGlb(kit, kit.defaults, { clips: DEMO_CLIPS }).rigged;
  const noClips = exportFbx(cr, { rgbOf, skeleton: true }).fbx;
  ok('clips off: bytes equal the CHARGEN-11 skeleton export of the same model', sha(noClips) === sha(exportFbx(rigged, { rgbOf, skeleton: true }).fbx));
  const withC = exportFbx(cr, { rgbOf, skeleton: true, clips: true }).fbx;
  ok('clips add bytes, clips without skeleton throws', sha(withC) !== sha(noClips) && (() => { try { exportFbx(cr, { rgbOf, clips: true }); } catch { return true; } return false; })());
  const rd = readAll(withC), o3 = find(rd, 'Objects').kids, c3 = find(rd, 'Connections').kids.map((c) => c.props.map((p) => p.v));
  const stacks = o3.filter((n) => n.name === 'AnimationStack'), layers = o3.filter((n) => n.name === 'AnimationLayer');
  const names = Object.keys(DEMO_CLIPS).sort();
  ok('one AnimationStack + AnimationLayer per clip, named after the clip', stacks.length === 2 && layers.length === 2 && stacks.map((n) => n.props[1].v.split(' ')[0]).join() === names.join());
  ok('layer -> stack connections', stacks.every((st, i) => c3.some((c) => c[0] === 'OO' && c[1] === layers[i].props[0].v && c[2] === st.props[0].v)));
  const nodes = o3.filter((n) => n.name === 'AnimationCurveNode'), curves = o3.filter((n) => n.name === 'AnimationCurve');
  ok('per clip: 22 R + 1 T curve node, 3 curves each', nodes.length === 2 * 23 && curves.length === 2 * 23 * 3);
  const limbId = new Map(o3.filter((n) => n.name === 'Model' && n.props[2].v === 'LimbNode').map((n) => [n.props[1].v.split(' ')[0], n.props[0].v]));
  const TICKS = 46186158000;
  let keysOk = true, lastOk = true, valsOk = true;
  const tempo = cr.tempo || 1;
  names.forEach((cn, ci) => {
    const clip = DEMO_CLIPS[cn], durS = clip.duration / 1000 / tempo, n = Math.max(1, Math.round(durS * 30));
    const layer = layers[ci].props[0].v;
    const myNodes = nodes.filter((nd) => c3.some((c) => c[0] === 'OO' && c[1] === nd.props[0].v && c[2] === layer));
    if (myNodes.length !== 23) keysOk = false;
    const rotNode = (bone) => myNodes.find((nd) => c3.some((c) => c[0] === 'OP' && c[1] === nd.props[0].v && c[2] === limbId.get(bone) && c[3] === 'Lcl Rotation'));
    const curveOf = (nd, ax) => curves.find((cv) => c3.some((c) => c[0] === 'OP' && c[1] === cv.props[0].v && c[2] === nd.props[0].v && c[3] === 'd|' + ax));
    for (const bone of ['Spine', 'RightUpperArm']) {
      const nd = rotNode(bone), cx = curveOf(nd, 'X');
      const kt = find(cx.kids, 'KeyTime').props[0].v, kv = find(cx.kids, 'KeyValueFloat').props[0].v;
      if (kt.length !== n + 1 || kv.length !== n + 1 || kt[0] !== 0) keysOk = false;
      if (kt[n] !== Math.round(durS * TICKS)) lastOk = false;
      if (!kt.every((t, i) => i === 0 || t > kt[i - 1])) keysOk = false;
      // key at frame f: Euler XYZ (Rz*Ry*Rx) rebuilt into a quaternion equals the sampled clip quaternion (in FBX axes)
      const f = Math.floor(n / 3), q = new Float64Array(4 * cr.bones.length), h = [0, 0, 0];
      sampleClip(cr, clip, (f / n) * clip.duration, q, h);
      const bi = cr.bones.findIndex((b) => b.name === bone), e = ['X', 'Y', 'Z'].map((a) => find(curveOf(nd, a).kids, 'KeyValueFloat').props[0].v[f] * Math.PI / 180);
      const cx_ = Math.cos(e[0] / 2), sx = Math.sin(e[0] / 2), cy = Math.cos(e[1] / 2), sy = Math.sin(e[1] / 2), cz = Math.cos(e[2] / 2), sz = Math.sin(e[2] / 2);
      const w = cz * cy * cx_ + sz * sy * sx, x = cz * cy * sx - sz * sy * cx_, y = cz * sy * cx_ + sz * cy * sx, z = sz * cy * cx_ - cz * sy * sx;
      const want = [q[4 * bi], -q[4 * bi + 2], q[4 * bi + 1], q[4 * bi + 3]], dot = Math.abs(x * want[0] + y * want[1] + z * want[2] + w * want[3]);
      if (Math.abs(dot - 1) > 1e-4) valsOk = false;
    }
  });
  ok('key count = round(duration*30)+1 and times strictly increase from 0', keysOk);
  ok('last KeyTime = clip duration in FBX ticks (46186158000/s)', lastOk);
  ok('Euler XYZ keys rebuild the sampled clip rotation', valsOk);
  const defs = find(rd, 'Definitions').kids.filter((n) => n.name === 'ObjectType');
  ok('Definitions count the animation object types', defs.find((d) => d.props[0].v === 'AnimationStack').kids[0].props[0].v === 2 && defs.find((d) => d.props[0].v === 'AnimationCurve').kids[0].props[0].v === curves.length);
  ok('clip export is deterministic', sha(exportFbx(cr, { rgbOf, skeleton: true, clips: true }).fbx) === sha(withC));
}

// ---- determinism + inputs
const again = exportFbx(buildGlb(kit, JSON.parse(JSON.stringify(kit.defaults))).rigged, { rgbOf }).fbx;
ok('same recipe gives the same bytes', sha(again) === sha(fbx));
ok('another recipe gives other bytes', sha(exportFbx(buildGlb(kit, { ...kit.defaults, height: 2, skin: 'dark' }).rigged, { rgbOf }).fbx) !== sha(fbx));
let threw = 0;
try { exportFbx(rigged, {}); } catch { threw++; }
try { exportFbx(rigged, { rgbOf, colorMode: 'x' }); } catch { threw++; }
try { exportFbx(rigged, { rgbOf: () => null }); } catch { threw++; }
ok('missing rgbOf / bad colorMode / missing colour throw', threw === 3);

const GOLDEN = 'a651ae1e927f11a123c853928e0ce919810367c13a911452051bc6acc66039b3';
const got = sha(fbx);
if (got !== GOLDEN) console.log('golden sha256 now:', got);
ok('golden SHA-256 of the default recipe', got === GOLDEN);

console.log(`fbxWrite test: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
