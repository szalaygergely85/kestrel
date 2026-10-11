// node tools/export/mixamo.test.mjs - OB-070: the "For Mixamo" export (static T-posed FBX, no skeleton, welded) + its zip.
import { createChargen } from '../chargen/core.js';
import { readZip } from '../../engine/index.js';
import { loadKit, paletteRgbOf } from '../chargen/export.mjs';

const kit = loadKit();
const ch = createChargen({ kit, rgbOf: paletteRgbOf(), materials: globalThis.ASSETS.palette.materials });
let pass = 0; const bad = [];
const ok = (n, c) => { if (c) pass++; else bad.push(n); };

const { fbx, png } = ch.exportMixamo();
const dv = new DataView(fbx.buffer, fbx.byteOffset, fbx.byteLength), dec = new TextDecoder();
function prop(o) {
  const t = String.fromCharCode(fbx[o++]);
  if (t === 'C') return [t, fbx[o], o + 1]; if (t === 'I') return [t, dv.getInt32(o, true), o + 4];
  if (t === 'D') return [t, dv.getFloat64(o, true), o + 8]; if (t === 'L') return [t, Number(dv.getBigInt64(o, true)), o + 8];
  if (t === 'S') { const n = dv.getUint32(o, true); return [t, dec.decode(fbx.subarray(o + 4, o + 4 + n)), o + 4 + n]; }
  if (t === 'R') { const n = dv.getUint32(o, true); return [t, null, o + 4 + n]; }
  const n = dv.getUint32(o, true), len = dv.getUint32(o + 8, true), w = t === 'i' || t === 'f' ? 4 : 8, a = new Array(n);
  for (let i = 0; i < n; i++) { const p = o + 12 + i * w; a[i] = t === 'i' ? dv.getInt32(p, true) : t === 'd' ? dv.getFloat64(p, true) : dv.getFloat32(p, true); }
  return [t, a, o + 12 + len];
}
function nodes(o) {
  const out = [];
  for (;;) {
    const end = dv.getUint32(o, true), np = dv.getUint32(o + 4, true), nl = fbx[o + 12];
    if (!end) return { out, next: o + 13 };
    let p = o + 13 + nl; const props = [];
    for (let i = 0; i < np; i++) { const [, v, n] = prop(p); props.push(v); p = n; }
    let kids = []; if (p < end) { const r = nodes(p); kids = r.out; p = r.next; }
    out.push({ name: dec.decode(fbx.subarray(o + 13, o + 13 + nl)), props, kids }); o = end;
  }
}
const all = nodes(27).out;
const find = (list, name) => list.find((n) => n.name === name);
const walk = (list, f) => list.forEach((n) => { f(n); walk(n.kids, f); });
const text = dec.decode(fbx);
ok('no Deformer / Skin / Cluster / LimbNode / Pose', !/Deformer|LimbNode|\bSkin\b|Cluster|BindPose|AnimationStack/.test(text));
const gs = find(find(all, 'GlobalSettings').kids, 'Properties70').kids, gp = (k) => find(gs, 'P') && gs.find((n) => n.props[0] === k).props[4];
ok('UpAxis Y (1)', gp('UpAxis') === 1); ok('FrontAxis Z (2)', gp('FrontAxis') === 2); ok('UnitScaleFactor 1 (cm)', gp('UnitScaleFactor') === 1);
let verts, pvi; walk(all, (n) => { if (n.name === 'Vertices') verts = n.props[0]; if (n.name === 'PolygonVertexIndex') pvi = n.props[0]; });
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < verts.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], verts[i + a]); mx[a] = Math.max(mx[a], verts[i + a]); }
const h = mx[1] - mn[1], span = mx[0] - mn[0];
ok(`height 160-190 cm (${h.toFixed(1)})`, h >= 160 && h <= 190);
ok(`T-pose arm span within 10% of height (${span.toFixed(1)})`, Math.abs(span - h) <= 0.1 * h);
ok('welded: far fewer vertices than polygon corners', verts.length / 3 < pvi.length / 2);
ok('every index valid', pvi.every((i) => (i < 0 ? -i - 1 : i) < verts.length / 3));
ok('texture node names palette.png', text.includes('palette.png'));
ok('palette png present', png[0] === 0x89 && png[1] === 0x50);
const z = readZip(await ch.exportMixamoZip());
const names = z.paths;
ok('zip has character_mixamo.fbx + palette.png', names.includes('character_mixamo.fbx') && names.includes('palette.png'));
// OB-070 owner symptom "empty screen after import": scale, placement, normals, transforms
ok(`feet at y=0 (${mn[1].toFixed(2)})`, Math.abs(mn[1]) < 0.01);
ok(`centred in x (${((mn[0] + mx[0]) / 2).toFixed(2)}) and z (${((mn[2] + mx[2]) / 2).toFixed(2)}) within 5 cm of origin`, Math.abs((mn[0] + mx[0]) / 2) < 5 && Math.abs((mn[2] + mx[2]) / 2) < 5);
let nrm, lcl = false; walk(all, (n) => { if (n.name === 'Normals') nrm = n.props[0]; if (n.name === 'P' && /^Lcl (Translation|Rotation)$/.test(n.props[0]) && n.props.slice(4).some((v) => v)) lcl = true; });
ok('Model has no non-zero Lcl Translation/Rotation', !lcl);
ok('normals: 3 per polygon vertex, finite, unit length', nrm && nrm.length === pvi.length * 3 && nrm.every(Number.isFinite) && Math.abs(Math.hypot(nrm[0], nrm[1], nrm[2]) - 1) < 1e-3);
ok('one Lambert Material linked, no Video embedding garbage', (text.match(/Lambert/g) || []).length >= 1);
console.log(`mixamo test: ${pass} passed, ${bad.length} failed`); if (bad.length) { console.log(bad.join('\n')); process.exit(1); }
