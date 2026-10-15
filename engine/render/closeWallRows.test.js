// OB-189: a flat, evenly lit close wall/floor must not repeat ONE glyph over a whole cell row (regular dot rows = light stripes).
// Every near set level 1-2 of the wall/ground materials needs >= 2 equal-density alternates so the per-cell hash varies the row.
import assert from 'node:assert/strict';
import DP from '../../design/detail-pass.js';
for (const k of ['brickFace', 'floorFace', 'rubbleFace', 'grassFace', 'turfFace', 'stoneFace']) {
  const S = DP.sets[k];
  for (let lv = 0; lv < 2; lv++) assert.ok(new Set(S[lv]).size >= 2, `${k} level ${lv + 1} has a single glyph "${S[lv]}"`);
}
console.log('closeWallRows ok');
