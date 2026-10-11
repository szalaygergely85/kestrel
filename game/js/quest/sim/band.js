// game/js/quest/sim/band.js (US-129a). Zone band 1-10 at a world point, from world_geo.regions `lv`, and the tier tables
// that hang off it (content/beasts/tiers.json, mirrored here; a test keeps the two equal).
// Pure + deterministic (rule 15): the grid is built once in createBand, bandAt/tierAt are O(1) array reads, 0 alloc.
// Band of a region = the low end of its `lv` range; `lvWest` (heartland) applies west of WEST_X (the far side of the river);
// lv null (off-limits east) = band 1. Points outside the map clamp to the nearest cell.

export const BAND_TABLE = Object.freeze({
  mult: Object.freeze({
    1: Object.freeze({ hp: 1, damage: 1, speed: 1 }),
    2: Object.freeze({ hp: 2, damage: 1.5, speed: 1.1 }),
    3: Object.freeze({ hp: 3, damage: 2, speed: 1.2 }),
  }),
  beastTier: Object.freeze([1, 1, 1, 1, 2, 2, 2, 3, 3, 3]),  // index = band - 1
  gearTier: Object.freeze([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]),   // T1 b1-2 .. T5 b9-10 (quest-roadmap section 0)
  gearItemTier: Object.freeze({ 1: null, 2: 'sturdy', 3: 'fine', 4: 'fine', 5: 'fine' }), // null = today's weighted roll
});

const CELL = 8, SIZE = 2048, N = SIZE / CELL, WEST_X = 1100;

/** @param {any[]} regions world_geo.regions ({r:[x0,y0,x1,y1], lv:[a,b]|null, lvWest?:[a,b]}, first match wins) */
export function createBand(regions) {
  const grid = new Uint8Array(N * N);
  for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
    const x = (gx + 0.5) * CELL, y = (gy + 0.5) * CELL;
    let band = 1;
    for (let k = 0; k < regions.length; k++) {
      const g = regions[k], r = g.r;
      if (x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) {
        const lv = (g.lvWest && x < WEST_X) ? g.lvWest : g.lv;
        band = lv ? lv[0] : 1;
        break;
      }
    }
    grid[gy * N + gx] = band;
  }
  const cell = (v) => { const c = Math.floor(v / CELL); return c < 0 ? 0 : (c >= N ? N - 1 : c); };
  const api = {
    bandAt: (x, y) => grid[cell(y) * N + cell(x)],
    /** explicit `entities[].tier` (1-3) wins over the band */
    beastTierAt: (x, y, override) => (override >= 1 && override <= 3) ? (override | 0) : BAND_TABLE.beastTier[api.bandAt(x, y) - 1],
    gearTierAt: (x, y) => BAND_TABLE.gearTier[api.bandAt(x, y) - 1],
  };
  return api;
}

/** Stat multipliers {hp, damage, speed} for a tier 1-3 (shared frozen objects). */
export function tierMult(tier) { return BAND_TABLE.mult[tier] || BAND_TABLE.mult[1]; }
