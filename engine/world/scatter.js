// ME-06c1 (architecture.md 37.2): derived, load-time tree placements.
export function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x8da6b343) ^ Math.imul(iy | 0, 0xd8163841) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

export function validateScatterConfig(cfg) {
  const bad = (key) => { throw new Error(`forest.trees.${key}: invalid scatter config`); };
  const finite = (key, min, inclusive = true) => {
    const v = cfg[key];
    if (!Number.isFinite(v) || (inclusive ? v < min : v <= min)) bad(key);
  };
  if (!cfg || typeof cfg !== 'object') bad('config');
  if (!Number.isInteger(cfg.seed)) bad('seed');
  finite('cellM', 0, false); finite('jitter', 0); finite('fill', 0);
  if (cfg.fill > 1) bad('fill');
  if (!Number.isInteger(cfg.maxTrees) || cfg.maxTrees < 0) bad('maxTrees');
  finite('lodCells', 0, false);
  if (!Array.isArray(cfg.species) || !cfg.species.length || cfg.species.length > 256) bad('species');
  let maxRc = 0, weight = 0;
  for (let i = 0; i < cfg.species.length; i++) {
    const s = cfg.species[i], key = `species[${i}]`;
    if (!s || typeof s.model !== 'string' || !s.model) bad(`${key}.model`);
    if (!Number.isFinite(s.weight) || s.weight <= 0) bad(`${key}.weight`);
    if (!Number.isFinite(s.trunkR) || s.trunkR <= 0) bad(`${key}.trunkR`);
    if (!Number.isFinite(s.trunkH) || s.trunkH <= 0) bad(`${key}.trunkH`);
    weight += s.weight;
    maxRc = Math.max(maxRc, s.trunkR / Math.cos(Math.PI / 8));
  }
  if (!Number.isFinite(weight)) bad('species.weight');
  if (cfg.cellM - 2 * cfg.jitter < 2 * maxRc + 1.2) bad('cellM/jitter (trunk gap < 1.2m)');
  return cfg;
}

/** @param {import('./Terrain.js').Terrain} terrain */
export function scatterTrees(terrain, structures = [], cfg = terrain.recipe.recipe.forest.trees) {
  validateScatterConfig(cfg);
  const forest = terrain.recipe.recipe.forest;
  if (!Number.isFinite(forest.maxSlope) || forest.maxSlope < 0) throw new Error('forest.maxSlope: invalid scatter slope');
  const g = terrain.near;
  if (!g) throw new Error('scatterTrees: terrain.near must be baked');
  const points = [], normal = { x: 0, y: 0, z: 1 };
  const forestId = terrain._forestTypeId;
  const weight = cfg.species.reduce((sum, s) => sum + s.weight, 0);
  const u = (ix, iy, k) => hash2(ix, iy, cfg.seed + k) / 4294967296;
  for (let iy = Math.floor(g.y0 / cfg.cellM); iy < Math.ceil((g.y0 + g.h * g.cell) / cfg.cellM); iy++) {
    for (let ix = Math.floor(g.x0 / cfg.cellM); ix < Math.ceil((g.x0 + g.w * g.cell) / cfg.cellM); ix++) {
      if (u(ix, iy, 0) >= cfg.fill) continue;
      const x = (ix + 0.5) * cfg.cellM + (u(ix, iy, 1) * 2 - 1) * cfg.jitter;
      const y = (iy + 0.5) * cfg.cellM + (u(ix, iy, 2) * 2 - 1) * cfg.jitter;
      const gx = Math.floor((x - g.x0) / g.cell), gy = Math.floor((y - g.y0) / g.cell);
      if (gx < 0 || gy < 0 || gx + 1 >= g.w || gy + 1 >= g.h) continue;
      const j = gx + gy * g.w;
      if (g.type[j] !== forestId || g.type[j + 1] !== forestId ||
          g.type[j + g.w] !== forestId || g.type[j + g.w + 1] !== forestId) continue;
      terrain.groundNormalAt(x, y, normal);
      if (Math.hypot(normal.x, normal.y) / normal.z > forest.maxSlope) continue;
      let excluded = false;
      for (const s of structures) {
        const b = s.bbox;
        if (x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2) { excluded = true; break; }
      }
      if (excluded) continue;
      let pick = u(ix, iy, 3) * weight, species = cfg.species.length - 1;
      for (let i = 0; i < cfg.species.length; i++) {
        pick -= cfg.species[i].weight;
        if (pick < 0) { species = i; break; }
      }
      points.push({ x, y, z: terrain.groundAt(x, y) - 0.1, yawDeg: Math.floor(u(ix, iy, 4) * 360), species, ix, iy });
    }
  }
  // Normative probability thinning is deterministic; maxTrees is an expected count, not a hard cap.
  const keep = points.length > cfg.maxTrees ? cfg.maxTrees / points.length : 1;
  const kept = points.filter(p => keep === 1 || u(p.ix, p.iy, 5) < keep);
  const count = kept.length;
  const out = { x: new Float64Array(count), y: new Float64Array(count), z: new Float64Array(count),
    yawDeg: new Int16Array(count), species: new Uint8Array(count), count };
  for (let i = 0; i < count; i++) {
    const p = kept[i];
    out.x[i] = p.x; out.y[i] = p.y; out.z[i] = p.z; out.yawDeg[i] = p.yawDeg; out.species[i] = p.species;
  }
  return out;
}
