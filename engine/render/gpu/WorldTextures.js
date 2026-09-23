// US-030a (docs/architecture.md 14.2 item 2, 7.2 amendment): pure packing +
// upload-plan for the world's placed structures, stacked vertically into one
// atlas per array (`GEOM` RGBA32F, `MATS` RGBA16UI, `FLAGS` RG8UI) so the
// GLSL DDA can `texelFetch` any structure's cell with one texture unit per
// array. No `gl` calls here (Node-testable) - `GpuCellPipeline.js` owns the
// actual `texImage2D`/`texSubImage2D` calls, driven by the plan this module
// returns.
//
// Atlas layout: width = max `w` of the placed structures (<= 8, structSeq
// 3-bit field, architecture.md 8.1); height = sum of every placed
// structure's `h` ("stacked vertically"). Structure `s`'s local cell
// (cx, cy) lives at atlas row `yOff(s) + cy`, column `cx` (< w(s) <= width -
// columns `w(s)..width-1` of a narrower structure's rows are left zeroed,
// and the shader never reads a column past that structure's own `w`, so
// their content is irrelevant, not garbage-sensitive).
//
// `FLAGS` amendment (7.2/14.2): `r` = the existing `packed.flags` byte (bit0
// solid, bit1 ceilSky, bit2 topSky, bit3 dynamic, bits4-7 dynamic tag id);
// `g` = `packed.relief` (floorRise | ceilDrop << 4, engine/world/packed.js).

export const MAX_STRUCTS = 8;

function assert(cond, msg) { if (!cond) throw new Error('WorldTextures: ' + msg); }

/** Builds the uStruct uniform payload (14.2 item 2): 8 rows x 2 vec4 = 64 floats. */
function packUStruct(structures, yOffsets) {
  const u = new Float32Array(MAX_STRUCTS * 8);
  for (let i = 0; i < structures.length && i < MAX_STRUCTS; i++) {
    const s = structures[i];
    const o = i * 8;
    u[o] = s.origin.x; u[o + 1] = s.origin.y; u[o + 2] = s.origin.z; u[o + 3] = s.packed.w;
    u[o + 4] = s.packed.h; u[o + 5] = yOffsets[i]; u[o + 6] = s.structSeq; u[o + 7] = 0;
  }
  return u;
}

/**
 * Full (re)build from scratch - called whenever the structure list itself
 * changes (`world.structVersion` bump: a structure placed/removed, or one of
 * their sizes changed - sizes are fixed after `placeStructure` in M1, so in
 * practice this is "count changed"). O(total cells); not a hot path.
 * @param {import('../../world/World.js').World} world
 */
export function buildWorldTextures(world) {
  const structures = world.structures.slice(0, MAX_STRUCTS);
  assert(structures.length <= MAX_STRUCTS, `${structures.length} placed structures > ${MAX_STRUCTS}`);

  let width = 1, totalHeight = 0;
  const yOffsets = [];
  for (const s of structures) {
    assert(s.packed.w > 0 && s.packed.h > 0, `structure "${s.id}": empty packed level`);
    if (s.packed.w > width) width = s.packed.w;
    yOffsets.push(totalHeight);
    totalHeight += s.packed.h;
  }
  if (totalHeight === 0) totalHeight = 1; // no structures placed (yet) - keep the texture legal-sized

  const n = width * totalHeight;
  const GEOM = new Float32Array(4 * n);
  const MATS = new Uint16Array(4 * n);
  const FLAGS = new Uint8Array(2 * n);

  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];
    const p = s.packed;
    const yOff = yOffsets[i];
    for (let cy = 0; cy < p.h; cy++) {
      const srcRow = cy * p.w;
      const dstRow = (yOff + cy) * width;
      for (let cx = 0; cx < p.w; cx++) {
        const si = srcRow + cx, di = dstRow + cx;
        GEOM[di * 4] = p.geom[si * 4]; GEOM[di * 4 + 1] = p.geom[si * 4 + 1];
        GEOM[di * 4 + 2] = p.geom[si * 4 + 2]; GEOM[di * 4 + 3] = p.geom[si * 4 + 3];
        MATS[di * 4] = p.mats[si * 4]; MATS[di * 4 + 1] = p.mats[si * 4 + 1];
        MATS[di * 4 + 2] = p.mats[si * 4 + 2]; MATS[di * 4 + 3] = p.mats[si * 4 + 3];
        FLAGS[di * 2] = p.flags[si]; FLAGS[di * 2 + 1] = p.relief[si];
      }
    }
  }

  return {
    width, height: totalHeight, GEOM, MATS, FLAGS,
    uStruct: packUStruct(structures, yOffsets),
    structCount: structures.length,
    yOffsets,
    // Snapshot so `planFrameUpdate` below can tell which packed layouts
    // (by `version`) are already reflected in these arrays.
    versions: structures.map((s) => s.packed.version),
    structVersion: world.structVersion,
  };
}

/**
 * Per-frame plan (14.2 item 2: "per frame only rows [dirtyY0, dirtyY1] of a
 * `packed` whose `version` changed are `texSubImage2D`'d"). Call once per
 * frame with the `atlas` object `buildWorldTextures` returned (or a previous
 * call to this function): if `world.structVersion` moved on, the caller must
 * rebuild from scratch instead (structure count/size changed - the atlas
 * itself is a different shape). Otherwise this rewrites, IN PLACE, only the
 * atlas rows belonging to structures whose `packed.version` advanced since
 * `atlas.versions[i]`, and returns the touched atlas row ranges (already
 * merged/sorted) for the caller's `texSubImage2D` calls; clears each
 * touched packed layout's own `dirtyY0/Y1` back to -1 (consumed).
 * @returns {{rebuildNeeded:boolean, dirtyRanges: Array<{y0:number, y1:number}>}}
 */
export function planFrameUpdate(world, atlas) {
  if (world.structVersion !== atlas.structVersion) return { rebuildNeeded: true, dirtyRanges: [] };

  const dirtyRanges = [];
  const structures = world.structures;
  for (let i = 0; i < structures.length && i < MAX_STRUCTS; i++) {
    const s = structures[i];
    const p = s.packed;
    if (p.version === atlas.versions[i]) continue;
    if (p.dirtyY0 >= 0 && p.dirtyY1 >= p.dirtyY0) {
      const yOff = atlas.yOffsets[i];
      const y0 = yOff + p.dirtyY0, y1 = yOff + p.dirtyY1;
      for (let cy = p.dirtyY0; cy <= p.dirtyY1; cy++) {
        const srcRow = cy * p.w;
        const dstRow = (yOff + cy) * atlas.width;
        for (let cx = 0; cx < p.w; cx++) {
          const si = srcRow + cx, di = dstRow + cx;
          atlas.GEOM[di * 4] = p.geom[si * 4]; atlas.GEOM[di * 4 + 1] = p.geom[si * 4 + 1];
          atlas.GEOM[di * 4 + 2] = p.geom[si * 4 + 2]; atlas.GEOM[di * 4 + 3] = p.geom[si * 4 + 3];
          atlas.MATS[di * 4] = p.mats[si * 4]; atlas.MATS[di * 4 + 1] = p.mats[si * 4 + 1];
          atlas.MATS[di * 4 + 2] = p.mats[si * 4 + 2]; atlas.MATS[di * 4 + 3] = p.mats[si * 4 + 3];
          atlas.FLAGS[di * 2] = p.flags[si]; atlas.FLAGS[di * 2 + 1] = p.relief[si];
        }
      }
      dirtyRanges.push({ y0, y1 });
      p.dirtyY0 = -1; p.dirtyY1 = -1;
    }
    atlas.versions[i] = p.version;
  }
  return { rebuildNeeded: false, dirtyRanges };
}
