// node tools/export/fbxWrite.test.mjs - CHARGEN-10: the static binary FBX 7.4 exporter on the real human kit.
// An independent minimal binary-FBX reader (below) parses the bytes: header, node offsets, footer, geometry vs the mesh,
// winding vs normals, UV / colour layers, material + texture connections, units/axes, determinism, golden SHA-256.
import { createHash } from 'node:crypto';
import { makeOk } from '../../engine/test/assert.js';
import { readPng } from '../png-read.mjs';
import { loadKit, paletteRgbOf, buildGlb } from '../chargen/export.mjs';
import { exportFbx } from './fbxWrite.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const sha = (b) => createHash('sha256').update(b).digest('hex');

const kit = loadKit();
const rgbOf = paletteRgbOf();
const { rigged } = buildGlb(kit, kit.defaults);
const { fbx, png } = exportFbx(rigged, { rgbOf });

// ---- reader
const dv = new DataView(fbx.buffer, fbx.byteOffset, fbx.byteLength);
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
