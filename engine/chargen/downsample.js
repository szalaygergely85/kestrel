// engine/chargen/downsample.js (CHARGEN-22a, docs/architecture.md 38.34 item 1): pure 2x2x2 downsample of a layers grid.
// layers[z][y] = string of x ('.'/' ' empty). slots[ch].keep (0..9, default 0) = priority: any filled cell with keep > 0
// wins its block (highest keep, ties: higher count, then lower char code), so 1-cell irises/lids/lips survive.
// Otherwise >= 4 of 8 filled -> majority char (ties: lower char code), else empty. Odd sizes pad with empty.
const empty = (c) => c === '.' || c === ' ';

/** @returns {string[][]} layers of size ceil(sx/2) x ceil(sy/2) x ceil(sz/2) */
export function downsample2(layers, slots = {}) {
  const sz = layers.length;
  const sy = sz ? layers[0].length : 0;
  const sx = sy ? layers[0][0].length : 0;
  const keepOf = (c) => { const s = slots[c]; return s && Number.isInteger(s.keep) ? s.keep : 0; };
  const out = [];
  for (let z = 0; z < sz; z += 2) {
    const zl = [];
    for (let y = 0; y < sy; y += 2) {
      let row = '';
      for (let x = 0; x < sx; x += 2) {
        const counts = new Map();
        let filled = 0;
        for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const L = layers[z + dz] && layers[z + dz][y + dy];
          const c = L && x + dx < sx ? L[x + dx] : '.';
          if (empty(c)) continue;
          filled++;
          counts.set(c, (counts.get(c) || 0) + 1);
        }
        let pick = '.';
        if (filled) {
          let bestKeep = 0;
          for (const c of counts.keys()) bestKeep = Math.max(bestKeep, keepOf(c));
          if (bestKeep > 0 || filled >= 4) {
            let best = null;
            for (const [c, n] of counts) {
              if (bestKeep > 0 && keepOf(c) !== bestKeep) continue;
              if (best === null || n > counts.get(best) || (n === counts.get(best) && c.charCodeAt(0) < best.charCodeAt(0))) best = c;
            }
            pick = best;
          }
        }
        row += pick;
      }
      zl.push(row);
    }
    out.push(zl);
  }
  return out;
}
