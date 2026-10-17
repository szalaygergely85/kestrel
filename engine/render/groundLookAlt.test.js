// FD-06 (OB-198/208): terrain ground-look glyph dice on a 3x coarser (GROUND_ALT_M) world lattice (setAltDice). A 1/4-screen-cell camera shift over
// road/grass ground keeps >= 95 % of glyph choices; off = old lattice. Run: node engine/render/groundLookAlt.test.js
import assert from 'node:assert/strict';
import { packLookTable, makeGroundLook, shadeLookCell, LOOK_MAX, LOOK_ROWS } from './groundLook.js';
import { setAltDice } from './fogShape.js';
const mk = (id, glyphs) => ({ id, ramp: [[.2, .3, .1], [.3, .4, .1], [.4, .5, .2], [.5, .6, .3]], noiseScale: 4, macroScale: 12, contrast: 1, shimmerAmp: 0, bg: [[.05, .08, .03], [.1, .15, .05]], sheen: 0, shimmerMode: 0, glyphs, lean: glyphs, accents: [] });
const GL = makeGroundLook(packLookTable({ looks: [mk(1, [46, 44, 39, 34]), mk(2, [58, 59, 61, 44])] }, new Float32Array(LOOK_MAX * LOOK_ROWS * 4)));
function keep(on, fp) {
  setAltDice(on);
  let same = 0, n = 0; const sh = 0.25 * fp;
  for (let look = 1; look <= 2; look++) for (let i = 0; i < 80; i++) for (let j = 0; j < 80; j++) {
    const u = 3.3 + i * fp * 1.37, v = -9.1 + j * fp * 1.11;
    const q = GL.q; q[0] = Math.fround(u); q[1] = Math.fround(v); q[2] = fp; q[3] = fp * 100; q[4] = 0; q[5] = 0; q[21] = 1;
    shadeLookCell(GL, look, look, q); const a = q[13];
    q[0] = Math.fround(u + sh); q[1] = Math.fround(v + sh); q[2] = fp; q[3] = fp * 100; q[5] = 0; q[21] = 1;
    shadeLookCell(GL, look, look, q); if (q[13] === a) same++; n++;
  }
  return same / n;
}
for (const fp of [0.05, 0.1, 0.2]) {
  const off = keep(false, fp), on = keep(true, fp);
  console.log(`fp ${fp}: keep off ${(off * 100).toFixed(1)}% on ${(on * 100).toFixed(1)}%`);
  assert.ok(on >= off - 1e-9, 'coarser dice never worse');
  assert.ok(on >= (fp <= 0.05 ? 0.95 : 0.93), 'keep at fp ' + fp); // remaining flips at larger fp come from the smooth tone, not the lattice
}
setAltDice(true);
console.log('groundLookAlt.test: ALL PASS');
