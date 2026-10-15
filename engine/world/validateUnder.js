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
