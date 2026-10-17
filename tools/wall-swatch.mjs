// Pure pattern probe: ASCII swatch of a stone wall (40x20 cells) at given distances. node tools/wall-swatch.mjs [mat]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.window = globalThis; require('../design/palette.js'); const DP = require('../design/detail-pass.js');
const mat = process.argv[2] || 'stone';
const out = [];
function swatch(dist, obliq) {
  const du = dist * 0.0043 * obliq, dv = dist * 0.0064;
  let s = `== ${mat} at ${dist} m (du ${du.toFixed(3)} dv ${dv.toFixed(3)} m/cell) ==\n`;
  const tones = new Set();
  for (let r = 0; r < 20; r++) {
    let line = '';
    for (let c = 0; c < 40; c++) {
      const u = 3.1 + c * du, v = 1.0 + (19 - r) * dv;
      const o = DP.util.shade({ kind: 'wall', mat, normal: 'S', u, v, dudx: du, dvdx: 0, dudy: 0, dvdy: dv, z: v, aoD: 9, dist }, [0.9, 0.9, 0.95], { fg: [0,0,0], bg: [0,0,0] });
      line += o.glyph; tones.add(o.fg.map(Math.round).join(','));
    }
    s += line + '\n';
  }
  return s + `distinct fg tones: ${tones.size}\n`;
}
for (const d of [3, 25]) out.push(swatch(d, 1));
const txt = out.join('\n'); console.log(txt);
if (process.argv[3]) require('fs').writeFileSync(process.argv[3], txt);
