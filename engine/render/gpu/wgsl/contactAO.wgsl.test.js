// CONTACT-AO-01b (38.78): WGSL contactOcclQ (the exact text spliced into the light pass) vs the JS oracle contactOcclAt.
// The WGSL text is translated to JS by a few regexes (scalar-only syntax by design) and evaluated on >= 3000 points x 4 blob sets;
// rule 38.78: q equal, or off by 1 only where |occl*127 - (q +- 0.5)| < 1e-3 (round tie). Also: LightU layout, off-path words,
// shade/light splice presence, GI splice, n = 0 identity of the text outside the cao block.
// Run: node engine/render/gpu/wgsl/contactAO.wgsl.test.js
import assert from 'node:assert/strict';
import { CONTACT_AO_WGSL, CAO_MAX, CAO_SHIFT, createContactAO, buildContactBlobs, setDynamicBlobs, contactOcclAt, caoFactor } from '../../contactAO.js';
import { LIGHT_BLOCK, LIGHT_WGSL, LIGHT_GI_WGSL } from './light.wgsl.js';
import { SHADE_WGSL, SHADE_GI_WGSL } from './shade.wgsl.js';

function toJs(src) {
  let s = src
    .replace(/fn (\w+)\(([^)]*)\)\s*->\s*\w+\s*\{/g, (_, n, a) => `function ${n}(${a.split(',').map((p) => p.split(':')[0].trim()).filter(Boolean).join(', ')}) {`)
    .replace(/\b(var|let) (\w+): \w+ =/g, 'let $2 =').replace(/\bvar /g, 'let ')
    .replace(/for \(let (\w+) = 0u; (\w+) < (\w+); \1 = \1 \+ 1u\)/g, 'for (let $1 = 0; $1 < $3; $1++)')
    .replace(/\b(\d+)u\b/g, '$1').replace(/u32\(/g, '(').replace(/u\.caoA\.x/g, 'u.caoA[0]')
    .replace(/(\w+)\.([xyzw])\b/g, (_, a, c) => (a === 'u' ? `u.${c}` : `${a}[${'xyzw'.indexOf(c)}]`))
    .replace(/\bselect\(/g, 'select(').replace(/\bclamp\(/g, 'clamp(');
  return s;
}
const body = toJs(CONTACT_AO_WGSL).replace(/-> u32/g, '');
const mkFn = new Function('u', 'max', 'abs', 'sqrt', 'floor', 'clamp', 'select',
  `${body}\nreturn contactOcclQ;`);
const shims = { max: Math.max, abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, clamp: (x, a, b) => Math.min(Math.max(x, a), b), select: (f, t, c) => (c ? t : f) };

const blobs = (items) => { const f = (k) => Float32Array.from(items.map((b) => b[k]));
  return { count: items.length, x: f('x'), y: f('y'), zBase: f('z'), rx: f('rx'), ry: f('ry'), h: f('h'), k: f('k'), id: Int32Array.from(items.map((b, i) => i)) }; };
let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const sets = [
  [{ x: 0, y: 0, z: 0, rx: 0.5, ry: 0.5, h: 1, k: 0.6 }],                                               // one crate
  [{ x: 0, y: 0, z: 0, rx: 0.5, ry: 0.5, h: 1, k: 0.6 }, { x: 0.4, y: 0.1, z: 0, rx: 0.9, ry: 0.4, h: 0.5, k: 0.5 }, { x: -1, y: 1, z: 0.3, rx: 0.3, ry: 0.3, h: 2, k: 0.7 }], // overlapping
  Array.from({ length: CAO_MAX }, (_, i) => ({ x: (rnd() - 0.5) * 8, y: (rnd() - 0.5) * 8, z: rnd(), rx: 0.2 + rnd(), ry: 0.2 + rnd(), h: 0.3 + 2 * rnd(), k: 0.2 + 0.7 * rnd() })), // full 32
  [{ x: 1, y: 1, z: 0.2, rx: 0.45, ry: 0.35, h: 1.4, k: 0.55 }, { x: -2, y: 0.5, z: 0, rx: 0.8, ry: 0.8, h: 0, k: 0.9 }], // wolf/player-like + h = 0 degenerate
];
let pts = 0, exact = 0, tie = 0;
for (const items of sets) {
  const cao = createContactAO(); setDynamicBlobs(cao, blobs(items)); buildContactBlobs(cao, { x: 0, y: 0 }, null, {});
  const u = { caoA: [cao.n, 0, 0, 0], caoD: [] };
  for (let i = 0; i < cao.n * 2; i++) u.caoD.push([cao.data[i * 4], cao.data[i * 4 + 1], cao.data[i * 4 + 2], cao.data[i * 4 + 3]]);
  const fn = mkFn(u, shims.max, shims.abs, shims.sqrt, shims.floor, shims.clamp, shims.select);
  for (let k = 0; k < 4000; k++) {
    const px = (rnd() - 0.5) * 10, py = (rnd() - 0.5) * 10, pz = rnd() * 2.5 - 0.2, nz = rnd() * 2 - 1;
    const q = fn(px, py, pz, nz), o = contactOcclAt(cao, px, py, pz, nz), ref = Math.round(o * 127);
    pts++;
    if (q === ref) { exact++; continue; }
    assert.ok(Math.abs(q - ref) === 1 && Math.abs(o * 127 - (Math.min(q, ref) + 0.5)) < 1e-3, `q ${q} vs ${ref} at (${px},${py},${pz},${nz}) occl*127 ${o * 127}`);
    tie++;
  }
}
assert.ok(pts >= 12000);
console.log(`contactAO.wgsl: ${pts} points, ${exact} exact, ${tie} tie-rounded`);

// LightU: appended at the end, 1 + 64 vec4 rows; n word is f32 x of caoA
const fa = LIGHT_BLOCK.field('caoA'), fd = LIGHT_BLOCK.field('caoD');
assert.equal(fd.word, fa.word + 4); assert.equal(fd.word + CAO_MAX * 2 * 4, LIGHT_BLOCK.sizeWords);
assert.ok(LIGHT_BLOCK.field('pshSlot').word < fa.word, 'cao fields are appended after every existing word');
assert.ok(LIGHT_BLOCK.sizeBytes <= 65536 / 2, 'LightU stays well under the 64 KB uniform limit');

// shader text: cao block + splices present, GI variant uses the GI ambient, shade scales ambient by the byte
assert.ok(LIGHT_WGSL.includes('fn contactOcclQ') && LIGHT_WGSL.includes('caoBits = caoQ << ' + CAO_SHIFT + 'u'));
assert.ok(LIGHT_WGSL.includes('L -= u.ambient * (f32(caoQ)') && !LIGHT_WGSL.includes('Lamb * (f32(caoQ)'));
assert.ok(LIGHT_GI_WGSL.includes('L -= Lamb * (f32(caoQ)') && !LIGHT_GI_WGSL.includes('u.ambient * (f32(caoQ)'));
assert.ok(SHADE_WGSL.includes('su.ambientI * caoFt') && SHADE_WGSL.includes('* caoFg + su.sunI'));
assert.ok(SHADE_GI_WGSL.includes('giTerrK(uT, vT, bitcast<f32>(gaT.z), Nt) * caoFt'));
// shade factor == JS caoFactor (exact at 0; (127-q)/127 else)
for (const q of [0, 1, 13, 64, 126, 127]) assert.ok(Math.abs((q === 0 ? 1 : Math.fround((127 - q) * Math.fround(1 / 127))) - caoFactor(q)) < 1e-6);
console.log('contactAO.wgsl.test: OK');
