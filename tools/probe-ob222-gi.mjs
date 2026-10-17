// OB-222 scratch/diagnosis probe: shade GI ambient (noon) at tree-canopy heights vs flat sky. Run: node tools/probe-ob222-gi.mjs [zone]
import { readFileSync } from 'node:fs';
import { readGIFile } from '../engine/world/giFile.js';
import { createGIState, mixGIState, sampleGI } from '../engine/render/giProbe.js';
const id = process.argv[2] || 'g4_9';
const { meta, field } = readGIFile(new Uint8Array(readFileSync(`content/gi/${id}.gi.bin`)));
console.log(id, { x0: meta.x0, y0: meta.y0, cellM: meta.cellM, w: meta.w, h: meta.h, layers: meta.layers, layerDz: meta.layerDz, keyHours: meta.keyHours });
const st = createGIState(); st.field = field; st.on = true;
const SKY = [0.55, 0.65, 0.9], SUN = [1, 0.95, 0.85]; // noon-ish colour x intensity
mixGIState(st, 12, SKY, SUN, { skyFloor: 0.15 });
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], flat = lum(SKY), out = new Float32Array(3);
const N = [[0, 1, 0, 'up'], [1, 0, 0, 'side']];
for (const [nx, ny, nz, nm] of N) for (const dz of [0.5, 2, 5, 9, 14, 25]) {
  let n = 0, low = 0, sum = 0, lowest = 9, valid = 0;
  for (let j = 0; j < field.h; j += 2) for (let i = 0; i < field.w; i += 2) {
    const b = field.base[j * field.w + i]; if (!(b > -1e3)) continue;
    const x = field.x0 + (i + 0.5) * field.cellM, z = field.y0 + (j + 0.5) * field.cellM;
    const ok = sampleGI(st, x, b + dz, z, nx, ny, nz, out); n++; if (ok) valid++;
    const l = lum(out) / flat; sum += l; if (l < lowest) lowest = l; if (l < 0.3) low++;
  }
  console.log(nm, 'h+' + dz, 'n', n, 'validProbe', valid, 'meanRel', (sum / n).toFixed(2), 'min', lowest.toFixed(2), 'frac<0.3', (low / n).toFixed(3));
}
