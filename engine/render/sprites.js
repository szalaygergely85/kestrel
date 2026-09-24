// US-030c: billboard sprites - the JS reference/fallback (`drawSprites`) and
// the per-frame sprite list (`SpritePool`) both the JS pass and the GPU
// pass (`gpu/spritesPass.js`) consume. docs/architecture.md 14.2 item 4,
// design/README.md section 4 (sprite format, scale rule, `lods.half` below
// 0.75, never above 3x, emissive ignores light and fog).
//
// Data flow per frame (no allocation - architecture.md 9):
//   pool.collect(world)                 entities with `components.sprite` -> raw list (cached by renderVersion)
//   pool.project(cam, rt, light)        raw list -> `pool.spr` (Float32Array, 4 RGBA32F texels per sprite)
//   drawSprites(fb, pool)  (CPU path)   or the GPU sprite pass reads `pool.spr` + the atlas
//
// SPR texel layout per sprite s (row s of a 5 x MAX_SPRITES RGBA32F texture):
//   T0 (x0, y0, w, h)          screen rect in cells (integers as floats; x0/y0 may be negative / off-screen)
//   T1 (invScale, depth, fogF, visible)   invScale = fround(1/scale); depth = perpendicular camera distance
//   T2 (atlasX, atlasY, srcW, srcH)       the frame's atlas rect (cells)
//   T3 (mulR, mulG, mulB, 0)              lit colour multiplier = shadeSprite's (1 + (hue-1)*tint) * gain
//   T4 (fogR, fogG, fogB, 0)              US-016 (architecture.md 14.4 item 14, D-017 review): the colour this
//                                         sprite fogs TOWARD, resolved once per sprite in `project()` - interior
//                                         fogModel: the single `fog.interior` colour (unchanged); 'far' fogModel:
//                                         `mix(fog.far.color, fog.far.colorFar, fogFactor(depth,'far'))`, the same
//                                         distance gradient `shadeTerrainFar` uses (not the flat approximation the
//                                         14.4 item 7 note flagged); a horizon entry: its own fixed `fogColor` key.
//                                         Replaces the single `uFogColor` uniform both paths used before.
// Sampling rule (README 4): screen cell (i, j) of the rect -> sprite cell
// (floor(i*invScale), floor(j*invScale)). Both paths do the SAME f32
// multiply (JS: Math.fround of an exact f64 product; an integer times an f32
// is exact in f64, so the fround is the one rounding - identical to the
// GPU's correctly-rounded f32 mul), so glyph picks can never diverge at a
// scale boundary.
//
// Animation state is `components.sprite` (10.1): `model`, `anim`, `frame`;
// `frame` is read as-is (static until US-011's `stepAnimations`).
//
// US-016 D-011 addendum (architecture.md 14.4 item 13): `world.horizon[]`
// entries (Ferrum's lights) are appended to the SAME pool/texture as
// ordinary entity sprites at the end of `project()` (`projectHorizon`),
// placed by angle instead of world xyz, at the fixed `HORIZON_DEPTH` -
// farther than any real depth (terrain caps at 1500 m, structures closer),
// so the existing `sDepth < depth[i]` test alone keeps them off every
// terrain/structure cell and only ever draws them where the depth buffer is
// still +Inf (sky). One shared sprite pass/shader, no separate draw path.
import { HFOV_DEG } from './sectorCaster.js';
import { lightAt } from './lighting.js';

export const MAX_SPRITES = 64;
export const SPR_TEXELS = 5;
export const SPR_STRIDE = SPR_TEXELS * 4; // floats per sprite
export const HORIZON_DEPTH = 1e6; // architecture.md 14.4 item 13: farther than any finite depth (terrain <= 1500 m)
const MIN_DEPTH = 0.1;
const DEG2RAD = Math.PI / 180;
const LOD_HALF_BELOW = 0.75;

// Camera basis (same formulas as sectorCaster.js's castScene / fillSky -
// one source of truth for the projection; recomputed once per project()).
function camBasis(cam, rt, out) {
  const cols = rt.cols, rows = rt.rows;
  const tanHalfHFov = Math.tan(HFOV_DEG * Math.PI / 360);
  const yawRad = cam.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
  const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
  const horizonRow = rows / 2 + Math.tan(cam.pitchDeg * Math.PI / 180) * planeDistY;
  out.dirX = dirX; out.dirY = dirY;
  out.rightX = -dirY; out.rightY = dirX; // screen-right, compass-clockwise from dir (castScene's plane / tanHalfHFov)
  out.tanHalfHFov = tanHalfHFov; out.planeDistY = planeDistY; out.horizonRow = horizonRow;
  out.cols = cols; out.rows = rows; out.yawDeg = cam.yawDeg;
  return out;
}

const _horizonWarned = new Set(); // model-not-found is a content bug, not a per-frame condition - warn at most once per model key

/**
 * US-016 D-011 addendum (architecture.md 14.4 item 13): places one
 * `world.horizon[]` entry into `spr` at texel offset `o`, mirroring the
 * per-entity placement in `project()` above but driven by angle instead of
 * world xyz. Returns the atlas frame base (write into `frameOf`), or -1 when
 * the entry is off-screen / behind the camera / has no usable animation (do
 * not write a sprite row this frame).
 *   col  = cols/2 + focalCols * tan(bearing - yaw)          (skip if |bearing - yaw| >= 90)
 *   row  = horizonRow - planeDistY * tan(elevDeg)            (bottom edge of the band)
 *   rowsOnScreen = planeDistY * (tan(elev + hDeg) - tan(elev))
 *   scale = rowsOnScreen / lod.size.h                        (same half-tier rule as an ordinary sprite: < 0.75 -> lods.half)
 * @param {Object} h world.horizon[i] (bearingDeg, elevDeg, angular:{wDeg,hDeg}, model, fog, fogColor)
 * @param {ReturnType<import('./gpu/spritesAtlas.js').buildSpriteAtlas>} atlas
 * @param {{cols:number, rows:number, tanHalfHFov:number, planeDistY:number, horizonRow:number, yawDeg:number}} cb
 * @param {Object} P palette (assets.palette)
 * @param {number} unlitGain precomputed `shadeSprite` gain at b = 1 (identical for every horizon entry this frame)
 * @param {Float32Array} spr the pool's SPR array (written in place)
 * @param {number} o texel offset (`n * SPR_STRIDE`)
 * @returns {number} atlas frame base, or -1 (nothing written)
 */
function projectHorizon(h, atlas, cb, P, unlitGain, spr, o) {
  const m = atlas.models.get(h.model);
  if (!m) {
    if (!_horizonWarned.has(h.model)) { _horizonWarned.add(h.model); console.warn(`SpritePool: unknown horizon model "${h.model}"`); }
    return -1;
  }
  let diff = (h.bearingDeg - cb.yawDeg) % 360;
  if (diff > 180) diff -= 360; else if (diff < -180) diff += 360;
  if (Math.abs(diff) >= 90) return -1; // behind the camera - never wraps onto screen at this HFOV
  const focalCols = (cb.cols / 2) / cb.tanHalfHFov;
  const col = cb.cols / 2 + focalCols * Math.tan(diff * DEG2RAD);
  const elevRad = h.elevDeg * DEG2RAD;
  const row = cb.horizonRow - cb.planeDistY * Math.tan(elevRad);
  const rowsOnScreen = cb.planeDistY * (Math.tan((h.elevDeg + h.angular.hDeg) * DEG2RAD) - Math.tan(elevRad));
  if (!(rowsOnScreen > 0)) return -1;

  let lod = m.full;
  let scale = rowsOnScreen / lod.size.h;
  if (scale < LOD_HALF_BELOW && m.half) { lod = m.half; scale = rowsOnScreen / lod.size.h; }
  const anim = lod.anims.get('idle');
  if (!anim || anim.count === 0) {
    if (!_horizonWarned.has(h.model + ':anim')) { _horizonWarned.add(h.model + ':anim'); console.warn(`SpritePool: horizon model "${h.model}" has no "idle" animation`); }
    return -1;
  }
  const fr = atlas.frames[anim.base];

  const w = Math.ceil(lod.size.w * scale), hgt = Math.ceil(lod.size.h * scale);
  const x0 = Math.floor(col - (lod.anchor.x + 0.5) * scale + 0.5);
  const y0 = Math.floor(row - (lod.anchor.y + 1) * scale + 0.5);
  if (x0 >= cb.cols || y0 >= cb.rows || x0 + w <= 0 || y0 + hgt <= 0) return -1;

  const fogF = typeof h.fog === 'number' ? h.fog : 0;
  const visible = unlitGain * (1 - fogF) >= P.shading.cutoff ? 1 : 0;
  const c = (h.fogColor && P.rgb[h.fogColor]) || P.rgb[P.fog.interior.color];

  spr[o] = x0; spr[o + 1] = y0; spr[o + 2] = w; spr[o + 3] = hgt;
  spr[o + 4] = 1 / scale; spr[o + 5] = HORIZON_DEPTH; spr[o + 6] = fogF; spr[o + 7] = visible;
  spr[o + 8] = fr.x; spr[o + 9] = fr.y; spr[o + 10] = fr.w; spr[o + 11] = fr.h;
  spr[o + 12] = unlitGain; spr[o + 13] = unlitGain; spr[o + 14] = unlitGain; spr[o + 15] = 0;
  spr[o + 16] = c[0]; spr[o + 17] = c[1]; spr[o + 18] = c[2]; spr[o + 19] = 0;
  return anim.base;
}

export class SpritePool {
  /**
   * @param {ReturnType<import('./gpu/spritesAtlas.js').buildSpriteAtlas>} atlas
   * @param {Object} palette - `assets.palette` (shading constants, fog, util.shadeSprite/fogFactor)
   */
  constructor(atlas, palette) {
    this.atlas = atlas;
    this.palette = palette;
    this.count = 0;             // projected sprites this frame (rows 0..count-1 of `spr` are valid)
    this.rawCount = 0;
    this.spr = new Float32Array(MAX_SPRITES * SPR_STRIDE);
    this.frameOf = new Int32Array(MAX_SPRITES);   // atlas frame index per projected sprite
    // raw list (before projection)
    this._model = new Array(MAX_SPRITES).fill(null);
    this._anim = new Array(MAX_SPRITES).fill('');
    this._frame = new Int32Array(MAX_SPRITES);
    this._pos = new Float64Array(MAX_SPRITES * 3);
    // US-016 (architecture.md 14.4 item 7): optional per-raw-sprite
    // billboard fields (`components.billboard` - unlit/fogModel/fogMax/
    // minCells/detailRows), null for an ordinary lit prop/entity sprite.
    this._billboard = new Array(MAX_SPRITES).fill(null);
    // entity cache (rebuilt only when world.renderVersion changes)
    this._ents = [];
    this._entVersion = -1;
    this._entWorld = null;
    this._warned = new Set();
    this._cb = { dirX: 0, dirY: 0, rightX: 0, rightY: 0, tanHalfHFov: 0, planeDistY: 0, horizonRow: 0, cols: 0, rows: 0 };
    this.dropped = 0; // raw sprites beyond MAX_SPRITES this frame
  }

  reset() { this.rawCount = 0; this.count = 0; this.dropped = 0; }

  /**
   * Adds one raw sprite (model key, animation name, frame index, world
   * anchor/feet point). `billboard`: optional `{unlit, fogModel, fogMax,
   * minCells:{w,h}, detailRows}` (architecture.md 14.4 item 7) - null for an
   * ordinary lit sprite.
   */
  push(modelKey, anim, frame, x, y, z, billboard = null) {
    const m = this.atlas.models.get(modelKey);
    if (!m) { this._warnOnce(`SpritePool: unknown billboard model "${modelKey}"`); return; }
    if (this.rawCount >= MAX_SPRITES) { this.dropped++; return; }
    const i = this.rawCount++;
    this._model[i] = m; this._anim[i] = anim; this._frame[i] = frame | 0;
    this._pos[i * 3] = x; this._pos[i * 3 + 1] = y; this._pos[i * 3 + 2] = z;
    this._billboard[i] = billboard;
  }

  /**
   * Fills the raw list from every entity with a `components.sprite`. The
   * entity ref array is rebuilt only when `world.renderVersion` changes
   * (spawn/remove/play bump it); transforms are read live every frame.
   */
  collect(world) {
    this.reset();
    if (!world) return;
    if (world !== this._entWorld || world.renderVersion !== this._entVersion) {
      this._ents.length = 0;
      // Public, allocation-free iterator (ARCH CHANGES, US-030c) instead of
      // reading World's private `_entities` map directly.
      world.forEachEntity((e) => { if (e.components && e.components.sprite) this._ents.push(e); });
      this._entVersion = world.renderVersion;
      this._entWorld = world;
    }
    const ents = this._ents;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i], s = e.components.sprite, t = e.transform;
      this.push(s.model, s.anim, s.frame || 0, t.x, t.y, t.z, e.components.billboard || null);
    }
  }

  /**
   * Projects the raw list into `spr` (see the layout in the module doc).
   * `light`: either a flat `[r, g, b]` (uniform - legacy/tests, `world` is
   * ignored) or a `LightSet` (US-011, 7.5 item 4: per-sprite `lightAt` at
   * `x, y, z + 0.5*world.h`, normal `(0,0,1)`, `nf = 1` - README 4 allows
   * skipping the per-cell normal factor everywhere), in which case `world`
   * is required (`lightAt`'s vis-grid/sun-shadow sampling).
   */
  project(cam, rt, light, world) {
    const cb = camBasis(cam, rt, this._cb);
    const P = this.palette, S = P.shading, spr = this.spr, frames = this.atlas.frames;
    const perSprite = !!(light && typeof light.count === 'number' && light.pos);
    // Uniform path (legacy `[r,g,b]` light): the per-sprite part of
    // `P.util.shadeSprite` with nf = 1 computed once, same as before US-011.
    let uMulR = 1, uMulG = 1, uMulB = 1, uB = 1;
    if (!perSprite) {
      const Lm = Math.max(light[0], light[1], light[2]);
      uB = Lm;
      const hr = Lm > 1e-6 ? light[0] / Lm : 1, hg = Lm > 1e-6 ? light[1] / Lm : 1, hb = Lm > 1e-6 ? light[2] / Lm : 1;
      const bc = uB < 0 ? 0 : uB;
      let gain = S.fgMin + (1 - S.fgMin) * Math.pow(bc > 1 ? 1 : bc, S.fgGamma);
      if (bc > 1) gain = Math.min(S.fgMaxGain, gain + (bc - 1) * 0.5);
      const k = S.tint;
      uMulR = (1 + (hr - 1) * k) * gain; uMulG = (1 + (hg - 1) * k) * gain; uMulB = (1 + (hb - 1) * k) * gain;
    }

    let n = 0;
    for (let i = 0; i < this.rawCount; i++) {
      const m = this._model[i];
      const px = this._pos[i * 3], py = this._pos[i * 3 + 1], pz = this._pos[i * 3 + 2];
      const relX = px - cam.x, relY = py - cam.y;
      const depth = relX * cb.dirX + relY * cb.dirY;
      if (!(depth > MIN_DEPTH)) continue;
      // BUG-OWN-002: on-screen rows = world.h * planeDistY / depth for EVERY
      // tier (the prop tracks the world). No upscale cap: a capped billboard
      // is anchored at its feet, so it froze in size and sank toward the
      // floor as you walked closer (and was culled below the screen). The
      // half tier's scale comes from its own size.h (lever 3x5 -> 3x3 is not
      // an exact half; `scale *= 2` made it jump bigger when moving away).
      const rowsOnScreen = m.world.h * cb.planeDistY / depth;
      let lod = m.full;
      let scale = rowsOnScreen / lod.size.h;
      if (scale < LOD_HALF_BELOW && m.half) { lod = m.half; scale = rowsOnScreen / lod.size.h; }
      // US-016 (architecture.md 14.4 item 7): a billboard entity with a
      // `min` LOD (far_tower.js, ferrum_lights.js) picks it by PROJECTED
      // ROWS instead - `rowsOnScreen < detailRows` -> `lods.min`, independent
      // of the `half` pick above (a model may have both/either/neither).
      const bb = this._billboard[i];
      if (bb && bb.detailRows > 0 && m.min && rowsOnScreen < bb.detailRows) {
        lod = m.min; scale = rowsOnScreen / lod.size.h;
      }
      const anim = lod.anims.get(this._anim[i]);
      if (!anim || anim.count === 0) { this._warnOnce(`SpritePool: model has no animation "${this._anim[i]}"`); continue; }
      const fr = frames[anim.base + (((this._frame[i] % anim.count) + anim.count) % anim.count)];

      const lateral = relX * cb.rightX + relY * cb.rightY;
      const colCenter = (lateral / (depth * cb.tanHalfHFov) + 1) * cb.cols / 2;
      const feetRow = cb.horizonRow - ((pz - cam.z) / depth) * cb.planeDistY;
      let x0 = Math.floor(colCenter - (lod.anchor.x + 0.5) * scale + 0.5);
      let y0 = Math.floor(feetRow - (lod.anchor.y + 1) * scale + 0.5);
      let w = Math.ceil(lod.size.w * scale), h = Math.ceil(lod.size.h * scale);
      // US-016 (architecture.md 14.4 item 7): `minCells` clamp, AFTER the LOD
      // pick above - never smaller than this many cells on screen. Grows
      // outward from the centre column and upward from the feet row (the
      // anchor stays visually correct: a billboard's feet/bottom never
      // moves).
      if (bb && bb.minCells) {
        if (w < bb.minCells.w) { x0 -= Math.floor((bb.minCells.w - w) / 2); w = bb.minCells.w; }
        if (h < bb.minCells.h) { y0 -= (bb.minCells.h - h); h = bb.minCells.h; }
      }
      if (x0 >= cb.cols || y0 >= cb.rows || x0 + w <= 0 || y0 + h <= 0) continue;

      let mulR = uMulR, mulG = uMulG, mulB = uMulB, b = uB;
      // US-016 (architecture.md 14.4 item 7): `unlit` - light = 1, no N.L
      // (skips `lightAt` even on the per-sprite `LightSet` path). Still
      // shaded through the ordinary gain curve at b = 1 (not a flat
      // multiplier of 1), so it matches how every other "fully lit" surface
      // in this engine looks.
      if (bb && bb.unlit) {
        b = 1;
        const gain = S.fgMin + (1 - S.fgMin) * Math.pow(1, S.fgGamma);
        mulR = gain; mulG = gain; mulB = gain;
      } else if (perSprite) {
        lightAt(light, world, px, py, pz + 0.5 * m.world.h, 0, 0, 1, sprLightScratch);
        const Lm = Math.max(sprLightScratch[0], sprLightScratch[1], sprLightScratch[2]);
        b = Lm;
        const hr = Lm > 1e-6 ? sprLightScratch[0] / Lm : 1, hg = Lm > 1e-6 ? sprLightScratch[1] / Lm : 1, hb = Lm > 1e-6 ? sprLightScratch[2] / Lm : 1;
        const bc = b < 0 ? 0 : b;
        let gain = S.fgMin + (1 - S.fgMin) * Math.pow(bc > 1 ? 1 : bc, S.fgGamma);
        if (bc > 1) gain = Math.min(S.fgMaxGain, gain + (bc - 1) * 0.5);
        const k = S.tint;
        mulR = (1 + (hr - 1) * k) * gain; mulG = (1 + (hg - 1) * k) * gain; mulB = (1 + (hb - 1) * k) * gain;
      }

      // US-016 (architecture.md 14.4 item 7): `fogModel`/`fogMax` - a
      // billboard entity fogs by the named model ('interior' default, 'far'
      // = `overworld_far`'s far-view fog curve) instead of always the
      // interior curve, capped at `fogMax` (1 = no cap).
      const isFar = !!(bb && bb.fogModel === 'far');
      const f0 = P.util.fogFactor(depth, isFar ? 'far' : undefined);
      const f = bb && typeof bb.fogMax === 'number' ? Math.min(f0, bb.fogMax) : f0;
      const visible = b * (1 - f) >= S.cutoff ? 1 : 0;
      // US-016 (architecture.md 14.4 item 14, D-017 review): per-sprite fog
      // colour (T4), replacing the single `uFogColor`/`P.fog.interior`
      // approximation - a 'far' billboard (the signal tower) fogs toward the
      // SAME `mix(nearRGB, farRGB, f0)` gradient `shadeTerrainFar` paints the
      // terrain behind it with, at the raw (pre-`fogMax`-cap) fraction `f0`
      // (the gradient is a function of distance, not of how much the cap
      // then lets through).
      let fogR, fogG, fogB;
      if (isFar) {
        const near = P.rgb[P.fog.far.color], far = P.rgb[P.fog.far.colorFar];
        fogR = near[0] + (far[0] - near[0]) * f0;
        fogG = near[1] + (far[1] - near[1]) * f0;
        fogB = near[2] + (far[2] - near[2]) * f0;
      } else {
        const c = P.rgb[P.fog.interior.color];
        fogR = c[0]; fogG = c[1]; fogB = c[2];
      }
      const o = n * SPR_STRIDE;
      spr[o] = x0; spr[o + 1] = y0; spr[o + 2] = w; spr[o + 3] = h;
      spr[o + 4] = 1 / scale; spr[o + 5] = depth; spr[o + 6] = f; spr[o + 7] = visible;
      spr[o + 8] = fr.x; spr[o + 9] = fr.y; spr[o + 10] = fr.w; spr[o + 11] = fr.h;
      spr[o + 12] = mulR; spr[o + 13] = mulG; spr[o + 14] = mulB; spr[o + 15] = 0;
      spr[o + 16] = fogR; spr[o + 17] = fogG; spr[o + 18] = fogB; spr[o + 19] = 0;
      this.frameOf[n] = anim.base;
      n++;
    }

    // US-016 D-011 addendum (architecture.md 14.4 item 13): horizon
    // billboards (`world.horizon[]`) appended after every entity sprite,
    // same pool/texture, unlit, fixed per-entry fog, depth `HORIZON_DEPTH`
    // (see `projectHorizon` below for the placement maths).
    if (world && world.horizon && world.horizon.length) {
      const unlitGain = S.fgMin + (1 - S.fgMin) * Math.pow(1, S.fgGamma);
      const list = world.horizon;
      for (let i = 0; i < list.length; i++) {
        if (n >= MAX_SPRITES) { this.dropped++; continue; }
        const frameBase = projectHorizon(list[i], this.atlas, cb, P, unlitGain, spr, n * SPR_STRIDE);
        if (frameBase !== -1) {
          this.frameOf[n] = frameBase;
          n++;
        }
      }
    }

    this.count = n;
    this._light = light;
  }

  _warnOnce(msg) {
    if (this._warned.has(msg)) return;
    this._warned.add(msg);
    console.warn(msg);
  }
}

// Reused scratch (no per-cell/per-sprite allocation - architecture.md 9).
const sprLightScratch = new Float64Array(3); // project()'s per-sprite lightAt() output
let spriteDepth = null; // Float32Array(cols*rows): nearest sprite depth per cell this frame (lazily sized)

function toByte(v) { v = Math.floor(v + 0.5); return v < 0 ? 0 : v > 255 ? 255 : v; }

/**
 * Test/parity helper: the per-cell nearest-sprite depth of the last
 * `drawSprites` call (finite = a sprite texel was drawn there). Null before
 * the first call.
 */
export function lastSpriteDepth() { return spriteDepth; }

/**
 * JS reference / CPU fallback (14.2 item 4, "`drawSprites` (static frame,
 * depth test on `fb.depth`, `fogF`, emissive)"). Runs after the surface
 * passes: per sprite rect cell, depth-tested against `fb.depth.depth`
 * (nearest opaque sprite texel wins, strict `<` so the first-listed sprite
 * wins a tie, exactly like the GLSL loop), colour from the designer's
 * `P.util.shadeSprite` (the oracle - the GPU reproduces its per-sprite
 * factors from `spr` T3), glyph from the atlas, bg left as the wall behind.
 * Colour comes straight from the per-sprite T3 multiplier (`spr[o+12..14]`,
 * baked by `project()` - uniform or per-sprite `lightAt`, README 4/
 * architecture.md 7.5 item 4) applied to the atlas palette colour
 * (`pool.atlas.pal`, the SAME table the GPU's `uPal` texture holds), fog-
 * blended the same way `sprites.frag.js` does: `rgb = base*mul; if fogF>0:
 * rgb += (fogColor-rgb)*fogF`. Emissive cells skip both. This is "parity by
 * construction" (7.5 item 6): both paths read the identical `spr`/atlas
 * data, neither recomputes shading from a separate light input.
 * @param {{rt:Object, depth:{depth:Float32Array}, palette:Object}} fb
 * @param {SpritePool} pool - after `project()`
 */
export function drawSprites(fb, pool) {
  const rt = fb.rt;
  const cells = rt.cells || rt; // RenderTargetGL/Canvas2D expose `.cells`; a bare CellBuffer (tests) is its own
  const cols = cells.cols, rows = cells.rows, n = cols * rows;
  if (!spriteDepth || spriteDepth.length !== n) spriteDepth = new Float32Array(n);
  spriteDepth.fill(Infinity);
  const depth = fb.depth.depth;
  const atlas = pool.atlas, A = atlas.data, aw = atlas.width, pal = atlas.pal;
  const spr = pool.spr;
  const bg = cells.bg;

  for (let s = 0; s < pool.count; s++) {
    const o = s * SPR_STRIDE;
    const x0 = spr[o], y0 = spr[o + 1], w = spr[o + 2], h = spr[o + 3];
    const invScale = spr[o + 4], sDepth = spr[o + 5], fogF = spr[o + 6], visible = spr[o + 7] !== 0;
    const ax = spr[o + 8], ay = spr[o + 9], srcW = spr[o + 10], srcH = spr[o + 11];
    const mulR = spr[o + 12], mulG = spr[o + 13], mulB = spr[o + 14];
    // US-016 (architecture.md 14.4 item 14): per-sprite fog colour (T4), not
    // the single `P.fog.interior` colour every sprite used to fog toward.
    const fogR = spr[o + 16], fogG = spr[o + 17], fogB = spr[o + 18];
    const cx0 = Math.max(0, x0), cx1 = Math.min(cols, x0 + w);
    const cy0 = Math.max(0, y0), cy1 = Math.min(rows, y0 + h);
    for (let y = cy0; y < cy1; y++) {
      const sy = Math.floor(Math.fround((y - y0) * invScale));
      if (sy >= srcH) continue;
      for (let x = cx0; x < cx1; x++) {
        const i = y * cols + x;
        if (!(sDepth < depth[i]) || !(sDepth < spriteDepth[i])) continue;
        const sx = Math.floor(Math.fround((x - x0) * invScale));
        if (sx >= srcW) continue;
        const t = ((ay + sy) * aw + (ax + sx)) * 4;
        if (A[t + 3] === 0) continue; // transparent
        const emissive = (A[t + 2] & 1) !== 0;
        if (!emissive && !visible) continue;
        const pi = A[t + 1] * 4;
        let r, g, bl;
        if (emissive) {
          r = pal[pi]; g = pal[pi + 1]; bl = pal[pi + 2]; // full palette colour, ignores light (never N.L)
          // US-016 D-011 addendum (architecture.md 14.4 item 12): per-key
          // emissive fog cap, decoded from the atlas alpha (`a = 1 +
          // round(fogMax*254)`; `a = 1` = no fogMax = 0 cap = unfogged,
          // today's behaviour). `fe = min(sprite fogF, key cap)`.
          const fe = Math.min(fogF, (A[t + 3] - 1) / 254);
          if (fe > 0) { r += (fogR - r) * fe; g += (fogG - g) * fe; bl += (fogB - bl) * fe; }
        } else {
          r = pal[pi] * mulR; g = pal[pi + 1] * mulG; bl = pal[pi + 2] * mulB;
          if (fogF > 0) { r += (fogR - r) * fogF; g += (fogG - g) * fogF; bl += (fogB - bl) * fogF; }
        }
        const bi = i * 4;
        cells.setCellRGB(x, y, A[t], toByte(r), toByte(g), toByte(bl), bg[bi], bg[bi + 1], bg[bi + 2]);
        spriteDepth[i] = sDepth;
      }
    }
  }
}
