// OB-189: a flat, evenly lit close surface must not repeat ONE glyph over a whole cell row (regular rows = light stripes).
// Every set used as a material face (near/mid/far) or band, array or oriented, needs >= 2 equal-density alternates at
// levels 1-2 (oriented: dark levels + the h/v families, whose rows follow the surface). Discovered automatically.
import assert from 'node:assert/strict';
import DP from '../../design/detail-pass.js';
const used = new Set();
for (const m of Object.values(DP.materials)) {
  for (const k of [m.face && m.face.set, m.face && m.face.mid, m.face && m.face.far, m.band && m.band.set]) if (k) used.add(k);
}
assert.ok(used.size > 10, 'material sets discovered');
// glint / rune are emissive sparkle marks (single point glyphs by design, not surface rows)
const EMISSIVE_MARKS = new Set(["glint", "rune"]);
const multi = (str) => new Set(str).size >= 2;
for (const k of used) {
  if (EMISSIVE_MARKS.has(k)) continue;
  const S = DP.sets[k];
  assert.ok(S, `unknown set ${k}`);
  if (S.orient) {
    const rows = [...S.dark.map((s, i) => [`dark${i + 1}`, s])];
    for (const f of ['h', 'v']) S.fam[f].slice(0, 2).forEach((s, i) => rows.push([`${f}${i + 1}`, s]));
    for (const [n, s] of rows) assert.ok(multi(s), `${k} ${n} has a single glyph "${s}"`);
  } else {
    for (let lv = 0; lv < 2; lv++) assert.ok(multi(S[lv]), `${k} level ${lv + 1} has a single glyph "${S[lv]}"`);
  }
}
console.log('closeWallRows ok', used.size, 'sets');
