// @ts-check
// engine/render/roofMap.js (ART-01a, docs/architecture.md 37.18 item 3). The
// "outdoor test" for the material (non-terrain) light pass: a per-level-structure
// grid of world-z ceiling heights, packed as an R32F atlas (width = max level
// width, rows stacked; boxes axis-aligned like `uStructA/B`). A texel is
// `origin.z + ceilH` for a NON-SOLID sector with a numeric `ceilH`, else `-1e30`
// (sky ceiling, solid, or no sector) - i.e. "no finite ceiling above me".
//
// `outdoorAt(map, x, y, z)` returns 1 (outdoor) when `z` is above the ceiling
// height (by the 0.02 m face-sample margin), or when no box contains `(x, y)`
// (open terrain / outside every footprint). Terrain (kind 7) never calls this -
// the light pass already short-circuits it to outdoor before any fetch.
//
// Rebuilt only when `world.structVersion + sum(packed.version)` changes (a
// sector animation bumps `packed.version`, a place/remove bumps `structVersion`),
// and reuses `prev.data` when the new atlas size fits, so it never allocates on
// the per-frame path (which is just `outdoorAt`). `version` is a monotonic-ish
// change key for a future GPU uploader (ART-01b).

export const MAX_ROOF_BOXES = 8;
const SKY_ROOF = -1e30; // matches packed.js SKY_H semantics (sky / solid / none -> no ceiling)

/**
 * @typedef {Object} RoofMap
 * @property {number} count  number of stamped boxes (<= MAX_ROOF_BOXES)
 * @property {Float32Array} box  [ox, oy, w, h] per box (world x/y + level w/h in cells)
 * @property {Int32Array} yOff  atlas row offset of each box
 * @property {number} atlasW  max level width (columns)
 * @property {number} atlasH  summed level heights (rows)
 * @property {Float32Array} data  R32F atlas, atlasW * atlasH world-z ceiling heights
 * @property {number} version  change key (structVersion + sum packed.version)
 */

/**
 * Builds (or reuses) the roof map for a world. `world` is duck-typed: it needs
 * `structVersion` and `structures[]`, each level structure carrying `level`
 * (`{width, height, sectorAt(x,y)}`), `origin` (`{x,y,z}`) and `packed`
 * (`{version}`); mesh structures (`kind === 'mesh'`) are skipped (outdoor until
 * a later `roof` prefab stamps a box). Load/version-change time only - never
 * per frame.
 * @param {any} world
 * @param {RoofMap} [prev]
 * @returns {RoofMap}
 */
export function buildRoofMap(world, prev) {
  let version = world.structVersion | 0;
  const structs = world.structures || [];
  const levelStructs = [];
  for (let i = 0; i < structs.length; i++) {
    const s = structs[i];
    if (s.kind === 'mesh' || !s.level) continue;
    version += s.packed ? s.packed.version : 0;
    levelStructs.push(s);
  }
  if (prev && prev.version === version) return prev;

  const count = Math.min(levelStructs.length, MAX_ROOF_BOXES);
  const box = prev && prev.box && prev.box.length === 32 ? prev.box : new Float32Array(32);
  const yOff = prev && prev.yOff && prev.yOff.length === MAX_ROOF_BOXES ? prev.yOff : new Int32Array(MAX_ROOF_BOXES);

  let atlasW = 0, atlasH = 0;
  for (let i = 0; i < count; i++) {
    const s = levelStructs[i];
    const w = s.level.width, h = s.level.height;
    const o = i * 4;
    box[o] = s.origin.x; box[o + 1] = s.origin.y; box[o + 2] = w; box[o + 3] = h;
    yOff[i] = atlasH;
    if (w > atlasW) atlasW = w;
    atlasH += h;
  }

  const need = atlasW * atlasH;
  const data = prev && prev.data && prev.data.length >= need ? prev.data : new Float32Array(need);

  for (let i = 0; i < count; i++) {
    const s = levelStructs[i];
    const level = s.level;
    const oz = s.origin.z;
    const w = level.width, h = level.height;
    const base = yOff[i] * atlasW;
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const sec = level.sectorAt(cx + 0.5, cy + 0.5);
        let r = SKY_ROOF;
        if (sec && !sec.solid && typeof sec.ceilH === 'number') r = oz + sec.ceilH;
        data[base + cy * atlasW + cx] = r;
      }
    }
  }

  return { count, box, yOff, atlasW, atlasH, data, version };
}

/**
 * Outdoor test at a world point: 1 if `z` is above the stamped ceiling height
 * (by 0.02 m) or outside every box, else 0. Allocation-free.
 * @param {RoofMap|null|undefined} map
 * @param {number} x world x
 * @param {number} y world y
 * @param {number} z world z
 * @returns {number} 1 outdoor, 0 indoor
 */
export function outdoorAt(map, x, y, z) {
  if (!map) return 1;
  const count = map.count;
  const box = map.box, yOff = map.yOff, atlasW = map.atlasW, data = map.data;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const ox = box[o], oy = box[o + 1], w = box[o + 2], h = box[o + 3];
    if (x >= ox && x < ox + w && y >= oy && y < oy + h) {
      const lx = Math.floor(x - ox), ly = Math.floor(y - oy);
      const r = data[(yOff[i] + ly) * atlasW + lx];
      return z > r + 0.02 ? 1 : 0;
    }
  }
  return 1;
}
