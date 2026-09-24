// engine/render/lighting.js (US-006 tech notes, docs/architecture.md 14.3).
// `LightSet` owns all light state (ambient + point lights + a sun stub -
// US-007 turns the sun on; here it always stays `off`), `buildLightSet`
// reads `level.def.lights` per placed structure (US-002 rules: hue from
// `P.hue[color]`, energy from `intensity`, values from `P.lights[preset]` -
// never hard-coded), `lightAt` is the single point evaluator shared by
// `lightSurfaces` (CPU/JS reference, this file) and the GLSL `light` pass
// (`gpu/glsl/light.frag.js`, same formula). Pure/allocation-free after
// construction (architecture.md 9) - every per-frame method writes into
// pre-allocated typed arrays.
//
// Deviation (flagged for architect review, not silent): `computeVisGrid`
// below keys each light's visibility box on its OWN unjittered cell +-
// `ceil(radius)` (a small local box, `MAX_VIS_DIM` per side), not the
// containing structure's full footprint as 14.3 item 5 describes - simpler,
// Node-testable without a `packed` atlas, and identical at the sample point
// (`vis = 1` outside the box, matching the "outside every footprint" rule).
// The GLSL `light` pass (light.frag.js) uses the exact same box convention
// for parity. Sun (US-007) is intentionally NOT implemented here -
// `LightSet.sun.on` stays `false`, `setSun`/`sunVisible` are present only
// as API-shape stubs so US-007 does not need to change this file's shape.

import { HFOV_DEG } from './sectorCaster.js';

export const MAX_LIGHTS = 16;
// PO REJECT item 1: CPU fallback (`?gpu=0`) evaluates at most this many
// nearest `on` lights per frame (tech notes item 7, "reduced light count
// (max 4, nearest first)"). GPU/GLSL and `?gpucompare=1` are unaffected -
// they always use the full list.
export const CPU_LIGHT_CAP = 4;
// Odd, so the light's own cell sits at the centre. Radius is clamped to
// floor((MAX_VIS_DIM-1)/2) meters for visibility purposes (a light's true
// falloff radius can be larger - only occlusion sampling is boxed).
export const MAX_VIS_DIM = 33;
export const MAX_VIS_CELLS = MAX_VIS_DIM * MAX_VIS_DIM;
const MAX_VIS_RADIUS = (MAX_VIS_DIM - 1) >> 1;
// Module-wide LVIS version sequence (architect re-review 1): versions must be
// unique across ALL LightSets, not per slot - a pipeline's `_lvisUploaded[i]`
// cache would otherwise match a NEW LightSet's slot i (level reload, the
// two compare worlds) and skip its upload. Starts at 1; 0 = never computed.
let visVersionSeq = 0;

// Falloff (US-002 rule, design/palette.js `util.falloff`): smooth to exactly
// 0 at `r`, no hard ring edge. Engine copy (no `Math.pow`) so `lightAt` never
// needs a palette reference - the GLSL twin is `falloffFast` (common.js).
export function falloff(d, r) {
  if (d >= r) return 0;
  const x = 1 - (d / r) * (d / r);
  return x * x;
}

// Integer hash -> [0,1), same mixing as detailShade.js's `hashFast` (US-028)
// so the flicker sequence has the same statistical quality as everything
// else in this codebase that needs one. `h01(a)` == `h01(a,0,0)`.
export function h01(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep01(t) {
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

// Small FNV-ish string hash -> int32 seed (buildLightSet only - not a
// per-frame call).
function seedFor(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}

export class LightSet {
  constructor() {
    this.ambient = new Float32Array(3);
    // US-007 stub - always off in US-006 scope.
    this.sun = { on: false, elevation: 0, azimuth: 0, dir: new Float32Array(3), col: new Float32Array(3) };

    this.count = 0; // active (alive) lights, compacted into [0, count)
    this.pos = new Float32Array(4 * MAX_LIGHTS);   // x, y, z (jittered), radius     -> uLightPos
    this.col = new Float32Array(4 * MAX_LIGHTS);   // hue*intensity*flicker, visSlot -> uLightCol
    this.vis = new Uint8Array(MAX_LIGHTS * MAX_VIS_CELLS); // LVIS atlas staging
    // Architect review 1 item 4: a monotonic per-slot version, bumped only
    // when `computeVisGrid` actually recomputes the slot. Each pipeline
    // compares this against its OWN last-uploaded version (reset to -1 when
    // its `texLVis` is (re)created), not a one-frame `visDirty` flag - a
    // pipeline that missed the recompute frame (context restore, a second
    // compare pipeline, one not ready yet) still uploads on its next frame.
    this.visVersion = new Int32Array(MAX_LIGHTS);
    this.visOx = new Int32Array(MAX_LIGHTS);
    this.visOy = new Int32Array(MAX_LIGHTS);
    this.visW = new Int32Array(MAX_LIGHTS);
    this.visH = new Int32Array(MAX_LIGHTS);
    this._visKeyX = new Int32Array(MAX_LIGHTS).fill(0x7fffffff);
    this._visKeyY = new Int32Array(MAX_LIGHTS).fill(0x7fffffff);
    this._visStructVersion = new Int32Array(MAX_LIGHTS).fill(-1);
    // Architect review 1 item 5: the containing structure's OWN
    // `packed.version` (sector animations, e.g. the US-012 grate, change
    // `floorH/ceilH` without bumping `world.structVersion`) is part of the
    // recompute key too. -2 = "no containing structure" (distinct from a
    // real `packed.version`, which starts at 1).
    this._visPackedVersion = new Int32Array(MAX_LIGHTS).fill(-2);
    // Kept for callers/tools that still want a per-frame "did this slot just
    // change" flag (informational only - uploaders must key off `visVersion`).
    this.visDirty = new Int8Array(MAX_LIGHTS);

    this.on = new Uint8Array(MAX_LIGHTS);
    this.defX = new Float32Array(MAX_LIGHTS);
    this.defY = new Float32Array(MAX_LIGHTS);
    this.defZ = new Float32Array(MAX_LIGHTS);
    this.radius = new Float32Array(MAX_LIGHTS);
    this.baseHue = new Float32Array(3 * MAX_LIGHTS);
    this.baseIntensity = new Float32Array(MAX_LIGHTS);
    this.flickerHzMin = new Float32Array(MAX_LIGHTS);
    this.flickerHzMax = new Float32Array(MAX_LIGHTS);
    this.flickerAmount = new Float32Array(MAX_LIGHTS);
    this.flickerJitter = new Float32Array(MAX_LIGHTS);
    this.seed = new Int32Array(MAX_LIGHTS);
    this.key = new Array(MAX_LIGHTS).fill(null); // handle -> `${structId}.${lightId}` (debug/lookup only)
    // Architect review 1 item 6: entity id -> handle, owned by the LightSet
    // itself (not `entity._lightHandle`) - a serialized entity would
    // otherwise carry a stale slot index into a freshly built `LightSet`
    // after a world reload. Allocated once; per-frame `get`/`set` only.
    this.entityHandle = new Map();

    // PO REJECT item 1 (CPU fallback light cap): preallocated 4-nearest
    // scratch, filled by `selectCpuLights` - CPU (`?gpu=0`) path only, never
    // touched by the GPU/GLSL path or `?gpucompare=1` (both keep the full
    // list, up to `MAX_LIGHTS`, for parity). No per-frame allocation.
    this.cpuIdx = new Int32Array(CPU_LIGHT_CAP);
    this.cpuCount = 0;
    this._cpuDist = new Float32Array(CPU_LIGHT_CAP);
  }

  /**
   * def = { x, y, z (world m), hue:[r,g,b], intensity, radius,
   *   flicker:{hzMin,hzMax,amount,jitter}, seed, on, key? }. Returns the new
   * handle (0..MAX_LIGHTS-1), or -1 if the set is full (warns once).
   */
  add(def) {
    if (this.count >= MAX_LIGHTS) {
      console.warn('[LightSet] MAX_LIGHTS reached, dropping light', def.key || '');
      return -1;
    }
    const h = this.count++;
    this.on[h] = def.on === false ? 0 : 1;
    this.defX[h] = def.x; this.defY[h] = def.y; this.defZ[h] = def.z;
    this.radius[h] = def.radius;
    const hue = def.hue || [1, 1, 1];
    this.baseHue[h * 3] = hue[0]; this.baseHue[h * 3 + 1] = hue[1]; this.baseHue[h * 3 + 2] = hue[2];
    this.baseIntensity[h] = def.intensity || 0;
    const fl = def.flicker || {};
    this.flickerHzMin[h] = fl.hzMin || 0;
    this.flickerHzMax[h] = fl.hzMax || 0;
    this.flickerAmount[h] = fl.amount || 0;
    this.flickerJitter[h] = fl.jitter || 0;
    this.seed[h] = (def.seed | 0) || seedFor(def.key || String(h));
    this.key[h] = def.key || null;
    this._visKeyX[h] = 0x7fffffff; this._visKeyY[h] = 0x7fffffff; this._visStructVersion[h] = -1; this._visPackedVersion[h] = -2;
    // Seed pos/col immediately (radius/z at least) so a read before the
    // first `update()` call is well-formed (zero flicker).
    this.pos[h * 4] = def.x; this.pos[h * 4 + 1] = def.y; this.pos[h * 4 + 2] = def.z; this.pos[h * 4 + 3] = def.radius;
    this.col[h * 4] = hue[0] * this.baseIntensity[h]; this.col[h * 4 + 1] = hue[1] * this.baseIntensity[h];
    this.col[h * 4 + 2] = hue[2] * this.baseIntensity[h]; this.col[h * 4 + 3] = h;
    return h;
  }

  /** Moves a light's UNJITTERED (`def`) position - called every frame for an attached/carried light, before `update()`. */
  move(handle, x, y, z) {
    if (handle < 0 || handle >= this.count) return;
    this.defX[handle] = x; this.defY[handle] = y; this.defZ[handle] = z;
  }

  setOn(handle, on) {
    if (handle < 0 || handle >= this.count) return;
    this.on[handle] = on ? 1 : 0;
  }

  /**
   * Compacts the light at `handle` out of [0,count) by swapping the last
   * slot into its place (architecture.md 9: no holes to skip every frame).
   * NOTE: this can change OTHER lights' handles - safe for this game's
   * current usage (lights are added once at load/pickup time and never
   * removed; `setOn` is the toggle US-022's beacon needs).
   */
  remove(handle) {
    if (handle < 0 || handle >= this.count) return;
    const last = this.count - 1;
    if (handle !== last) {
      this.on[handle] = this.on[last];
      this.defX[handle] = this.defX[last]; this.defY[handle] = this.defY[last]; this.defZ[handle] = this.defZ[last];
      this.radius[handle] = this.radius[last];
      this.baseHue[handle * 3] = this.baseHue[last * 3]; this.baseHue[handle * 3 + 1] = this.baseHue[last * 3 + 1]; this.baseHue[handle * 3 + 2] = this.baseHue[last * 3 + 2];
      this.baseIntensity[handle] = this.baseIntensity[last];
      this.flickerHzMin[handle] = this.flickerHzMin[last]; this.flickerHzMax[handle] = this.flickerHzMax[last];
      this.flickerAmount[handle] = this.flickerAmount[last]; this.flickerJitter[handle] = this.flickerJitter[last];
      this.seed[handle] = this.seed[last];
      this.key[handle] = this.key[last];
      this.visVersion[handle] = this.visVersion[last];
      this._visKeyX[handle] = 0x7fffffff; this._visKeyY[handle] = 0x7fffffff; this._visStructVersion[handle] = -1; this._visPackedVersion[handle] = -2;
    }
    this.count = last;
  }

  /** The ONLY sun mutator (US-007). Stubbed: recomputes `dir`, but `sun.on` is never set true by US-006 code paths. */
  setSun({ elevation, azimuth, on }) {
    this.sun.elevation = elevation; this.sun.azimuth = azimuth; this.sun.on = !!on;
    const elRad = elevation * Math.PI / 180, azRad = azimuth * Math.PI / 180;
    this.sun.dir[0] = Math.sin(azRad) * Math.cos(elRad);
    this.sun.dir[1] = -Math.cos(azRad) * Math.cos(elRad);
    this.sun.dir[2] = Math.sin(elRad);
  }

  /**
   * Per-frame: flicker (deterministic, keyed on `timeSec`) + visibility grid
   * recompute for any light whose unjittered cell or `world.structVersion`
   * changed since last time. Call AFTER any `move()`s for this frame (entity
   * light sync - `engine/entities/attach.js`), so flicker jitters the
   * latest position. No allocation.
   */
  update(timeSec, world) {
    for (let i = 0; i < this.count; i++) {
      const seed = this.seed[i];
      const hzMin = this.flickerHzMin[i], hzMax = this.flickerHzMax[i];
      const amount = this.flickerAmount[i], jitter = this.flickerJitter[i];
      let v0 = 0, v1 = 0, v2 = 0;
      if (amount > 0 || jitter > 0) {
        const f = hzMin + (hzMax - hzMin) * h01(seed);
        const u = timeSec * f + 7.31 * h01(seed + 1);
        const k = Math.floor(u);
        const s = smoothstep01(u - k);
        v0 = (h01(k, seed, 0) + (h01(k + 1, seed, 0) - h01(k, seed, 0)) * s) * 2 - 1;
        v1 = (h01(k, seed, 1) + (h01(k + 1, seed, 1) - h01(k, seed, 1)) * s) * 2 - 1;
        v2 = (h01(k, seed, 2) + (h01(k + 1, seed, 2) - h01(k, seed, 2)) * s) * 2 - 1;
      }
      const intensity = this.baseIntensity[i] * (1 + amount * v0);
      const x = this.defX[i] + jitter * v1, y = this.defY[i] + jitter * v2, z = this.defZ[i];
      const o4 = i * 4;
      this.pos[o4] = x; this.pos[o4 + 1] = y; this.pos[o4 + 2] = z; this.pos[o4 + 3] = this.radius[i];
      this.col[o4] = this.baseHue[i * 3] * intensity;
      this.col[o4 + 1] = this.baseHue[i * 3 + 1] * intensity;
      this.col[o4 + 2] = this.baseHue[i * 3 + 2] * intensity;
      this.col[o4 + 3] = i;

      this.visDirty[i] = 0;
      // Off lights contribute zero on EVERY path: light.frag has no `on` test,
      // it reads `col` (architect re-review 1: tower's beacon, on:false).
      if (!this.on[i]) { this.col[o4] = 0; this.col[o4 + 1] = 0; this.col[o4 + 2] = 0; continue; }
      const cellX = Math.floor(this.defX[i]), cellY = Math.floor(this.defY[i]);
      const sv = world ? world.structVersion : 0;
      // Architect review 1 item 5: the containing structure's own
      // `packed.version` - a sector animation (the US-012 grate) changes
      // `floorH/ceilH` in place without bumping `world.structVersion`, so a
      // light sitting next to it must still see the recompute.
      const struct = world ? world.structureAt(this.defX[i], this.defY[i]) : null;
      const pv = struct ? struct.packed.version : -2;
      if (cellX !== this._visKeyX[i] || cellY !== this._visKeyY[i] || sv !== this._visStructVersion[i] || pv !== this._visPackedVersion[i]) {
        computeVisGrid(this, i, world);
        this._visKeyX[i] = cellX; this._visKeyY[i] = cellY; this._visStructVersion[i] = sv; this._visPackedVersion[i] = pv;
        this.visDirty[i] = 1;
        // Architect review 1 item 4: monotonic version, not a one-frame
        // flag - pipelines diff against their OWN last-uploaded version.
        this.visVersion[i] = visVersionSeq = (visVersionSeq + 1) | 0;
      }
    }
  }
}

/**
 * `level.def.lights` (MAP_FORMAT: `[{id, preset, x, y, z, on}]`, local to
 * the structure) per placed structure -> world-space `LightSet`. Ambient
 * from `P.lights.ambient`. Light values (hue/intensity/radius/flicker) come
 * from `P.lights[preset]`/`P.hue[color]` only - never hard-coded (US-006 AC).
 */
export function buildLightSet(world, palette) {
  const ls = new LightSet();
  const amb = palette.lights.ambient;
  const ambHue = palette.hue[amb.color];
  ls.ambient[0] = ambHue[0] * amb.intensity;
  ls.ambient[1] = ambHue[1] * amb.intensity;
  ls.ambient[2] = ambHue[2] * amb.intensity;

  for (const s of world.structures) {
    const def = s.level && s.level.def;
    const lightDefs = def && def.lights;
    if (!lightDefs) continue;
    for (const ld of lightDefs) {
      const preset = palette.lights[ld.preset];
      if (!preset) { console.warn(`[lighting] unknown light preset "${ld.preset}" (${s.id}.${ld.id})`); continue; }
      const hue = palette.hue[preset.color];
      ls.add({
        x: ld.x + s.origin.x, y: ld.y + s.origin.y, z: ld.z + s.origin.z,
        hue, intensity: preset.intensity, radius: preset.radius,
        flicker: preset.flicker || null,
        on: ld.on !== false,
        key: `${s.id}.${ld.id}`,
      });
    }
  }
  return ls;
}

/**
 * Adds/updates the carried light for an entity with `components.light`
 * (US-012 `lanternTake` sets it; US-006 AC "carried over from US-012
 * AC3/AC4"). `attachedLightPos` (engine/entities/attach.js) computes the
 * world position; this just owns the handle bookkeeping (one carried light
 * per entity, keyed by `e.id` in `lights.entityHandle` - architect review 1
 * item 6: NOT `entity._lightHandle`, which would leave a stale slot index on
 * a serialized entity after a freshly built `LightSet` reload).
 * `palette` resolves `light.preset` -> `{hue, intensity, radius, flicker}`
 * (same `P.lights[preset]`/`P.hue[color]` rule as `buildLightSet`).
 */
export function syncEntityLights(lights, world, palette, attachedLightPos, out) {
  world.forEachEntity((e) => {
    const light = e.components && e.components.light;
    if (!light) {
      const h = lights.entityHandle.get(e.id);
      if (h != null) lights.setOn(h, false);
      return;
    }
    const eyeFeel = e.components.body && e.components.body.feel;
    attachedLightPos(e, eyeFeel, out);
    const h = lights.entityHandle.get(e.id);
    if (h == null) {
      const preset = palette.lights[light.preset];
      if (!preset) { console.warn(`[lighting] unknown carried light preset "${light.preset}" (entity ${e.id})`); return; }
      const hue = palette.hue[preset.color];
      lights.entityHandle.set(e.id, lights.add({
        x: out[0], y: out[1], z: out[2],
        hue, intensity: preset.intensity, radius: preset.radius,
        flicker: preset.flicker || null, on: light.on !== false, key: `entity.${e.id}`,
      }));
    } else {
      lights.move(h, out[0], out[1], out[2]);
      lights.setOn(h, light.on !== false);
    }
  });
}

// Normal-by-face lookup (GBuffer.js FACE_N..FACE_D = 1..6).
const NX = [0, 0, 1, 0, -1, 0, 0];
const NY = [0, -1, 0, 1, 0, 0, 0];
const NZ = [0, 0, 0, 0, 0, 1, -1];

const evalScratch = new Float64Array(3);

/**
 * Shared per-point evaluator (surfaces here, sprites in a later story) -
 * `L = ambient + sum_i col_i * falloff(d,r) * max(0,N.L) * vis_i(P)`. `world`
 * is only used by `sampleVis` indirectly (the vis grid is already baked by
 * `update()` - this function never recomputes it, never allocates).
 *
 * `idxList`/`idxCount` (optional, PO REJECT item 1): when given, evaluates
 * only those light indices (the CPU fallback's 4-nearest list from
 * `selectCpuLights`) instead of `[0, lights.count)`. Omitted by every other
 * caller (GPU-parity `?gpucompare=1` path, the N.L/vis unit tests), so
 * behaviour there is unchanged.
 */
export function lightAt(lights, world, x, y, z, nx, ny, nz, out, idxList, idxCount) {
  out[0] = lights.ambient[0]; out[1] = lights.ambient[1]; out[2] = lights.ambient[2];
  const n = idxList ? idxCount : lights.count;
  for (let k = 0; k < n; k++) {
    const i = idxList ? idxList[k] : k;
    if (!lights.on[i]) continue;
    const o4 = i * 4;
    const lx = lights.pos[o4], ly = lights.pos[o4 + 1], lz = lights.pos[o4 + 2], r = lights.pos[o4 + 3];
    const dx = lx - x, dy = ly - y, dz = lz - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2);
    const fo = falloff(d, r);
    if (fo <= 0) continue;
    const ndotl = d > 1e-6 ? (nx * dx + ny * dy + nz * dz) / d : 0;
    if (ndotl <= 0) continue;
    // Architect review 1 item 1: sample the vis grid at `S = P + N*0.01`,
    // not `P` itself - a wall hit lies exactly on the cell boundary, so
    // `floor(P.x/y)` is a float coin flip between the solid cell and the
    // open one. Nudging along the surface normal always lands in the open
    // cell the surface actually faces (matches `light.frag.js`'s `sampleVis`).
    const vis = sampleVis(lights, i, x + nx * 0.01, y + ny * 0.01);
    if (vis <= 0) continue;
    const amt = fo * ndotl * vis;
    out[0] += lights.col[o4] * amt;
    out[1] += lights.col[o4 + 1] * amt;
    out[2] += lights.col[o4 + 2] * amt;
  }
  return out;
}

function sampleVis(lights, i, x, y) {
  const w = lights.visW[i], h = lights.visH[i];
  if (w <= 0 || h <= 0) return 1;
  const lx = Math.floor(x - lights.visOx[i]), ly = Math.floor(y - lights.visOy[i]);
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return 1; // outside the box -> unoccluded (14.3 item 5)
  return lights.vis[i * MAX_VIS_CELLS + ly * MAX_VIS_DIM + lx] / 255;
}

// cellBlocks: solid -> lightZ < floorH; non-solid -> lightZ < floorH ||
// (!ceilSky && lightZ > ceilH && lightZ <= topH) (14.3 item 5). No sector at
// (cx,cy) (outside every structure) does not block - open air/terrain.
function cellBlocks(world, cx, cy, lz) {
  const sec = world.sectorAt(cx + 0.5, cy + 0.5);
  if (!sec) return false;
  if (sec.solid) return lz < sec.floorH;
  if (lz < sec.floorH) return true;
  if (sec.ceilH === 'sky') return false;
  const topH = sec.topH === undefined ? sec.ceilH : (sec.topH === 'sky' ? Infinity : sec.topH);
  return lz > sec.ceilH && lz <= topH;
}

// 2D line-of-sight walk from the light's cell to (tx,ty)'s cell, cell by
// cell (a simple, robust DDA - occlusion grids are computed rarely, never
// per frame for a static light, so this need not be the fastest possible
// walk). Returns true if anything blocks along the way (including the
// target cell itself).
function segmentBlocked(world, x0, y0, x1, y1, lz) {
  const targetX = Math.floor(x1), targetY = Math.floor(y1);
  let mapX = Math.floor(x0), mapY = Math.floor(y0);
  if (mapX === targetX && mapY === targetY) return cellBlocks(world, targetX, targetY, lz);
  let dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  dx /= dist; dy /= dist;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0, stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const deltaDistX = dx === 0 ? Infinity : Math.abs(1 / dx), deltaDistY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let sideDistX = dx === 0 ? Infinity : (dx > 0 ? (mapX + 1 - x0) : (x0 - mapX)) * deltaDistX;
  let sideDistY = dy === 0 ? Infinity : (dy > 0 ? (mapY + 1 - y0) : (y0 - mapY)) * deltaDistY;
  for (let guard = 0; guard < 256; guard++) {
    if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; } else { sideDistY += deltaDistY; mapY += stepY; }
    if (cellBlocks(world, mapX, mapY, lz)) return true;
    if (mapX === targetX && mapY === targetY) return false;
  }
  return false; // safety cap - treat as unreached-but-not-blocked -> caller marks reached (bias to lit, matches sun's own MAX_SUN_STEPS bias)
}

/**
 * Recomputes light `slot`'s visibility box (14.3 item 5, boxed - see module
 * doc). `world` may be null (light not placed in any structure yet) -
 * everything defaults to `vis=1` (no box) in that case.
 */
export function computeVisGrid(lights, slot, world) {
  const lx = lights.defX[slot], ly = lights.defY[slot];
  const r = lights.radius[slot], lz = lights.defZ[slot];
  if (!world) { lights.visW[slot] = 0; lights.visH[slot] = 0; return; }
  const R = Math.min(MAX_VIS_RADIUS, Math.ceil(r));
  const cellX = Math.floor(lx), cellY = Math.floor(ly);
  const ox = cellX - R, oy = cellY - R;
  const w = 2 * R + 1, h = 2 * R + 1;
  lights.visOx[slot] = ox; lights.visOy[slot] = oy; lights.visW[slot] = w; lights.visH[slot] = h;
  const base = slot * MAX_VIS_CELLS;
  const vis = lights.vis;
  vis.fill(0, base, base + MAX_VIS_CELLS);

  const ownBlocked = cellBlocks(world, cellX, cellY, lz);
  if (ownBlocked) return; // light sitting in solid geometry - nothing reached (unit test item 8)

  const sx = cellX + 0.5, sy = cellY + 0.5;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const wx = ox + tx, wy = oy + ty;
      if (wx === cellX && wy === cellY) { vis[base + ty * MAX_VIS_DIM + tx] = 255; continue; }
      const blocked = segmentBlocked(world, sx, sy, wx + 0.5, wy + 0.5, lz);
      vis[base + ty * MAX_VIS_DIM + tx] = blocked ? 0 : 255;
    }
  }
}

/**
 * US-007 stub: full sun-shadow DDA is out of scope for US-006 (`sun.on`
 * always false here, so this is never called by this story's code paths).
 * Returns true (lit) so the API shape exists for US-007 to replace.
 */
export function sunVisible(world, x, y, z, dir) {
  return true;
}

/** Pure packer (testability - the render path reads `lights.pos`/`lights.col` directly, no copy needed). */
export function packLightUniforms(lights, outF32) {
  const n = lights.count;
  outF32.set(lights.pos.subarray(0, 4 * n), 0);
  outF32.set(lights.col.subarray(0, 4 * n), 4 * MAX_LIGHTS);
  return n;
}

/**
 * PO REJECT item 1: picks the `CPU_LIGHT_CAP` (4) nearest `on` lights to
 * `(cx,cy,cz)` into `lights.cpuIdx[0..count)`, nearest first (a small
 * insertion sort into preallocated `cpuIdx`/`_cpuDist` - no allocation,
 * stable for equal distances since a later light only displaces an earlier
 * one on a STRICTLY smaller distance). Returns the count (<= CPU_LIGHT_CAP).
 * CPU fallback (`?gpu=0`) only - the GPU/GLSL path and `?gpucompare=1` keep
 * the full light list for parity (tech notes item 7/8).
 */
export function selectCpuLights(lights, cx, cy, cz) {
  const idx = lights.cpuIdx, dist = lights._cpuDist;
  let count = 0;
  const n = lights.count;
  for (let i = 0; i < n; i++) {
    if (!lights.on[i]) continue;
    const o4 = i * 4;
    const dx = lights.pos[o4] - cx, dy = lights.pos[o4 + 1] - cy, dz = lights.pos[o4 + 2] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (count < CPU_LIGHT_CAP) {
      let j = count - 1;
      while (j >= 0 && dist[j] > d2) { dist[j + 1] = dist[j]; idx[j + 1] = idx[j]; j--; }
      dist[j + 1] = d2; idx[j + 1] = i;
      count++;
    } else if (d2 < dist[count - 1]) {
      let j = count - 2;
      while (j >= 0 && dist[j] > d2) { dist[j + 1] = dist[j]; idx[j + 1] = idx[j]; j--; }
      dist[j + 1] = d2; idx[j + 1] = i;
    }
  }
  lights.cpuCount = count;
  return count;
}

/**
 * JS reference lighting pass (14.3 item 1): fills `fb.light.rgb` for every
 * `kind != 0` cell from `fb.gbuf`/`fb.depth`, using the SAME per-point
 * ray/normal reconstruction the GLSL `light` pass uses (no world xyz stored
 * in the G-buffer - P is rebuilt from the cell's screen position + depth,
 * exactly like the caster's own ray formula). `fb.light.uniform` must
 * already be `false` and `fb.light.rgb` sized `cols*rows*3` (see
 * `makeLightBuffer`) - this never allocates or resizes.
 */
export function lightSurfaces(fb, lights, cam, world) {
  const lb = fb.light;
  // Architect review 1 item 3: `lightSurfaces` sets `uniform = false` ITSELF
  // (used to be the caller's job - compositor.js set it right before this
  // call, but `bench-cast.mjs` calls this function directly and never did,
  // so `lb.uniform` was still `true` from `makeLightBuffer`'s default and
  // this returned on line 1 every frame, measuring nothing). No `lights` ->
  // the `?lights=0` regression path - caller already filled rgb[0..2] with ambient.
  if (!lb || !lights) return;
  lb.uniform = false;
  // PO REJECT item 1: `fb.cpuLightCap` is set only on the real gameplay
  // frame buffer's CPU-fallback path (game/js/main.js) - never on
  // `?gpucompare=1`'s `fbCompare` objects, so GPU parity keeps the full
  // light list. Selection is once per frame (this function runs once per
  // rendered frame), no per-cell/per-frame allocation.
  const capped = !!fb.cpuLightCap;
  let idxList = null, idxCount = 0;
  if (capped) {
    idxCount = selectCpuLights(lights, cam.x, cam.y, cam.z);
    idxList = lights.cpuIdx;
  }
  const gbuf = fb.gbuf, depth = fb.depth.depth;
  const cols = gbuf.cols, rows = gbuf.rows;
  const rt = fb.rt;

  const hFovRad = HFOV_DEG * Math.PI / 180;
  const tanHalfHFov = Math.tan(hFovRad / 2);
  const yawRad = cam.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
  const planeX = -dirY * tanHalfHFov, planeY = dirX * tanHalfHFov;
  const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
  const pitchRad = cam.pitchDeg * Math.PI / 180;
  const horizonRow = rows / 2 + Math.tan(pitchRad) * planeDistY;

  const kind = gbuf.kind, face = gbuf.face, rgb = lb.rgb;
  for (let y = 0; y < rows; y++) {
    const slope = -(y - horizonRow) / planeDistY;
    const rowBase = y * cols;
    for (let x = 0; x < cols; x++) {
      const i = rowBase + x;
      if (kind[i] === 0) continue;
      const d = depth[i];
      if (!(d > 0) || !Number.isFinite(d)) continue;
      const cameraX = (2 * (x + 0.5)) / cols - 1;
      const rdx = dirX + planeX * cameraX, rdy = dirY + planeY * cameraX;
      const px = cam.x + rdx * d, py = cam.y + rdy * d, pz = cam.z + slope * d;
      const f = face[i];
      lightAt(lights, world, px, py, pz, NX[f] || 0, NY[f] || 0, NZ[f] || 0, evalScratch, idxList, idxCount);
      const o = i * 3;
      rgb[o] = evalScratch[0]; rgb[o + 1] = evalScratch[1]; rgb[o + 2] = evalScratch[2];
    }
  }
}
/** Allocates `fb.light`'s backing store (once, at FrameBuffers-construction/resize time - never inside `lightSurfaces`). */
export function makeLightBuffer(cols, rows) {
  return { uniform: true, rgb: new Float32Array(cols * rows * 3) };
}
