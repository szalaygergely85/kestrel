// US-004 sector raycaster: one ray per screen column, walked cell-by-cell
// (DDA) through the level, drawing walls/steps/lintels/solid-column-tops as
// they're crossed and floor/ceiling planes for the cell the ray currently
// occupies, using a narrowing open vertical span (classic portal/sector
// renderer technique) so nearer geometry correctly occludes farther
// geometry and "seeing over a low wall" / "seeing through a lintel" just
// falls out of the algorithm rather than being special-cased.
//
// US-004b (overdraw/allocation/shader refactor - see docs/backlog.md and
// docs/architecture.md sections 8, 9, 12): shading is now delegated to
// `fastShade.js` by default (a from-scratch fast re-implementation, see
// that module's doc comment), not to the designer's reference shader
// directly. The reference `design/palette.js` -> `util.shade`/`shadeSky`
// remains available via `opts.shader = 'reference'` (used by
// `tools/bench-cast.mjs` and `?shadetest=1`'s oracle) and is otherwise
// untouched, so it stays the correctness baseline.
//
// US-024 (engine/game split, D-006): moved from game/js/render/raycaster.js
// to engine/render/sectorCaster.js unchanged (principle: move, do not
// refactor - the CellBuffer.glyphIdx checksum in tools/bench-cast.mjs is the
// regression test). `castScene` is kept as the internal implementation and
// public back-compat alias (bench-cast, ?shadetest=1); `castSectors(fb,
// level, cam, origin)` below is the new FrameBuffers-shaped entry point
// (architecture.md section 5): it always casts with `skyFallback: false` (it
// NEVER paints sky - that is `fillSky`'s job now, also below) and copies the
// per-frame span into the caller-owned `fb.spans` (OpenSpans instance shared
// across passes/frames, vs. this module's own single-level module-scoped
// singleton). `beginFrame`/`fillSky` are new, small, additive exports; they
// do not touch castScene's internals.
//
// Coordinate conventions (must match engine/world/Level.js exactly):
//   1 cell = 1 world meter. col/x grows east, row/y grows south.
//   facingDeg is COMPASS degrees: 0 = north (-y), 90 = east (+x), clockwise.
//   Screen rows grow downward (row 0 = top), matching RenderTarget's grid.
//
// Projection: horizontal FOV is a true camera-plane DDA cast (Lodev-style),
// which is perpendicular-distance-corrected by construction (no fisheye).
// Vertical placement of a world height `h` at ray distance `d` uses a
// linear y-shear: row = horizonRow - ((h-eye)/d)*planeDistY. `horizonRow`
// itself shifts with pitch (tan(pitch)*planeDistY) - the standard
// Doom/Build-style pitch simulation, cheap (no per-pixel trig) and exact
// enough at the clamped +-35 deg this game uses.
//
// BUG-CAST-001 rule (architect tech notes, 2026-09-24): every opaque band a
// segment emits must narrow `openBottom`/`openTop` to its own edge before
// moving on. `floorFilledTo`/`ceilingFilledTo` only clip later draws - they
// never stand in for closing the span - so a segment that draws an opaque
// band (wall face, TOP cap, step riser, ...) and forgets to fold that band's
// edge into `openBottom`/`openTop` will let a farther, still-open segment
// overwrite it (G-buffer/DepthBuffer are last-write-wins).

import { OpenSpans } from './OpenSpans.js';
import { fastShade, fastShadeSky, primeFastShadeFrame } from './fastShade.js';
import { packPlaneId, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D } from './GBuffer.js';

// US-028: kind codes the G-buffer path writes at each of this module's
// existing shading call sites (docs/backlog.md tech notes item 2/3). Only
// used when `ctx.gbuf` is set (see `emitSample` below) - the v1 legacy path
// (`shadeAndWrite`, unchanged) never touches these.
const GK_WALL = 1, GK_STEP = 2, GK_UPPER = 3, GK_FLOOR = 4, GK_TOP = 5, GK_CEIL = 6;

export const HFOV_DEG = 75;
// US-030a: exported so `engine/render/gpu/glsl/dda.frag.js` injects the SAME
// numeric constants into the GLSL source (14.1 section 1 pattern: JS is the
// single source of truth for shared layout constants) instead of hand-
// copying them - the CPU caster's own use is unaffected.
export const MAX_RAY_STEPS = 96; // DDA safety cap per column (levels are well under this in practice)
export const MAX_DIST = 120; // meters; beyond this, whatever's left open is treated as void/sky
const INTERIOR_FOG = 'interior';
const VOID_SECTOR = {
  floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, topH: 'sky', upperMat: 'stone',
  // US-028 rework: baked once per frame by `bindVoidSectorIds` below (never
  // via a per-sample `idFor` - tech notes item 1/2), so a ray that starts or
  // strays outside the level grid still has valid G-buffer material ids.
  wallMatId: 0, floorMatId: 0, ceilMatId: 0, upperMatId: 0,
};
// Cheap (4 Map.get's), done once per `castScene` call when a G-buffer path
// is active - NOT per row/sample. `VOID_SECTOR` is a shared singleton, so
// this only needs to track "was it bound to THIS session's table" once.
let voidBoundTable = null;
function bindVoidSectorIds(matTable) {
  if (voidBoundTable === matTable) return;
  VOID_SECTOR.wallMatId = matTable.idFor(VOID_SECTOR.wallMat);
  VOID_SECTOR.floorMatId = matTable.idFor(VOID_SECTOR.floorMat);
  VOID_SECTOR.upperMatId = matTable.idFor(VOID_SECTOR.upperMat);
  voidBoundTable = matTable;
}

// US-028 rework (tech notes item 3): floor/top and ceiling "relief" bit
// masks, one per level cell, W/E/N/S bits = "the neighbour in this
// direction rises against this cell's OWN floorH/ceilH" (see `planeRises`,
// which this replaces at the per-row level). Rebuilt at the top of every
// `castScene` call that uses the G-buffer path (so a dynamic `ceilH` - e.g.
// `World.animateSector` - is always current, no version bookkeeping needed);
// the arrays themselves are allocated only once per level (cached on the
// level object) - see docs/backlog.md US-028 tech notes item 3.
const RELIEF_W = 1, RELIEF_E = 2, RELIEF_N = 4, RELIEF_S = 8;
function ensureRelief(level) {
  const w = level.width, h = level.height;
  let r = level._relief028;
  if (!r || r.w !== w || r.h !== h) {
    r = { w, h, floorRise: new Uint8Array(w * h), ceilDrop: new Uint8Array(w * h) };
    level._relief028 = r;
  }
  const { floorRise, ceilDrop } = r;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const own = level.sectorAt(cx + 0.5, cy + 0.5);
      const i = cy * w + cx;
      if (!own) { floorRise[i] = 0; ceilDrop[i] = 0; continue; }
      const ownFloorH = own.floorH, ownCeilH = own.ceilH;
      let fb = 0, cb = 0;
      const west = level.sectorAt(cx - 1 + 0.5, cy + 0.5);
      const east = level.sectorAt(cx + 1 + 0.5, cy + 0.5);
      const north = level.sectorAt(cx + 0.5, cy - 1 + 0.5);
      const south = level.sectorAt(cx + 0.5, cy + 1 + 0.5);
      if (!west || west.floorH > ownFloorH + 0.01) fb |= RELIEF_W;
      if (!east || east.floorH > ownFloorH + 0.01) fb |= RELIEF_E;
      if (!north || north.floorH > ownFloorH + 0.01) fb |= RELIEF_N;
      if (!south || south.floorH > ownFloorH + 0.01) fb |= RELIEF_S;
      if (ownCeilH !== 'sky') {
        const rises = (q) => !q || q.solid || (q.ceilH !== 'sky' && q.ceilH < ownCeilH - 0.01);
        if (rises(west)) cb |= RELIEF_W;
        if (rises(east)) cb |= RELIEF_E;
        if (rises(north)) cb |= RELIEF_N;
        if (rises(south)) cb |= RELIEF_S;
      }
      floorRise[i] = fb;
      ceilDrop[i] = cb;
    }
  }
}
// Per-row aoD for a plane sample (tech notes item 3): 4 bit tests, no
// `sectorAt` at all (replaces the old `planeAoD`/`planeRises` pair, which
// called `level.sectorAt` up to 4x PER EMITTED SAMPLE).
function planeAoDFast(ctx, gkind, wx, wy) {
  const r = ctx.relief;
  const cx = Math.floor(wx), cy = Math.floor(wy);
  if (cx < 0 || cy < 0 || cx >= r.w || cy >= r.h) return Infinity;
  const bits = gkind === GK_CEIL ? r.ceilDrop[cy * r.w + cx] : r.floorRise[cy * r.w + cx];
  const fx = wx - cx, fy = wy - cy;
  let a = Infinity;
  if (bits & RELIEF_W) a = Math.min(a, fx);
  if (bits & RELIEF_E) a = Math.min(a, 1 - fx);
  if (bits & RELIEF_N) a = Math.min(a, fy);
  if (bits & RELIEF_S) a = Math.min(a, 1 - fy);
  return a;
}

// Reused across every shade() call in a frame - the reference shader writes
// into `out.fg`/`out.bg` in place and allocates nothing when they're already
// arrays (see design/README.md 1.7), so one shared object for the whole
// frame is exactly what "zero per-frame allocations" wants. Used only when
// `opts.shader === 'reference'` (bench/shadetest oracle path).
const refOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };
const refOpt = { z: 0, fog: INTERIOR_FOG };

// Fast-path output scratch (architecture.md 9: no strings in hot paths -
// `glyphIdx` is written directly, never a 1-char string). Default path.
const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };

// Reused DDA ray state (architecture.md 9 rule 3: no per-step object
// returns, no per-column closures). Reset once per column in castColumn.
const ray = {
  mapX: 0, mapY: 0,
  deltaDistX: 0, deltaDistY: 0,
  stepX: 0, stepY: 0,
  sideDistX: 0, sideDistY: 0,
  side: 0, perpDist: 0,
};

// US-004 scope: L = ambient only (US-006/007 add point lights + sun). `hue`
// is normalised so max channel = 1; intensity is the actual energy
// (design/README.md 1.5). Computed once per frame from the live palette
// (so a future time-of-day change is picked up automatically). Reused
// across frames - no per-frame allocation. Exported (US-030a bug fix) so
// `compositor.js` can prime it on the GPU-DDA path too, where `castScene`
// (the only other caller) never runs - `ambientL` is what `main.js` hands
// the GPU shade pass as `uLight`, and a stale [0,0,0] there shades every
// cell to brightness 0 = glyph 0 (space): solid colour blocks, no glyphs.
export const ambientL = [0, 0, 0];
export function primeAmbientLight(P) {
  const amb = P.lights.ambient;
  const hue = P.hue[amb.color];
  ambientL[0] = hue[0] * amb.intensity;
  ambientL[1] = hue[1] * amb.intensity;
  ambientL[2] = hue[2] * amb.intensity;
}

function clampByte(v) {
  v = Math.round(v);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Shades (mat, u, v, dist, z) through whichever shader this frame is using
// (`ctx.useReferenceShader`) and writes the result to cell (x,y), plus the
// ray's distance (meters) into the shared DepthBuffer when one is attached
// (D-008 item 1). This is the ONLY place either shader's output reaches the
// render target, so both paths go through the same allocation-free write.
function shadeAndWrite(rt, x, y, ctx, matKey, u, v, dist, z, tag) {
  // US-028: a v2-only material key (e.g. `ceiling_timber`, no v1 shader of
  // its own) must still resolve to its v1 fallback on this legacy path -
  // this is what makes `?detail=0` and the reference-shader oracle render
  // it as `stone`, exactly as before the level data changed (backlog item
  // 4). No-op for every key that already exists in `P.materials`.
  if (ctx.detailPass) {
    const dpMat = ctx.detailPass.materials[matKey];
    if (dpMat) matKey = dpMat.v1 || matKey;
  }
  let glyphIdx, fg, bg;
  if (ctx.useReferenceShader) {
    refOpt.z = z;
    ctx.U.shade(matKey, ambientL, u, v, dist, refOut, refOpt);
    const code = refOut.glyph.charCodeAt(0);
    glyphIdx = code < 32 || code > 126 ? 0 : code - 32;
    fg = refOut.fg; bg = refOut.bg;
  } else {
    fastShade(ctx.P, matKey, u, v, dist, z, fastOut);
    glyphIdx = fastOut.glyphIdx;
    fg = fastOut.fg; bg = fastOut.bg;
  }
  rt.setCellRGB(x, y, glyphIdx, clampByte(fg[0]), clampByte(fg[1]), clampByte(fg[2]),
    clampByte(bg[0]), clampByte(bg[1]), clampByte(bg[2]));
  if (ctx.depthBuffer) ctx.depthBuffer.set(x, y, dist);
}

// US-028 G-buffer write path (docs/backlog.md tech notes item 3):
// `shadeAndWrite`'s replacement when `ctx.gbuf` is set. Writes one surface
// sample (kind/mat id/face/planeId/u/v/z/aoD) plus depth - no shading here
// (that moves to `shadeSurfaces`, run once over the whole grid after every
// structure/terrain pass). Same call sites as `shadeAndWrite`, so the
// US-004b overdraw fixes (never-double-write) carry over unchanged.
// `matId` (US-028 rework, programmer item 2) is now a number the caller
// already has (baked onto the sector object by `MaterialTable.bindLevel`,
// or `VOID_SECTOR`'s own by `bindVoidSectorIds`) - no `idFor`/`Map.get` here.
function emitSample(rt, x, y, ctx, kind, matId, face, planeId, u, v, dist, z, aoD) {
  const i = y * ctx.gbuf.cols + x;
  ctx.gbuf.writeSample(i, kind, matId, face, planeId, u, v, z, aoD);
  if (ctx.depthBuffer) ctx.depthBuffer.set(x, y, dist);
}

function shadeSkyAndWrite(rt, x, y, ctx, azimuthDeg, elevDeg, tag) {
  let glyphIdx, fg, bg;
  if (ctx.useReferenceShader) {
    ctx.P.util.shadeSky(azimuthDeg, elevDeg, refOut, ctx.P.defaultTime);
    const code = refOut.glyph.charCodeAt(0);
    glyphIdx = code < 32 || code > 126 ? 0 : code - 32;
    fg = refOut.fg; bg = refOut.bg;
  } else {
    fastShadeSky(ctx.P, azimuthDeg, elevDeg, ctx.P.defaultTime, fastOut);
    glyphIdx = fastOut.glyphIdx;
    fg = fastOut.fg; bg = fastOut.bg;
  }
  rt.setCellRGB(x, y, glyphIdx, clampByte(fg[0]), clampByte(fg[1]), clampByte(fg[2]),
    clampByte(bg[0]), clampByte(bg[1]), clampByte(bg[2]));
  if (ctx.depthBuffer) ctx.depthBuffer.set(x, y, Infinity); // sky has no finite depth
}

function compassAzimuthDeg(dirX, dirY) {
  let az = Math.atan2(dirX, -dirY) * 180 / Math.PI;
  if (az < 0) az += 360;
  return az;
}

// Module-level, reused, resized only when `cols` changes (architecture.md 9
// rule 4: typed arrays sized by cols/rows are allocated once, never per
// frame). Replaces the per-frame `openSpans` object array (US-004b AC4).
// Fallback singleton for callers that do NOT pass `opts.openSpans` (bench-cast,
// ?shadetest=1, compare-detail-export): `castScene` resets and owns it itself,
// exactly as before. When `opts.openSpans` IS passed (US-025 architect review
// #1, item 1/2: `castSectors`/the compositor casting multiple structures into
// one frame), that instance is caller-owned - `castScene` never resets it
// (only `beginFrame` does, once per frame) and never copies over it; it reads
// each column's CURRENT [top,bottom] as this call's starting span (so a
// nearer structure's closed/narrowed columns are respected) and skips columns
// already fully closed.
let openSpans = null;

/**
 * @param {{cols:number, rows:number, pxCellW?:number, pxCellH?:number, setCellRGB:Function}} rt
 * @param {import('../world/Level.js').Level} level
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} camera - z = eye height, WORLD meters
 * @param {object} palette - the shading oracle (today: window.ASSETS.palette,
 *   read exactly once by the caller - see game/js/main.js - and passed in
 *   here; this module never reads window.ASSETS itself, so it is a drop-in
 *   AssetRegistry consumer once US-024 injects one instead. D-008.)
 * @param {object} [opts]
 * @param {import('./DepthBuffer.js').DepthBuffer} [opts.depthBuffer] - per-cell
 *   camera distance (meters) is written here alongside every setCellRGB call
 *   (D-008 item 1), for compositing with a future terrain pass.
 * @param {{x:number,y:number,z:number}} [opts.origin] - world-space offset of
 *   this level's local (0,0,0), so the same level data can be rendered as a
 *   structure placed anywhere in the world (D-008 item 3). Defaults to the
 *   origin, i.e. today's "level IS the world" behaviour.
 * @param {boolean} [opts.skyFallback] - when a column's ray leaves the level
 *   grid or exhausts its step budget, the vertical span that's still open
 *   is, by default, left unresolved and reported (D-008 item 2) for a
 *   terrain pass to fill in. Pass true (e.g. test_room, which has no
 *   terrain pass yet) to fill it with sky instead, matching this story's
 *   original stand-alone behaviour.
 * @param {'fast'|'reference'} [opts.shader] - which shading path to use.
 *   Defaults to 'fast' (US-004b). 'reference' calls the designer's
 *   `palette.util.shade`/`shadeSky` directly, unchanged - used by
 *   `tools/bench-cast.mjs` and `?shadetest=1`'s oracle to compare against.
 * @returns {import('./OpenSpans.js').OpenSpans} Unresolved per-column spans
 *   (every column closed when `skyFallback` is true).
 */
export function castScene(rt, level, camera, palette, opts = {}) {
  const P = palette;
  const U = P.util;
  const cols = rt.cols;
  const rows = rt.rows;
  primeAmbientLight(P);
  primeFastShadeFrame(ambientL);

  let spans = opts.openSpans;
  if (!spans) {
    if (!openSpans || openSpans.cols !== cols) openSpans = new OpenSpans(cols);
    openSpans.reset(rows);
    spans = openSpans;
  }

  const origin = opts.origin || { x: 0, y: 0, z: 0 };

  // --- camera / projection setup (once per frame, not per column) --------
  const hFovRad = HFOV_DEG * Math.PI / 180;
  const tanHalfHFov = Math.tan(hFovRad / 2);

  const yawRad = camera.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yawRad);
  const dirY = -Math.cos(yawRad);
  // "Right" on screen, compass-clockwise from `dir` (rotate 90 deg clockwise
  // on the compass: (dx,dy) -> (-dy,dx) - see the module doc's convention).
  const planeX = -dirY * tanHalfHFov;
  const planeY = dirX * tanHalfHFov;

  // Pixel aspect ratio of the actual screen (not just cols/rows) is what a
  // "square pillar looks square" needs - it accounts for cells not being
  // square in device pixels.
  const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;

  const pitchRad = camera.pitchDeg * Math.PI / 180;
  const horizonRow = rows / 2 + Math.tan(pitchRad) * planeDistY;

  const ctx = {
    P, U, rows,
    // Camera position/eye height translated into the LEVEL's own local
    // frame (world minus origin) - every sectorAt/floorAt query and all
    // projection math below stays in local meters; distances (and so the
    // DepthBuffer) are unaffected since translation doesn't change them.
    posX: camera.x - origin.x, posY: camera.y - origin.y, eyeH: camera.z - origin.z,
    horizonRow, planeDistY,
    depthBuffer: opts.depthBuffer || null,
    skyFallback: !!opts.skyFallback,
    useReferenceShader: opts.shader === 'reference',
    openSpans: spans,
    // castPlane() return value ("no object returns" - architecture.md 9
    // rule 3): it writes the clipped [r0,r1] row range here instead.
    _planeR0: 0, _planeR1: -1,
    // US-028: when set, every shading call site writes a G-buffer sample
    // instead of shading inline (see `emitSample` above) - `shadeSurfaces`/
    // `edgePass` run afterward, over the whole grid.
    gbuf: opts.gbuf || null,
    matTable: opts.matTable || null,
    detailPass: opts.detailPass || null,
    level,
    // Wall-segment scratch (US-028 tech notes item 3): face/planeId/aoD
    // inputs computed ONCE per DDA hit (not per row) - see `primeWallGSample`.
    _wFace: 0, _wPlaneId: 0, _wFr: 0, _wNbrA: null, _wNbrB: null,
    // US-030a footprintEntry fix: entry point scratch (see footprintEntry).
    _entryX: 0, _entryY: 0,
    // castFloorCeiling outputs (BUG-GPU-003: + the ceiling plane's own rows).
    _fcCeilingFilledTo: 0, _fcFloorFilledTo: 0, _fcSkyPending: false, _fcCeilR0: 0, _fcCeilR1: -1,
  };
  if (ctx.gbuf) {
    ctx.gbuf.cam.tanHalfHFov = tanHalfHFov;
    ctx.gbuf.cam.cols = cols;
    ctx.gbuf.cam.planeDistY = planeDistY;
    // US-028 rework: relief bit masks (item 3) rebuilt every call (cheap,
    // O(w*h)), and VOID_SECTOR's ids bound once per table (item 2) - neither
    // touches the per-row/per-sample hot path.
    ensureRelief(level);
    ctx.relief = level._relief028;
    if (ctx.matTable) bindVoidSectorIds(ctx.matTable);
  }

  for (let x = 0; x < cols; x++) {
    // A nearer structure/pass already closed this column this frame - never
    // re-open it (item 1: caller-owned spans, no reset here).
    if (!ctx.openSpans.isOpen(x)) continue;
    const cameraX = (2 * (x + 0.5)) / cols - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;
    ctx.rayDirX = rayDirX;
    ctx.rayDirY = rayDirY;
    castColumn(rt, level, ctx, x, rayDirX, rayDirY);
  }

  return ctx.openSpans;
}

// row <-> world height (at a FIXED distance `dist`) - the y-shear projection.
function rowAtHeight(ctx, h, dist) {
  if (dist < 1e-4) dist = 1e-4;
  return ctx.horizonRow - ((h - ctx.eyeH) / dist) * ctx.planeDistY;
}
function heightAtRow(ctx, row, dist) {
  if (dist < 1e-4) dist = 1e-4;
  return ctx.eyeH - (row - ctx.horizonRow) * dist / ctx.planeDistY;
}
// Inverse for a FIXED world height h: the distance at which a horizontal
// plane at height h crosses screen row `row` (floor/ceiling plane casting).
function distAtRowForHeight(ctx, row, h) {
  const denom = ctx.horizonRow - row;
  if (Math.abs(denom) < 1e-5) return Infinity;
  return ((h - ctx.eyeH) * ctx.planeDistY) / denom;
}
// Elevation angle (degrees) of the ray direction implied by screen row
// `row`, for the sky (tan(elev) = (horizonRow-row)/planeDistY by definition
// of the y-shear above - same relationship, just without a target height).
function elevAtRow(ctx, row) {
  return Math.atan2(ctx.horizonRow - row, ctx.planeDistY) * 180 / Math.PI;
}

// Resets the reused `ray` scratch object for a new column's DDA walk
// (architecture.md 9 rule 3: no per-column closures/objects).
// `startX`/`startY` seed `mapX`/`mapY`/`sideDist*` (where the DDA WALKS
// from); `ctx.posX`/`posY` (the true camera position) stay the distance
// reference throughout (`ddaStep`'s `perpDist` formula reads them directly),
// so starting the walk from a point other than the camera - the level-bbox
// entry point, item 2 below - still yields correct camera-relative distances.
function startRay(ctx, rayDirX, rayDirY, startX, startY) {
  ray.mapX = Math.floor(startX);
  ray.mapY = Math.floor(startY);
  ray.deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
  ray.deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
  if (rayDirX < 0) { ray.stepX = -1; ray.sideDistX = (startX - ray.mapX) * ray.deltaDistX; }
  else { ray.stepX = 1; ray.sideDistX = (ray.mapX + 1 - startX) * ray.deltaDistX; }
  if (rayDirY < 0) { ray.stepY = -1; ray.sideDistY = (startY - ray.mapY) * ray.deltaDistY; }
  else { ray.stepY = 1; ray.sideDistY = (ray.mapY + 1 - startY) * ray.deltaDistY; }
}

// (Item 2, architect review #1) When the camera sits outside a structure's
// own footprint (`[0,level.width) x [0,level.height)`), the DDA must still
// be able to cast it: slab-clip the ray against that box and hand back the
// entry point (nudged a hair inward) for `startRay` to walk from. US-030a
// carry-over fix: no object return any more (architecture.md 9 rule 3 - this
// was allocating one `{valid,x,y}` literal PER COLUMN PER CAST, i.e. every
// structure x every frame). Writes `ctx._entryX`/`ctx._entryY` in place
// (reused scratch fields, like `ctx._planeR0/1`/`ctx._fc*`) and returns a
// plain bool: false when the ray never crosses the box (behind the camera,
// or parallel and offset) - that column has nothing to draw for this level.
function footprintEntry(ctx, level, rayDirX, rayDirY) {
  const { posX, posY } = ctx;
  const w = level.width, h = level.height;
  if (posX >= 0 && posX < w && posY >= 0 && posY < h) { ctx._entryX = posX; ctx._entryY = posY; return true; }

  let tMin = -Infinity, tMax = Infinity;
  if (rayDirX !== 0) {
    const t1 = (0 - posX) / rayDirX, t2 = (w - posX) / rayDirX;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  } else if (posX < 0 || posX > w) {
    return false;
  }
  if (rayDirY !== 0) {
    const t1 = (0 - posY) / rayDirY, t2 = (h - posY) / rayDirY;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  } else if (posY < 0 || posY > h) {
    return false;
  }
  if (tMax < tMin || tMax < 0) return false;

  const t = Math.max(tMin, 0) + 1e-4; // nudge past the boundary, into the first cell
  ctx._entryX = posX + rayDirX * t;
  ctx._entryY = posY + rayDirY * t;
  return true;
}

// Advances `ray` by one DDA step, writing `ray.side`/`ray.perpDist` in
// place. side: 0 = crossed an X boundary (a north/south-facing wall - it
// runs along Y, so its texture U coordinate is the hit Y); 1 = crossed a Y
// boundary (an east/west-facing wall, U = hit X).
function ddaStep(ctx, rayDirX, rayDirY) {
  if (ray.sideDistX < ray.sideDistY) { ray.sideDistX += ray.deltaDistX; ray.mapX += ray.stepX; ray.side = 0; }
  else { ray.sideDistY += ray.deltaDistY; ray.mapY += ray.stepY; ray.side = 1; }
  ray.perpDist = ray.side === 0
    ? (ray.mapX - ctx.posX + (1 - ray.stepX) / 2) / rayDirX
    : (ray.mapY - ctx.posY + (1 - ray.stepY) / 2) / rayDirY;
}

// US-028 (tech notes item 3, port of design/preview/detail_pass.html's
// `wallS`): face/planeId/aoD-neighbour setup for a wall-type sample, done
// ONCE per DDA hit from the module-scoped `ray` state (side/mapX/mapY/
// stepX/stepY are stable for the whole row loop that follows). Writes onto
// `ctx._w*` scratch fields (no object return - architecture.md 9 rule 3).
function primeWallGSample(ctx, level, hitX, hitY) {
  const side = ray.side, mapX = ray.mapX, mapY = ray.mapY, stepX = ray.stepX, stepY = ray.stepY;
  let face, coord, fr, nbrA, nbrB;
  if (side === 0) {
    face = stepX > 0 ? FACE_W : FACE_E;
    coord = stepX > 0 ? mapX : mapX + 1;
    const ox = mapX - stepX;
    fr = hitY - mapY;
    nbrA = level.sectorAt(ox + 0.5, mapY - 1 + 0.5);
    nbrB = level.sectorAt(ox + 0.5, mapY + 1 + 0.5);
  } else {
    face = stepY > 0 ? FACE_N : FACE_S;
    coord = stepY > 0 ? mapY : mapY + 1;
    const oy = mapY - stepY;
    fr = hitX - mapX;
    nbrA = level.sectorAt(mapX - 1 + 0.5, oy + 0.5);
    nbrB = level.sectorAt(mapX + 1 + 0.5, oy + 0.5);
  }
  ctx._wFace = face;
  ctx._wPlaneId = packPlaneId(ctx.gbuf.structSeq, face, coord);
  ctx._wFr = fr;
  ctx._wNbrA = nbrA;
  ctx._wNbrB = nbrB;
}

// Per-row aoD for a wall sample (tech notes item 3): the expensive part
// (neighbour sector lookups) already happened once in `primeWallGSample` -
// this is just the cheap per-row compare against the current row's height.
function wallAoD(ctx, near, h, z) {
  let d = Math.max(0, z);
  const zc = near.ceilH === 'sky' ? Infinity : near.ceilH - h;
  if (zc < d) d = Math.max(0, zc);
  const nbrA = ctx._wNbrA, nbrB = ctx._wNbrB, fr = ctx._wFr;
  if (!nbrA || nbrA.floorH > h) d = Math.min(d, fr);
  if (!nbrB || nbrB.floorH > h) d = Math.min(d, 1 - fr);
  return d;
}

function castColumn(rt, level, ctx, x, rayDirX, rayDirY) {
  const { posX, posY } = ctx;
  const azimuthDeg = compassAzimuthDeg(rayDirX, rayDirY);

  // Item 1 (architect review #1): the incoming span is caller-owned and may
  // already be narrowed by a nearer structure cast earlier this frame - start
  // (and clip) this column's walk to exactly that, never the full [0,rows-1].
  let openTop = ctx.openSpans.top[x];
  let openBottom = ctx.openSpans.bottom[x];

  // Item 2: the camera may be outside THIS level's own footprint (a
  // structure whose bbox doesn't contain the camera) - slab-clip the ray to
  // the footprint and start the DDA at the entry cell instead of giving up
  // immediately (the old behaviour: first `sectorAt` outside the grid ->
  // `farSector` null -> instant return, drawing nothing).
  if (!footprintEntry(ctx, level, rayDirX, rayDirY)) {
    // Never crosses this level's footprint at all - leave the span exactly
    // as it came in, for whatever casts next (another structure/terrain).
    resolveColumn(rt, level, ctx, x, openTop, openBottom, azimuthDeg, Infinity, ctx.rows, false, openTop - 1);
    return;
  }
  startRay(ctx, rayDirX, rayDirY, ctx._entryX, ctx._entryY);
  let skyPending = false; // sky was requested but not yet painted - deferred to column end (US-004b)
  let ceilingFilledTo = openTop - 1; // highest row index a ceiling segment has already drawn
  let floorFilledTo = ctx.rows; // lowest-numbered (closest-to-horizon) row any floor-ish plane has reached; ctx.rows = "nothing yet"
  // Separate near-distances for the floor vs. ceiling plane (see
  // castFloorCeiling's doc comment) - equal except right after a solid
  // cell, where the floor's near end jumps to its exit (the cap already
  // covered [entry,exit]) but the ceiling's stays at its entry (nothing
  // else covers that range for the ceiling).
  let prevFloorDist = 0;
  let prevCeilDist = 0;
  let nearSector = level.sectorAt(posX, posY) || VOID_SECTOR;
  // BUG-GPU-003: the contiguous run of rows the most recent ceiling PLANE
  // draws (GK_CEIL, not sky) have claimed in this column, [ceilRunR0,
  // ceilRunR1] (empty when r1 < r0). Ceiling rows are only tracked by
  // `ceilingFilledTo`, which never narrows `openTop`, so a farther solid
  // wall whose top is above that ceiling (e.g. tower 'K' sun crack, ceilH
  // 6.4, next to an 8.5 m wall) used to overwrite ceiling rows that are
  // NEARER than the wall face (last write wins) - the GPU's first-hit DDA
  // (dda.frag) correctly keeps the ceiling there. The wall-face loop skips
  // exactly these rows.
  let ceilRunR0 = 0, ceilRunR1 = -1;

  for (let i = 0; i < MAX_RAY_STEPS && openTop <= openBottom; i++) {
    ddaStep(ctx, rayDirX, rayDirY);
    const perpDist = ray.perpDist;
    if (perpDist > MAX_DIST) break;

    const hitX = posX + perpDist * rayDirX;
    const hitY = posY + perpDist * rayDirY;
    const u = ray.side === 0 ? hitY : hitX;

    // Looked up BEFORE castFloorCeiling (US-004b ARCH CHANGES item 1): the
    // sky-band decision below needs to know what's on the far side of this
    // segment (a numeric ceiling to bound the sky by, a solid cell, more
    // sky, or the grid edge).
    const farSector = level.sectorAt(ray.mapX + 0.5, ray.mapY + 0.5);

    // 1) The NEAR cell's own floor + ceiling planes, for the segment we
    // just finished walking through.
    castFloorCeiling(rt, x, ctx, nearSector, farSector, prevFloorDist, prevCeilDist, perpDist,
      openTop, openBottom, azimuthDeg, ceilingFilledTo, floorFilledTo, skyPending);
    ceilingFilledTo = ctx._fcCeilingFilledTo; floorFilledTo = ctx._fcFloorFilledTo;
    skyPending = ctx._fcSkyPending;
    if (ctx._fcCeilR1 >= ctx._fcCeilR0) {
      if (ceilRunR1 >= ceilRunR0 && ctx._fcCeilR0 === ceilRunR1 + 1) ceilRunR1 = ctx._fcCeilR1;
      else { ceilRunR0 = ctx._fcCeilR0; ceilRunR1 = ctx._fcCeilR1; }
    }

    if (!farSector) {
      // Left the level grid: this is a job for the terrain pass (D-008 item
      // 2), not this one - leave the remaining span unresolved unless the
      // caller asked for the old stand-alone sky fallback.
      resolveColumn(rt, level, ctx, x, openTop, openBottom, azimuthDeg, perpDist, floorFilledTo, skyPending, ceilingFilledTo);
      return;
    }

    // US-028: face/planeId/aoD-neighbour inputs for whichever wall-type
    // sample this segment ends up emitting (solid face, stepfront or
    // lintel - at most one of the three fires per segment). Computed once
    // per DDA hit, not per row (tech notes item 3).
    if (ctx.gbuf) primeWallGSample(ctx, level, hitX, hitY);

    if (farSector.solid) {
      const entryDist = perpDist;
      const rowAtTop = rowAtHeight(ctx, farSector.floorH, entryDist);
      const wallRowStart = Math.max(openTop, Math.ceil(rowAtTop));
      // US-004b overdraw fix (architecture.md 12 item 1a): the wall face
      // must stop at the near sector's OWN floor row (mirroring the
      // step-front branch's r1 below) - rows past that were already drawn
      // by this segment's `castFloorCeiling` floor plane, above.
      // Also capped by the running `floorFilledTo` high-water mark (not
      // just this segment's own `nearSector.floorH`): a PREVIOUS solid
      // cell's cap can leave the true "floor already drawn" boundary
      // higher up than what `nearSector.floorH` alone would predict (US-004b,
      // found empirically) - `floorFilledTo` is the accumulated truth.
      const wallRowEnd = Math.min(openBottom, Math.floor(rowAtHeight(ctx, nearSector.floorH, entryDist)), floorFilledTo - 1);
      for (let row = wallRowStart; row <= wallRowEnd; row++) {
        if (row >= ceilRunR0 && row <= ceilRunR1) continue; // BUG-GPU-003: a nearer ceiling plane owns this row
        const h = heightAtRow(ctx, row, entryDist);
        const z = h - nearSector.floorH;
        if (ctx.gbuf) emitSample(rt, x, row, ctx, GK_WALL, farSector.wallMatId, ctx._wFace, ctx._wPlaneId, u, h, entryDist, z, wallAoD(ctx, nearSector, h, z));
        else shadeAndWrite(rt, x, row, ctx, farSector.wallMat, u, h, entryDist, z, 'wallface');
      }

      ddaStep(ctx, rayDirX, rayDirY);
      const exitDist = Math.min(ray.perpDist, MAX_DIST);
      // US-004b: clamp to the column's CURRENT `openBottom`, not just
      // `wallRowStart-1` - a farther solid cell's own `wallRowStart` (this
      // one) is computed from ITS height/distance alone and can exceed
      // what a NEARER wall already closed off (`openBottom`), which would
      // let this cap redraw rows the nearer wall's face already correctly
      // owns (found empirically: two solid cells along the same ray, the
      // second one's cap reaching back into the first one's wall-face
      // rows).
      const capRowEnd = Math.min(openBottom, wallRowStart - 1);
      castPlane(rt, x, ctx, farSector.floorMat, farSector.floorMatId, farSector.floorH, entryDist, exitDist,
        openTop, capRowEnd, farSector.floorH, GK_TOP);
      const capDrawn = ctx._planeR1 >= ctx._planeR0;
      if (capDrawn) floorFilledTo = Math.min(floorFilledTo, ctx._planeR0);

      // BUG-CAST-001 fix (architect tech notes, 2026-09-24): every opaque
      // band a segment emits must narrow openBottom to its own edge. The
      // cap rows [openTop, capRowEnd] this castPlane just drew are opaque
      // (same as the wall face below them), so close the column up to the
      // cap's own top edge (_planeR0), not just wallRowStart-1 - otherwise
      // the cap rows stay "open" and a farther floor/step behind can
      // overwrite them (last-write-wins) at grazing angles over a thin
      // wall-top band. dda.frag is the first-hit GPU reference and is
      // unchanged; only the CPU caster was wrong.
      openBottom = Math.min(openBottom, capDrawn ? ctx._planeR0 - 1 : wallRowStart - 1);
      prevFloorDist = exitDist; // the cap just drawn covers the floor's own [entry,exit]
      const solidSector = farSector;
      nearSector = level.sectorAt(ray.mapX + 0.5, ray.mapY + 0.5) || VOID_SECTOR;

      // BUG-CPU-001 fix: the inner ddaStep above jumps straight past the
      // solidSector -> nearSector boundary at exitDist without ever running
      // the transition checks the non-solid branch below runs - so a step
      // face between (e.g.) a 7.0 m wall top and a taller 7.5/8.0 m
      // neighbour (solid or not) at that exact boundary was never drawn.
      // Mirror that branch here: next solid with a higher floorH gives a
      // WALL face, next non-solid with a higher floorH gives a STEP, rows
      // [rowAtHeight(next.floorH), rowAtHeight(solid.floorH)], clipped by
      // openTop/openBottom/floorFilledTo like the existing branches.
      if (nearSector.floorH > solidSector.floorH) {
        const exitHitX = posX + exitDist * rayDirX;
        const exitHitY = posY + exitDist * rayDirY;
        if (ctx.gbuf) primeWallGSample(ctx, level, exitHitX, exitHitY);
        const uExit = ray.side === 0 ? exitHitY : exitHitX;
        // Mirrors the non-solid branch's `higher === farSector` case (no
        // floorFilledTo clamp): here the FAR side (nearSector) is always the
        // higher one by construction, so nothing already drawn can dip into
        // this band from the near side.
        const r0x = Math.max(openTop, Math.ceil(rowAtHeight(ctx, nearSector.floorH, exitDist)));
        const r1x = Math.min(openBottom, Math.floor(rowAtHeight(ctx, solidSector.floorH, exitDist)));
        const faceKind = nearSector.solid ? GK_WALL : GK_STEP;
        for (let row = r0x; row <= r1x; row++) {
          const h = heightAtRow(ctx, row, exitDist);
          const z = h - solidSector.floorH;
          if (ctx.gbuf) emitSample(rt, x, row, ctx, faceKind, nearSector.wallMatId, ctx._wFace, ctx._wPlaneId, uExit, h, exitDist, z, wallAoD(ctx, solidSector, h, z));
          else shadeAndWrite(rt, x, row, ctx, nearSector.wallMat, uExit, h, exitDist, z, nearSector.solid ? 'wallface' : 'stepfront');
        }
        openBottom = Math.min(openBottom, r0x - 1);
      }
      // US-004b ARCH CHANGES (re-review #3): the solid cell has its own
      // ceiling plane (`solidSector.ceilH`, e.g. 'sky' over a low wall)
      // that this segment never ran through castFloorCeiling - without
      // this call, sky above a low solid cell is never evaluated as a
      // segment (bug 1), and the far side's ceiling would be stretched
      // back from `entryDist` over the solid cell's own span, since
      // `prevCeilDist` used to stay at `entryDist` (bug 2). The floor is
      // not re-run here (dNearFloor === dFar === exitDist, so the plane
      // guard `dFar > dNearFloor` is false - the cap above already drew
      // [entryDist, exitDist]).
      castFloorCeiling(rt, x, ctx, solidSector, nearSector, exitDist /* floor skipped: cap drew it */, entryDist, exitDist,
        openTop, openBottom, azimuthDeg, ceilingFilledTo, floorFilledTo, skyPending);
      ceilingFilledTo = ctx._fcCeilingFilledTo; floorFilledTo = ctx._fcFloorFilledTo; skyPending = ctx._fcSkyPending;
      if (ctx._fcCeilR1 >= ctx._fcCeilR0) {
        if (ceilRunR1 >= ceilRunR0 && ctx._fcCeilR0 === ceilRunR1 + 1) ceilRunR1 = ctx._fcCeilR1;
        else { ceilRunR0 = ctx._fcCeilR0; ceilRunR1 = ctx._fcCeilR1; }
      }
      prevCeilDist = exitDist; // the solid cell's own ceiling segment (if any) is now handled above
      if (openTop > openBottom) break;
      continue;
    }

    // 2) Non-solid transition: floor step/ledge front + ceiling lintel face.
    if (farSector.floorH !== nearSector.floorH) {
      const higher = farSector.floorH > nearSector.floorH ? farSector : nearSector;
      const lo = Math.min(farSector.floorH, nearSector.floorH);
      const hi = Math.max(farSector.floorH, nearSector.floorH);
      const r0 = Math.max(openTop, Math.ceil(rowAtHeight(ctx, hi, perpDist)));
      const r1 = Math.min(openBottom, Math.floor(rowAtHeight(ctx, lo, perpDist)));
      // US-004b: when the near sector is the higher side, this band's
      // BOTTOM edge (`r1`) can dip into rows some earlier floor-ish plane
      // already claimed - `floorFilledTo` is the running high-water mark
      // (see castColumn; any floor plane so far, not just this iteration's
      // - a solid cell's cap several iterations back can leave this
      // boundary too, found empirically). `drawR1` (not `r1` itself) is
      // pulled back so the draw loop skips those rows; `openBottom` below
      // still narrows to the TRUE boundary (`r0-1`, unaffected by this -
      // the riser's TOP edge is untouched by this clip).
      const drawR1 = (higher === nearSector) ? Math.min(r1, floorFilledTo - 1) : r1;
      for (let row = r0; row <= drawR1; row++) {
        const h = heightAtRow(ctx, row, perpDist);
        const z = h - nearSector.floorH;
        if (ctx.gbuf) emitSample(rt, x, row, ctx, GK_STEP, higher.wallMatId, ctx._wFace, ctx._wPlaneId, u, h, perpDist, z, wallAoD(ctx, nearSector, h, z));
        else shadeAndWrite(rt, x, row, ctx, higher.wallMat, u, h, perpDist, z, 'stepfront');
      }
      openBottom = Math.min(openBottom, r0 - 1);
    }

    if (farSector.ceilH !== 'sky' && nearSector.ceilH !== 'sky' &&
        farSector.ceilH !== nearSector.ceilH) {
      const lowerCell = farSector.ceilH < nearSector.ceilH ? farSector : nearSector;
      const loC = Math.min(farSector.ceilH, nearSector.ceilH);
      const hiC = Math.max(lowerCell.topH, Math.max(farSector.ceilH, nearSector.ceilH));
      const r0 = Math.max(openTop, Math.ceil(rowAtHeight(ctx, hiC, perpDist)));
      const r1 = Math.min(openBottom, Math.floor(rowAtHeight(ctx, loC, perpDist)));
      // US-004b: symmetric to the stepfront clip above (mirrored: this
      // band's TOP edge can dip into rows some earlier ceiling-ish plane
      // already claimed, tracked by the running `ceilingFilledTo` high-
      // water mark) - `drawR0` (not `r0` itself) is pushed past it for the
      // draw loop only; `openTop` below still narrows to the TRUE boundary
      // (`r1+1`, unaffected by this - the lintel's BOTTOM edge is untouched).
      const drawR0 = (lowerCell === nearSector) ? Math.max(r0, ceilingFilledTo + 1) : r0;
      for (let row = drawR0; row <= r1; row++) {
        const h = heightAtRow(ctx, row, perpDist);
        const z = h - nearSector.floorH;
        const mat = lowerCell.upperMat || lowerCell.wallMat;
        const matId = lowerCell.upperMatId || lowerCell.wallMatId;
        if (ctx.gbuf) emitSample(rt, x, row, ctx, GK_UPPER, matId, ctx._wFace, ctx._wPlaneId, u, h, perpDist, z, wallAoD(ctx, nearSector, h, z));
        else shadeAndWrite(rt, x, row, ctx, mat, u, h, perpDist, z, 'lintel');
      }
      openTop = Math.max(openTop, r1 + 1);
    }

    prevFloorDist = perpDist;
    prevCeilDist = perpDist;
    nearSector = farSector;
  }

  // Ran out of step budget / max distance without closing the span or
  // leaving the grid (an unusually large open room) - same "hand off
  // whatever's left" treatment as leaving the grid (D-008 item 2).
  resolveColumn(rt, level, ctx, x, openTop, openBottom, azimuthDeg, prevFloorDist, floorFilledTo, skyPending, ceilingFilledTo);
}

// Finishes a column: pays off any deferred sky fill (US-004b overdraw fix,
// architecture.md 12 item 1b - sky is painted ONCE here, into whatever
// remains between the top of the span and the floor high-water mark, never
// mid-loop), then hands off however the caller wants: `skyFallback` fills
// what's left with sky (stand-alone rendering, e.g. test_room), otherwise
// it's recorded in `ctx.openSpans` for a later terrain pass (D-008 item 2).
function resolveColumn(rt, level, ctx, x, openTop, openBottom, azimuthDeg, depth, floorFilledTo, skyPending, ceilingFilledTo) {
  // Rows a non-sky ceiling segment already drew are consumed even though
  // `openTop` itself is never narrowed by that draw (only `ceilingFilledTo`
  // is, so a farther ceiling segment can pick up where a nearer one left
  // off - see castFloorCeiling). Without this, a column whose ray runs out
  // of geometry right after such a ceiling (grid edge / max steps, with sky
  // never actually requested) falls straight into the generic fallback
  // below using the STALE `openTop`, which would repaint the very rows the
  // ceiling just correctly drew - a real overdraw source, not just the
  // sky-vs-floor one architecture.md 12 item 1b describes.
  openTop = Math.max(openTop, ceilingFilledTo + 1);

  // US-004b ARCH CHANGES item 1(d): only paint the deferred sky when
  // `skyFallback` is on. With it off (a future terrain pass owns these
  // rows), leave them open instead - painting them here would wrongly
  // claim rows a terrain pass needs as "sky-resolved".
  if (skyPending && ctx.skyFallback && openTop <= openBottom) {
    const r1 = Math.min(openBottom, floorFilledTo - 1);
    if (openTop <= r1) {
      fillSkySpan(rt, x, ctx, openTop, r1, azimuthDeg);
      openTop = r1 + 1;
    }
  }

  if (openTop > openBottom) {
    ctx.openSpans.close(x);
    return;
  }
  if (ctx.skyFallback) {
    fillSkySpan(rt, x, ctx, openTop, openBottom, azimuthDeg);
    ctx.openSpans.close(x);
  } else {
    ctx.openSpans.top[x] = openTop;
    ctx.openSpans.bottom[x] = openBottom;
    ctx.openSpans.depth[x] = depth;
  }
}

// Casts a sector's own floor plane and (unless sky already closed the top,
// or this segment is itself the sky) ceiling plane, clipped to the open row
// span AND to `ceilingFilledTo` (see castColumn): rows a NEARER ceiling
// segment already drew are never redrawn by a FARTHER one - without this, a
// ceiling-height change whose projected extent gets clamped at the screen
// edge could have two different segments both "reach" row 0 and the
// farther one would wrongly overwrite the nearer, correctly-occluding one
// (a real visual bug, verified via a call-count audit, not just wasted
// work).
//
// The floor and ceiling planes take SEPARATE near distances (`dNearFloor`,
// `dNearCeil`, both paired with the same `dFar`): after a solid cell, the
// floor's near end is the solid cell's EXIT distance (its own top face -
// the "cap" - already covered [entry,exit] in castColumn's solid branch),
// but the ceiling's near end stays at the solid cell's ENTRY distance,
// because nothing else ever draws "the ceiling while the ray was inside
// the solid cell's footprint" - the solid cell doesn't occlude the ceiling
// above it (US-004b: without this, that [entry,exit] distance range's
// projected rows are a genuine, if narrow, gap - never written by anything
// - found empirically while verifying AC2's exact write count; the
// original code's overdraw-heavy sky fallback silently painted over it,
// which is exactly the kind of waste this story removes, so the gap has to
// be closed properly instead).
//
// Sky is never painted as a DEFERRED fallback here (US-004b) unless the far
// side's bound is still unknown: when this segment's ceiling is sky, it
// decides per-segment (using `farSector`, see below) whether to paint the
// sky band immediately (bounded by the next numeric ceiling) or only raise
// `skyRequested` (deferred paint at column end, in `resolveColumn`, using
// the FINAL floor high-water mark). There used to be a `skyClosedTop` latch
// that, once set by a deferred segment, suppressed ceiling processing for
// the REST of the column - that broke a multi-cell-wide skylight: the
// first `^` segment (whose far side is another `^`) deferred and latched
// closed, so the LAST `^` segment (whose far side is finally a real
// ceiling) never got a chance to bound and paint the sky (architect
// re-review 2026-09-24). Removed: every segment with a sky ceiling now
// re-evaluates its OWN `farSector` independently, every time.
//
// No object is returned (architecture.md 9 rule 3): the updated
// {ceilingFilledTo, floorFilledTo, skyRequested} are written onto `ctx._fc*`
// scratch fields (reused every call, like `ctx._planeR0/1`) and read back
// by the caller.
function castFloorCeiling(rt, x, ctx, sector, farSector, dNearFloor, dNearCeil, dFar, openTop, openBottom, azimuthDeg, ceilingFilledTo, floorFilledTo, skyPending) {
  // (Item 2) `sector === VOID_SECTOR` means the ray hasn't reached (or has
  // left) this level's footprint - there is no floor to draw for the void
  // itself. The `sector.ceilH === 'sky'` branch below already special-cases
  // VOID_SECTOR for the ceiling/sky-band side (case (d)); this guard is its
  // floor-side counterpart, only reachable now that a column can legitimately
  // start with `sector` == VOID_SECTOR (camera outside the footprint).
  ctx._fcCeilR0 = 0; ctx._fcCeilR1 = -1; // BUG-GPU-003: this call's ceiling-plane rows (none yet)
  if (sector !== VOID_SECTOR && openTop <= openBottom && dFar > dNearFloor) {
    castPlane(rt, x, ctx, sector.floorMat, sector.floorMatId, sector.floorH, dNearFloor, dFar, openTop, openBottom, sector.floorH,
      sector.solid ? GK_TOP : GK_FLOOR);
    if (ctx._planeR1 >= ctx._planeR0) floorFilledTo = Math.min(floorFilledTo, ctx._planeR0);
  }

  if (openTop <= openBottom) {
    const ceilTop = Math.max(openTop, ceilingFilledTo + 1);
    if (ceilTop <= openBottom) {
      if (sector.ceilH === 'sky') {
        // US-004b ARCH CHANGES item 1 (skylight far-ceiling bug): the sky
        // band must be bounded by whatever's on the far side of THIS
        // segment, not left open until something eventually stops it.
        if (sector === VOID_SECTOR) {
          // (d) the ray left the grid (or started outside any sector) -
          // request nothing at all, and don't touch `skyPending` either.
          // These rows stay open: `resolveColumn` fills them with sky when
          // `skyFallback` is on (same look as before), or reports them as
          // an open span for a future terrain pass - which a "sky-closed"
          // claim here would have hidden.
        } else if (farSector && !farSector.solid && farSector.ceilH !== 'sky') {
          // (a) the far side has a numeric ceiling: paint the sky band now,
          // bounded by exactly where that far ceiling's own plane will
          // start (mirrors castPlane's near/far-exclusive convention - see
          // its doc comment). Farther (non-sky) ceilings then continue from
          // the advanced `ceilingFilledTo` as usual. This is the fix for
          // "cannot see the building's ceiling beyond the skylight". This
          // fully resolves any previously pending sky too - a farther
          // segment's real ceiling must not stay gated on it (found while
          // fixing the multi-cell-skylight bug: a solid cell whose own
          // `ceilH` happens to be 'sky' can defer, then the very next
          // segment can be a real ceiling with no open-sky segment in
          // between to re-resolve it otherwise).
          const skyR1 = Math.min(openBottom, Math.ceil(rowAtHeight(ctx, farSector.ceilH, dFar)) - 1);
          if (ceilTop <= skyR1) {
            fillSkySpan(rt, x, ctx, ceilTop, skyR1, azimuthDeg);
            ceilingFilledTo = Math.max(ceilingFilledTo, skyR1);
          }
          skyPending = false;
        } else {
          // (b) the far side is solid (its wall face / `openBottom` will
          // bound the sky), or (c) it's more sky, or it's the grid edge -
          // the far bound isn't known yet: defer, as before (painted once,
          // at column end, using the final `floorFilledTo`). No latch on
          // FUTURE sky segments (removed, see the module doc): the NEXT
          // segment re-decides independently from scratch. `skyPending`
          // itself, though, does carry forward - see the ceiling-plane
          // branch below.
          skyPending = true;
        }
      } else if (!skyPending && dFar > dNearCeil) {
        // `skyPending`: a still-unresolved deferred sky band from an
        // EARLIER segment. Drawing a real ceiling here would use the wrong
        // `ceilTop` (`ceilingFilledTo` doesn't know about the pending band
        // yet) and steal rows the deferred paint in `resolveColumn` still
        // owns. Skip until it's resolved (branch (a) above, on a LATER
        // segment whose OWN `sector.ceilH` is still 'sky', clears it) -
        // `ceilingFilledTo` stays put meanwhile, so this same draw is
        // retried, correctly, once it is.
        castPlane(rt, x, ctx, sector.ceilMat, sector.ceilMatId, sector.ceilH, dNearCeil, dFar, ceilTop, openBottom, sector.floorH, GK_CEIL);
        if (ctx._planeR1 >= ctx._planeR0) {
          ceilingFilledTo = Math.max(ceilingFilledTo, ctx._planeR1);
          ctx._fcCeilR0 = ctx._planeR0; ctx._fcCeilR1 = ctx._planeR1;
        }
      }
    }
  }

  ctx._fcCeilingFilledTo = ceilingFilledTo;
  ctx._fcFloorFilledTo = floorFilledTo;
  ctx._fcSkyPending = skyPending;
}

// Draws a single horizontal plane (floor, ceiling, or a solid column's top
// face) at world height `h`, across ray segment [dNear,dFar], one row at a
// time - each row's exact distance/world position is recovered from the row
// itself (via distAtRowForHeight), so texture sampling stays accurate.
// Writes the actual (clipped) row range drawn into `ctx._planeR0/_planeR1`
// (r1 < r0 if none) instead of returning an object (architecture.md 9 rule 3).
//
// Adjacent segments share a distance boundary (this segment's dFar is the
// next segment's dNear) - the SAME world height at the SAME distance
// therefore projects to the SAME row on both sides. To avoid drawing that
// boundary row twice (a real bug this was verified against: ~40% of cells
// were being shaded 2-4x, costing several ms/frame), the near end of a
// segment (shared with the PREVIOUS segment's far end) is inclusive and the
// far end (shared with the NEXT segment's near end) is exclusive,
// regardless of whether row increases or decreases with distance (floors
// and ceilings go opposite ways).
// `gkind` (US-028): GK_FLOOR/GK_TOP/GK_CEIL - which kind of plane this is,
// for the G-buffer path (face + planeId + aoD). Unused on the v1 path.
function castPlane(rt, x, ctx, matKey, matId, h, dNear, dFar, openTop, openBottom, floorHForZ, gkind) {
  const rowAtNear = rowAtHeight(ctx, h, Math.max(dNear, 1e-3));
  const rowAtFar = rowAtHeight(ctx, h, Math.max(dFar, 1e-3));
  let r0, r1;
  if (rowAtNear <= rowAtFar) {
    r0 = Math.ceil(rowAtNear);
    r1 = Math.ceil(rowAtFar) - 1;
  } else {
    r0 = Math.floor(rowAtFar) + 1;
    r1 = Math.floor(rowAtNear);
  }
  r0 = Math.max(openTop, r0);
  r1 = Math.min(openBottom, r1);
  const gbuf = ctx.gbuf;
  const face = gkind === GK_CEIL ? FACE_D : FACE_U;
  const planeId = gbuf ? packPlaneId(gbuf.structSeq, gkind, Math.round(h * 1000) + 0x800000) : 0;
  for (let row = r0; row <= r1; row++) {
    const dist = distAtRowForHeight(ctx, row, h);
    if (!Number.isFinite(dist) || dist <= 0) continue;
    // World position at this row's exact distance, along THIS column's ray
    // (ctx.rayDirX/Y are set once per column in castScene's loop).
    const wx = ctx.posX + ctx.rayDirX * dist;
    const wy = ctx.posY + ctx.rayDirY * dist;
    const z = h - floorHForZ;
    if (gbuf) emitSample(rt, x, row, ctx, gkind, matId, face, planeId, wx, wy, dist, z, planeAoDFast(ctx, gkind, wx, wy));
    else shadeAndWrite(rt, x, row, ctx, matKey, wx, wy, dist, z, 'plane');
  }
  ctx._planeR0 = r0;
  ctx._planeR1 = r1;
}

function fillSkySpan(rt, x, ctx, openTop, openBottom, azimuthDeg) {
  for (let row = openTop; row <= openBottom; row++) {
    const elevDeg = elevAtRow(ctx, row);
    shadeSkyAndWrite(rt, x, row, ctx, azimuthDeg, elevDeg, 'fillsky');
  }
}

// ---------------------------------------------------------------------------
// US-024 new API surface (architecture.md section 5). `FrameBuffers` =
// { rt, depth, spans, palette, lights, timeSec }.

/** @param {{rt, depth, spans}} fb */
export function beginFrame(fb) {
  fb.depth.clear();
  if (fb.spans) fb.spans.reset(fb.rt.rows);
  if (fb.gbuf) fb.gbuf.beginFrame();
}

/**
 * New entry point: casts `level` (as a structure placed at `origin`, world
 * meters) into `fb`, always with sky-painting off (that is `fillSky`'s job,
 * called once per frame after every structure/terrain pass has narrowed
 * `fb.spans` - see architecture.md section 8). Thin adapter over the
 * unchanged `castScene`: copies its per-frame result into the caller-owned
 * `fb.spans` so multiple passes can share one OpenSpans instance.
 *
 * (Architect review #1, items 1/2, 2026-09-23): `fb.spans` (when present) is
 * now passed straight through as `opts.openSpans` - the CALLER's instance,
 * never reset or copied here. `castScene` reads and narrows it in place, so
 * `renderWorld` casting several structures near-to-far into the same `fb`
 * composites correctly: a nearer structure's closed columns stay closed for
 * every structure cast after it (no more "last structure wins").
 */
export function castSectors(fb, level, cam, origin) {
  castScene(fb.rt, level, cam, fb.palette, {
    depthBuffer: fb.depth, origin, skyFallback: false,
    gbuf: fb.gbuf || null, matTable: fb.matTable || null,
    openSpans: fb.spans || undefined,
  });
  // US-028 tech notes item 3: incremented per castSectors call so planeIds
  // from different structures cast in the same frame never collide.
  if (fb.gbuf) fb.gbuf.structSeq++;
}

/**
 * Paints whatever is still open in `fb.spans` with sky, exactly like
 * `castScene`'s old `skyFallback: true` did at column-end (same
 * `fastShadeSky`/reference-shader write, same per-column azimuth from the
 * camera) - see the compatibility note in docs/architecture.md section 5.
 * Closes every column it touches. Writes `Infinity` into `fb.depth`.
 */
export function fillSky(fb, cam) {
  const rt = fb.rt;
  const cols = rt.cols, rows = rt.rows;
  const P = fb.palette;
  const spans = fb.spans;

  // Idempotent per frame (castSectors already primed these if it ran first
  // this frame) - safe/cheap to redo so a sky-only frame still shades right.
  primeAmbientLight(P);
  primeFastShadeFrame(ambientL);

  const hFovRad = HFOV_DEG * Math.PI / 180;
  const tanHalfHFov = Math.tan(hFovRad / 2);
  const yawRad = cam.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yawRad);
  const dirY = -Math.cos(yawRad);
  const planeX = -dirY * tanHalfHFov;
  const planeY = dirX * tanHalfHFov;
  const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
  const pitchRad = cam.pitchDeg * Math.PI / 180;
  const horizonRow = rows / 2 + Math.tan(pitchRad) * planeDistY;

  const ctx = {
    P, U: P.util, rows, horizonRow, planeDistY,
    depthBuffer: fb.depth, useReferenceShader: false,
  };

  for (let x = 0; x < cols; x++) {
    const open = spans ? spans.isOpen(x) : true;
    if (!open) continue;
    const top = spans ? spans.top[x] : 0;
    const bottom = spans ? spans.bottom[x] : rows - 1;

    const cameraX = (2 * (x + 0.5)) / cols - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;
    const azimuthDeg = compassAzimuthDeg(rayDirX, rayDirY);

    for (let row = top; row <= bottom; row++) {
      // US-040 step 5 (architecture.md 15.2 item 5): `spans` closes a whole
      // COLUMN at a time, but `castModels` can write a finite depth into a
      // single cell inside a column that is still "open" (a voxel instance
      // standing in an otherwise-open span, e.g. over terrain that hasn't
      // resolved this column yet) - skip that cell here instead of painting
      // sky over it. Sky itself always leaves depth at Infinity (never
      // finite), so this never skips a cell fillSky itself already painted.
      if (ctx.depthBuffer && ctx.depthBuffer.depth[row * cols + x] < Infinity) continue;
      const elevDeg = elevAtRow(ctx, row);
      shadeSkyAndWrite(rt, x, row, ctx, azimuthDeg, elevDeg, 'fillsky');
    }
    if (spans) spans.close(x);
  }
}
