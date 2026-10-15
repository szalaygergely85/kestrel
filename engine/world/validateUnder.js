// UNDER-00b (arch 38.75 item 1d): lint for `keepTerrain` rooms - no room geometry may poke through the terrain surface.
/**
 * @param {{structures: any[], terrain?: {groundAt(x:number,y:number):number}}} world
 * @returns {string[]} one error per offending cell ("struct id cell (c,r): ..."); empty = ok
 */
export function validateUnder(world) {
  const errors = [];
  if (!world.terrain) return errors;
  for (const s of world.structures) {
    if (s.kind === 'mesh' || !s.keepMask) continue;
    const lv = s.level, w = lv.width, h = lv.height;
    // UNDER-00c: cells are mapped axis-aligned at 1 m; placeStructure rejects yawSteps anyway, so reject anything else clearly.
    if ((s.yawSteps || 0) !== 0 || (s.frame && s.frame.yawSteps) || lv.cellSize !== 1) {
      errors.push(`${s.id}: keepTerrain site must be unrotated with cellSize 1 (yawSteps ${s.yawSteps || (s.frame && s.frame.yawSteps) || 0}, cellSize ${lv.cellSize}) - not supported`);
      continue;
    }
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (s.keepMask[r * w + c] !== 1) continue;
        const sec = lv.sectorAt(c + 0.5, r + 0.5);
        const top = sec.solid ? sec.floorH : (typeof sec.topH === 'number' ? sec.topH : sec.ceilH);
        if (typeof top !== 'number') { errors.push(`${s.id} cell (${c},${r}): keepTerrain cell is open to the sky (ceilH/topH 'sky')`); continue; }
        const g = world.terrain.groundAt(s.bbox.x0 + c + 0.5, s.bbox.y0 + r + 0.5);
        const need = s.origin.z + top + 0.3;
        if (!(g >= need)) errors.push(`${s.id} cell (${c},${r}): terrain ${g.toFixed(2)} m < room top ${need.toFixed(2)} m (topH ${top} + origin.z ${s.origin.z} + 0.3)`);
      }
    }
  }
  return errors;
}

/**
 * UNDER-00c: static (terrain-free) lint for content validation: a placed level def with `keepTerrain` legend cells must be
 * placed unrotated, cellSize 1, with numeric room tops (the terrain-height rule needs a built World: `validateUnder`).
 * @param {{rows?: string[], legend?: Object, cellSize?: number}} levelDef
 * @param {{yawSteps?: number}} [placement]
 * @returns {string[]}
 */
export function validateUnderSite(levelDef, placement) {
  const errors = [];
  if (!levelDef || !levelDef.legend || !Array.isArray(levelDef.rows)) return errors;
  const keep = Object.keys(levelDef.legend).filter((ch) => levelDef.legend[ch] && levelDef.legend[ch].keepTerrain === true);
  if (!keep.length) return errors;
  if (placement && (placement.yawSteps || 0) !== 0) errors.push(`keepTerrain level placed with yawSteps ${placement.yawSteps}: rotated sites are not supported`);
  if (levelDef.cellSize !== undefined && levelDef.cellSize !== 1) errors.push(`keepTerrain level has cellSize ${levelDef.cellSize}: only 1 is supported`);
  for (const ch of keep) {
    const sec = levelDef.legend[ch];
    const top = sec.solid ? sec.floorH : (typeof sec.topH === 'number' ? sec.topH : sec.ceilH);
    if (typeof top !== 'number') errors.push(`keepTerrain legend '${ch}' is open to the sky (ceilH/topH must be numeric)`);
  }
  return errors;
}
