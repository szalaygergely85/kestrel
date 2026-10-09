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
    // TREES-LP-b (37.15 item 5): exactly one of `model` (voxel) / `mesh` (kind-9 registry mesh id)
    const hasModel = !!s && s.model !== undefined, hasMesh = !!s && s.mesh !== undefined;
    if (!s || hasModel === hasMesh) bad(`${key}: exactly one of model/mesh`);
    if (hasModel && (typeof s.model !== 'string' || !s.model)) bad(`${key}.model`);
    if (hasMesh && (typeof s.mesh !== 'string' || !s.mesh)) bad(`${key}.mesh`);
    // MESH-LOD-CELLS-01: optional per-species LOD override (default = cfg.lodCells for voxel species, LOD off for mesh species)
    if (s.lodCells !== undefined && (!Number.isFinite(s.lodCells) || s.lodCells <= 0)) bad(`${key}.lodCells`);
    if (s.lod0Cap !== undefined && (!Number.isInteger(s.lod0Cap) || s.lod0Cap < 0)) bad(`${key}.lod0Cap`);
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

// ENV-01a1 (architecture.md 37.4): content-driven, load-time ground detail.
/** @typedef {{prism?: {r:number,h:number}, box?: {hx:number,hy:number,h:number}}} DetailCollider */
/** @typedef {{count:number, x:Float64Array, y:Float64Array, z:Float64Array,
 * yawDeg:Int16Array, species:Uint16Array, r2:Float32Array,
 * speciesDefs:Array<{model?:string,mesh?:string,layer:number,shadow:boolean,sway:boolean,lodCells:number,collider?:DetailCollider}>,
 * tileM:number,tx0:number,ty0:number,tilesX:number,tilesY:number,tileStart:Uint32Array}} DetailSet */
const DETAIL_TYPES = ['grass', 'forest', 'water', 'rock', 'path'];
const detailNormal = { x: 0, y: 0, z: 1 };

export function validateDetailConfig(cfg, typeNames = DETAIL_TYPES) {
  const bad = key => { throw new Error(`detail.${key}: invalid detail config`); };
  const number = (v, key, min, inclusive = true) => {
    if (!Number.isFinite(v) || (inclusive ? v < min : v <= min)) bad(key);
    return v;
  };
  const integer = (v, key, min, max) => {
    if (!Number.isInteger(v) || v < min || v > max) bad(key);
    return v;
  };
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) bad('config');
  const out = { tileM: 16, maxDraw: 768, refeedM: 4, maxPlacements: 40000,
    structClearM: 2, entityClearM: 1.5, exclude: [], ...cfg };
  number(out.tileM, 'tileM', 0, false);
  integer(out.maxDraw, 'maxDraw', 1, 65536);
  number(out.refeedM, 'refeedM', 0, false);
  integer(out.maxPlacements, 'maxPlacements', 0, 65536);
  number(out.structClearM, 'structClearM', 0); number(out.entityClearM, 'entityClearM', 0);
  if (!Array.isArray(out.exclude)) bad('exclude');
  out.exclude = out.exclude.map((e, i) => {
    const key = `exclude[${i}]`;
    if (!e || !['disc', 'capsule'].includes(e.shape)) bad(`${key}.shape`);
    for (const k of e.shape === 'disc' ? ['x', 'y'] : ['ax', 'ay', 'bx', 'by']) {
      if (!Number.isFinite(e[k])) bad(`${key}.${k}`);
    }
    number(e.r, `${key}.r`, 0);
    return { ...e };
  });
  if (!Array.isArray(out.layers)) bad('layers');
  let speciesCount = 0;
  out.layers = out.layers.map((layer, i) => {
    const key = `layers[${i}]`;
    if (!layer || typeof layer !== 'object') bad(key);
    const l = { lodCells: 4, ...layer };
    if (typeof l.name !== 'string' || !l.name) bad(`${key}.name`);
    if (!Number.isInteger(l.seed)) bad(`${key}.seed`);
    for (const k of ['cellM', 'drawM', 'lodCells']) number(l[k], `${key}.${k}`, 0, false);
    for (const k of ['jitter', 'fill', 'maxSlope', 'clearM']) number(l[k], `${key}.${k}`, 0);
    if (l.fill > 1) bad(`${key}.fill`);
    if (!l.ground || typeof l.ground !== 'object' || Array.isArray(l.ground)) bad(`${key}.ground`);
    l.ground = {};
    for (const [type, list] of Object.entries(layer.ground)) {
      const gkey = `${key}.ground.${type}`;
      if (!typeNames.includes(type)) throw new Error(`detail.${gkey}: unknown ground type`);
      if (!Array.isArray(list) || !list.length) bad(gkey);
      let weight = 0;
      l.ground[type] = list.map((s, j) => {
        const skey = `${gkey}[${j}]`;
        if (!s || typeof s !== 'object') bad(skey);
        const species = { sinkM: 0.05, yawStep: 1, shadow: false, sway: false, ...s };
        // TREES-LP-c: exactly one of `model` (voxel) / `mesh` (kind-9 registry mesh id)
        const hasModel = species.model !== undefined, hasMesh = species.mesh !== undefined;
        if (hasModel === hasMesh) bad(`${skey}: exactly one of model/mesh`);
        if (hasModel && (typeof species.model !== 'string' || !species.model)) bad(`${skey}.model`);
        if (hasMesh && (typeof species.mesh !== 'string' || !species.mesh)) bad(`${skey}.mesh`);
        number(species.weight, `${skey}.weight`, 0, false); weight += species.weight;
        if (!Number.isFinite(species.sinkM)) bad(`${skey}.sinkM`);
        integer(species.yawStep, `${skey}.yawStep`, 1, 360);
        if (typeof species.shadow !== 'boolean') bad(`${skey}.shadow`);
        if (typeof species.sway !== 'boolean') bad(`${skey}.sway`); // FOLIAGE-SWAY-01 part 2: explicit per-species flag, no name regex
        if (species.collider !== undefined) {
          const c = species.collider;
          if (!c || typeof c !== 'object' || Object.keys(c).length !== 1 || !(c.prism || c.box)) bad(`${skey}.collider`);
          const kind = c.prism ? 'prism' : 'box', shape = c[kind];
          for (const k of kind === 'prism' ? ['r', 'h'] : ['hx', 'hy', 'h']) number(shape[k], `${skey}.collider.${kind}.${k}`, 0, false);
          species.collider = { [kind]: { ...shape } };
        }
        if (++speciesCount > 65536) bad('layers.species (exceeds Uint16)');
        return species;
      });
      if (!Number.isFinite(weight)) bad(`${gkey}.weight`);
    }
    return l;
  });
  return out;
}

function detailExcluded(x, y, e) {
  let px, py;
  if (e.shape === 'disc') { px = e.x; py = e.y; }
  else {
    const dx = e.bx - e.ax, dy = e.by - e.ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - e.ax) * dx + (y - e.ay) * dy) / len2));
    px = e.ax + t * dx; py = e.ay + t * dy;
  }
  const dx = x - px, dy = y - py;
  return dx * dx + dy * dy <= e.r * e.r;
}

/** @returns {DetailSet} */
export function scatterDetail(terrain, structures = [], keepOut = [], cfg = terrain.recipe.recipe.detail) {
  cfg = validateDetailConfig(cfg);
  const g = terrain.near;
  if (!g) throw new Error('scatterDetail: terrain.near must be baked');
  const x1 = g.x0 + g.w * g.cell, y1 = g.y0 + g.h * g.cell;
  const tx0 = Math.floor(g.x0 / cfg.tileM), ty0 = Math.floor(g.y0 / cfg.tileM);
  const tilesX = Math.ceil(x1 / cfg.tileM) - tx0, tilesY = Math.ceil(y1 / cfg.tileM) - ty0;
  // Load/stroke-time broad phase: hundreds of roadside boxes need only touch their own tiles.
  const structureTiles = new Array(tilesX * tilesY);
  for (const s of structures) {
    const b = s.bbox, m = cfg.structClearM;
    const ix0 = Math.max(0, Math.floor((b.x0 - m) / cfg.tileM) - tx0);
    const iy0 = Math.max(0, Math.floor((b.y0 - m) / cfg.tileM) - ty0);
    const ix1 = Math.min(tilesX - 1, Math.floor((b.x1 + m) / cfg.tileM) - tx0);
    const iy1 = Math.min(tilesY - 1, Math.floor((b.y1 + m) / cfg.tileM) - ty0);
    for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = ix + iy * tilesX;
      (structureTiles[i] || (structureTiles[i] = [])).push(b);
    }
  }
  const points = [], speciesDefs = [], exclusions = cfg.exclude.concat(keepOut);
  for (let layer = 0; layer < cfg.layers.length; layer++) {
    const l = cfg.layers[layer], speciesByType = {};
    for (const [type, list] of Object.entries(l.ground)) {
      speciesByType[type] = list.map(s => {
        const index = speciesDefs.length;
        speciesDefs.push({ model: s.model, mesh: s.mesh, layer, shadow: s.shadow, sway: s.sway, lodCells: l.lodCells, collider: s.collider });
        return index;
      });
    }
    const u = (ix, iy, k) => hash2(ix, iy, l.seed + k) / 4294967296;
    for (let iy = Math.floor(g.y0 / l.cellM); iy < Math.ceil(y1 / l.cellM); iy++) {
      for (let ix = Math.floor(g.x0 / l.cellM); ix < Math.ceil(x1 / l.cellM); ix++) {
        if (u(ix, iy, 0) >= l.fill) continue;
        const x = (ix + 0.5) * l.cellM + (u(ix, iy, 1) * 2 - 1) * l.jitter;
        const y = (iy + 0.5) * l.cellM + (u(ix, iy, 2) * 2 - 1) * l.jitter;
        if (x < g.x0 || y < g.y0 || x >= x1 || y >= y1) continue;
        const t = terrain.groundTypeAt(x, y), type = terrain.typeName(t), list = l.ground[type];
        if (!list || !list.length) continue;
        if (terrain.groundTypeAt(x - l.clearM, y - l.clearM) !== t ||
            terrain.groundTypeAt(x - l.clearM, y + l.clearM) !== t ||
            terrain.groundTypeAt(x + l.clearM, y - l.clearM) !== t ||
            terrain.groundTypeAt(x + l.clearM, y + l.clearM) !== t) continue;
        terrain.groundNormalAt(x, y, detailNormal);
        if (Math.hypot(detailNormal.x, detailNormal.y) / detailNormal.z > l.maxSlope) continue;
        const tile = Math.floor(x / cfg.tileM) - tx0 + (Math.floor(y / cfg.tileM) - ty0) * tilesX;
        const boxes = structureTiles[tile];
        let blocked = false;
        if (boxes) for (const b of boxes) {
          if (x >= b.x0 - cfg.structClearM && x <= b.x1 + cfg.structClearM &&
              y >= b.y0 - cfg.structClearM && y <= b.y1 + cfg.structClearM) { blocked = true; break; }
        }
        if (blocked) continue;
        if (exclusions.some(e => detailExcluded(x, y, e))) continue;
        let pick = u(ix, iy, 3) * list.reduce((sum, s) => sum + s.weight, 0), chosen = list.length - 1;
        for (let j = 0; j < list.length; j++) { pick -= list[j].weight; if (pick < 0) { chosen = j; break; } }
        const s = list[chosen], r = l.drawM * (0.85 + 0.15 * u(ix, iy, 5));
        points.push({ x, y, z: terrain.groundAt(x, y) - s.sinkM,
          yawDeg: Math.floor(u(ix, iy, 4) * 360 / s.yawStep) * s.yawStep,
          species: speciesByType[type][chosen], r2: r * r,
          tile });
        if (points.length > cfg.maxPlacements) throw new Error('detail.maxPlacements: placement cap exceeded');
      }
    }
  }
  const count = points.length, tileStart = new Uint32Array(tilesX * tilesY + 1);
  for (const p of points) tileStart[p.tile + 1]++;
  for (let i = 1; i < tileStart.length; i++) tileStart[i] += tileStart[i - 1];
  const cursor = tileStart.slice();
  const out = { count, x: new Float64Array(count), y: new Float64Array(count), z: new Float64Array(count),
    yawDeg: new Int16Array(count), species: new Uint16Array(count), r2: new Float32Array(count),
    speciesDefs, tileM: cfg.tileM, tx0, ty0, tilesX, tilesY, tileStart };
  for (const p of points) {
    const i = cursor[p.tile]++;
    for (const k of ['x', 'y', 'z', 'yawDeg', 'species', 'r2']) out[k][i] = p[k];
  }
  return out;
}
