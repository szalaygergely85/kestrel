// node tools/export/objWrite.test.mjs - CHARGEN-12: OBJ + MTL exporter on the real human kit.
import { makeOk } from '../../engine/test/assert.js';
import { readPng } from '../png-read.mjs';
import { loadKit, paletteRgbOf, buildGlb } from '../chargen/export.mjs';
import { exportObj } from './objWrite.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const kit = loadKit(), rgbOf = paletteRgbOf();
const { rigged } = buildGlb(kit, kit.defaults);
const r = exportObj(rigged, { rgbOf });
const lines = r.obj.split('\n');
const nq = rigged.mesh.quads;
const groups = lines.filter((l) => l.startsWith('g ')).map((l) => l.slice(2));
const withQuads = rigged.bones.filter((_, i) => rigged.mesh.ranges[i].count).map((b) => b.name);
ok('one g group per bone (skeleton order, empty bones skipped)', groups.join() === withQuads.join() && groups.length > 10);
ok('every group name is a bone name', groups.every((g) => rigged.bones.some((b) => b.name === g)));
const faces = lines.filter((l) => l.startsWith('f '));
ok('face count = mesh quads, 4 corners each', faces.length === nq && faces.every((f) => f.split(' ').length === 5));
ok('v / vn / vt counts', lines.filter((l) => l.startsWith('v ')).length === 4 * nq && lines.filter((l) => l.startsWith('vn ')).length === nq && lines.filter((l) => l.startsWith('vt ')).length === rigged.matKeys.length);
// faces of each group belong to that bone's quad range
let rangeOk = true, qi = 0;
for (const l of lines) if (l.startsWith('f ')) { const q = +l.split(' ')[1].split('/')[2] - 1; if (q !== qi++) rangeOk = false; }
ok('faces follow the quad order (bone ranges contiguous)', rangeOk);
// winding: CCW face normal agrees with vn
const V = lines.filter((l) => l.startsWith('v ')).map((l) => l.split(' ').slice(1).map(Number));
const VN = lines.filter((l) => l.startsWith('vn ')).map((l) => l.split(' ').slice(1).map(Number));
let wind = true;
faces.forEach((f, i) => {
  const ix = f.split(' ').slice(1, 4).map((t) => +t.split('/')[0] - 1), P = ix.map((k) => V[k]);
  const e1 = P[1].map((v, k) => v - P[0][k]), e2 = P[2].map((v, k) => v - P[0][k]);
  const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const n = VN[+f.split(' ')[1].split('/')[2] - 1];
  if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] <= 0) wind = false;
});
ok('counter-clockwise winding matches vn', wind);
ok('height ~1.75 m, feet at y 0', (() => { const ys = V.map((v) => v[1]); return Math.abs(Math.min(...ys)) < 1e-5 && Math.max(...ys) > 1.5 && Math.max(...ys) < 2; })());
ok('mtllib / usemtl / map_Kd = png name', lines.includes(`mtllib ${r.mtlName}`) && lines.includes('usemtl Palette') && /\nmap_Kd palette\.png\n/.test(r.mtl) && r.pngName === 'palette.png' && r.mtl.includes('newmtl Palette'));
const img = readPng(Buffer.from(r.png));
ok('palette png is 16x16', img.width === 16 && img.height === 16);
ok('deterministic', exportObj(rigged, { rgbOf }).obj === r.obj);
let threw = 0;
try { exportObj(rigged, {}); } catch { threw++; }
try { exportObj(rigged, { rgbOf: () => null }); } catch { threw++; }
ok('missing rgbOf / colour throws', threw === 2);

console.log(`objWrite test: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
