// engine/render/lighting.js (US-006/US-007 tech notes, docs/architecture.md
// 14.3). `LightSet` owns all light state (ambient + point lights + the
// sun), `buildLightSet` reads `level.def.lights`/`.sun`/`.ambient` per
// placed structure (US-002 rules: hue from `P.hue[color]`, energy from
// `intensity`, values from `P.lights[preset]` - never hard-coded), `lightAt`
// is the single point evaluator shared by `lightSurfaces` (CPU/JS reference,
// this file) and the GLSL `light` pass (`gpu/glsl/light.frag.js`, same
// formula). Pure/allocation-free after construction (architecture.md 9) -
// every per-frame method writes into pre-allocated typed arrays.
//
// Deviation (flagged for architect review, not silent): `computeVisGrid`
// below keys each light's visibility box on its OWN unjittered cell +-
// `ceil(radius)` (a small local box, `MAX_VIS_DIM` per side), not the
// containing structure's full footprint as 14.3 item 5 describes - simpler,
// Node-testable without a `packed` atlas, and identical at the sample point
// (`vis = 1` outside the box, matching the "outside every footprint" rule).
// The GLSL `light` pass (light.frag.js) uses the exact same box convention
// for parity.
//
// US-007 deviation: `sunVisible`'s structure walk uses `world.sectorAt`/
// `world.structureAt` (world coordinates throughout) instead of an explicit
// per-structure slab-entry loop (14.3 item 4's "then the remaining placed
// structures by slab entry, same loop shape as dda.frag") - `sectorAt`
// already resolves "which placed structure (if any) covers this world
// cell" across every structure, so re-deriving that with a manual slab loop
// in JS would just be a slower version of the same answer. The GLSL twin
// (`light.frag.js`) *does* need the explicit loop (no `sectorAt` there),
// and documents its own version of this deviation.

import { HFOV_DEG } from './sectorCaster.js';
import { FACE_PACKED } from './GBuffer.js';
import { unpackNormalOct } from '../voxel/octNormal.js';

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

  /**
   * The ONLY sun mutator (US-007, F6/F7 in `game/js/main.js`). Recomputes
   * `dir` (unit vector TOWARD the sun; x east, y south, z up, `azimuth`
   * compass degrees = where the light comes FROM - 14.3 item 3). "Elevation
   * <= 0 -> sun.on = false" (tech notes item 4): a sun below the horizon
   * never lights anything, regardless of the caller's requested `on`.
   */
  setSun({ elevation, azimuth, on }) {
    this.sun.elevation = elevation; this.sun.azimuth = azimuth;
    this.sun.on = elevation > 0 ? !!on : false;
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
 *
 * US-007: sun/ambient come from the FIRST placed structure's `def.sun`
 * (`{preset?, elevation?, azimuth?}`, MAP_FORMAT - `design/levels/tower.js`'s
 * `sun: { preset: 'sun', elevation: 60, azimuth: 112.5 }`), falling back to
 * `P.lights[preset || 'sun']`'s own `elevation`/`azimuth`/`color`/
 * `intensity` when a level omits any of them or has no `def.sun` at all -
 * "sun/ambient from the first structure's def (fallback: palette defaults)"
 * (14.3 item 1's `buildLightSet` signature comment). `setSun` is the only
 * writer of `on`/`elevation`/`azimuth`/`dir`; `sun.col` (hue*intensity, no
 * per-frame flicker) is set directly here, once, like a point light's
 * `baseHue`/`baseIntensity`.
 */
export function buildLightSet(world, palette) {
  const ls = new LightSet();
  const amb = palette.lights.ambient;
  const ambHue = palette.hue[amb.color];
  ls.ambient[0] = ambHue[0] * amb.intensity;
  ls.ambient[1] = ambHue[1] * amb.intensity;
  ls.ambient[2] = ambHue[2] * amb.intensity;

  const firstStruct = world.structures[0];
  const sunDef = (firstStruct && firstStruct.level && firstStruct.level.def && firstStruct.level.def.sun) || null;
  const sunPreset = palette.lights[(sunDef && sunDef.preset) || 'sun'];
  if (sunPreset) {
    const sunHue = palette.hue[sunPreset.color];
    const elevation = (sunDef && sunDef.elevation != null) ? sunDef.elevation : sunPreset.elevation;
    const azimuth = (sunDef && sunDef.azimuth != null) ? sunDef.azimuth : sunPreset.azimuth;
    ls.setSun({ elevation, azimuth, on: true });
    ls.sun.col[0] = sunHue[0] * sunPreset.intensity;
    ls.sun.col[1] = sunHue[1] * sunPreset.intensity;
    ls.sun.col[2] = sunHue[2] * sunPreset.intensity;
  }

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

// Normal-by-face lookup (GBuffer.js FACE_N..FACE_D = 1..6). Face 7
// (FACE_PACKED, a rotated voxel-model part - US-041a 15.3 item 3) has no
// entry here: its normal is octahedral-packed in the G-buffer's `aoD` slot
// instead (`GA.w` on the GPU) and decoded separately, see `lightSurfaces`.
const NX = [0, 0, 1, 0, -1, 0, 0];
const NY = [0, -1, 0, 1, 0, 0, 0];
const NZ = [0, 0, 0, 0, 0, 1, -1];

const evalScratch = new Float64Array(3);
const modelNormalScratch = new Float64Array(3);

// US-041a (15.3 item 3): "on the CPU [the packed normal bits] go into the
// bits of gbuf.aoD[i] through a Uint32Array alias of gbuf.aoD.buffer, made
// once per GBuffer identity (not per frame)" - literal twin of
// voxelMarch.js's own `getAoAlias` (that file writes the bits at cast time;
// this one reads them back at light time), kept as a separate cache here
// since the two modules must never assume they share a property key.
const _aoAliasCache = new WeakMap();
function aoU32(gbuf) {
  let alias = _aoAliasCache.get(gbuf);
  if (!alias || alias.buffer !== gbuf.aoD.buffer) {
    alias = new Uint32Array(gbuf.aoD.buffer, gbuf.aoD.byteOffset, gbuf.aoD.length);
    _aoAliasCache.set(gbuf, alias);
  }
  return alias;
}

// US-007: `lightAt` writes its per-call sun/point-light debug info here
// (never allocated per call - architecture.md 9), mirroring `LIGHT.w`'s
// `sunlit | litCount << 8` (14.3 item 3). Single-threaded/synchronous JS
// only (no re-entrant `lightAt` calls), same pattern as `evalScratch`.
export const lightFlags = { sunlit: 0, litCount: 0 };

/**
 * Shared per-point evaluator (surfaces here, sprites in a later story) -
 * `L = ambient + sum_i col_i * falloff(d,r) * max(0,N.L) * vis_i(P) +
 * sunCol * max(0,N.sunDir) * sunlit(P)`. `world` is used by `sampleVis`
 * indirectly (the vis grid is already baked by `update()` - this function
 * never recomputes it) and directly by `sunVisible` for the sun shadow DDA.
 * Writes `lightFlags.sunlit`/`.litCount` for this call (debug/parity only -
 * `lightSurfaces` below copies them into `fb.light.sunlit`/`.litCount`).
 *
 * `idxList`/`idxCount` (optional, PO REJECT item 1): when given, evaluates
 * only those light indices (the CPU fallback's 4-nearest list from
 * `selectCpuLights`) instead of `[0, lights.count)`. Omitted by every other
 * caller (GPU-parity `?gpucompare=1` path, the N.L/vis unit tests), so
 * behaviour there is unchanged.
 */
export function lightAt(lights, world, x, y, z, nx, ny, nz, out, idxList, idxCount) {
  out[0] = lights.ambient[0]; out[1] = lights.ambient[1]; out[2] = lights.ambient[2];
  let litCount = 0;
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
    // BUG-LIGHT-001 fix (architect review 1 of US-011, docs/backlog.md row
    // 25b): sample the vis grid at `S = P + (L-P)/|L-P| * 0.02` - toward the
    // LIGHT, not along the surface normal. The old `P + N*0.01` (architect
    // review 1 item 1 of US-006) fixed the wall case (a wall hit lies
    // exactly on the cell boundary) but does nothing for a FLOOR (`N =
    // 0,0,1`): nudging along N only moves z, so `floor(P.x/y)` is still an
    // exact float coin flip at a depth-discontinuity silhouette edge (the
    // "boulder mid-roll" repro - a far step top directly above a near wall
    // face on screen), which is what let this bug through the old US-006
    // fix. `dx,dy,d` above are already `(light - P)`/its length; reuse them.
    const vis = sampleVis(lights, i, x + (dx / d) * 0.02, y + (dy / d) * 0.02);
    if (vis <= 0) continue;
    const amt = fo * ndotl * vis;
    out[0] += lights.col[o4] * amt;
    out[1] += lights.col[o4 + 1] * amt;
    out[2] += lights.col[o4 + 2] * amt;
    litCount++;
  }
  lightFlags.litCount = litCount;
  let sunlit = 0;
  const sun = lights.sun;
  if (sun && sun.on) {
    const sd = sun.dir;
    const ndotsun = nx * sd[0] + ny * sd[1] + nz * sd[2];
    if (ndotsun > 0) {
      // BUG-LIGHT-001 fix: same "toward the light" nudge as the point-light
      // vis sample above (the sun's "light direction" is `sd`, already unit)
      // instead of along `N` - a floor face (`N = 0,0,1`) needs an x/y
      // nudge to escape a cell-boundary coin flip, which `N` alone can't give.
      if (sunVisible(world, x + sd[0] * 0.02, y + sd[1] * 0.02, z + sd[2] * 0.02, sd)) {
        sunlit = 1;
        out[0] += sun.col[0] * ndotsun;
        out[1] += sun.col[1] * ndotsun;
        out[2] += sun.col[2] * ndotsun;
      }
    }
  }
  lightFlags.sunlit = sunlit;
  return out;
}

// BUG-LIGHT-002 (docs/backlog.md row 25d): `sampleVis`'s `x - ox`/`y - oy`
// occasionally lands within float32 noise of an exact integer (the light's
// 0.02 "toward the light" nudge can land the sample almost exactly back on
// a cell boundary it was meant to escape) - `cellRayP`'s GLSL float32 chain
// and `lightSurfaces`'s JS float64 chain then round that near-integer value
// to opposite sides, `floor()` picks a different vis cell, and a fully
// occluded/unoccluded flip on ONE light (not a gradual falloff difference)
// shows up as a `dLViol` far above the float32-noise tolerance (confirmed
// via a `?gpucompare=1&lightdebug=1` per-light readback on the OWN-001 pose:
// `P.x` == 1498.00000 on both paths, `floor(P.x - ox)` == 6 on both by the
// display precision shown, yet the real (bit-exact) GPU value crosses to 5).
// Fix: bias the floor by a fixed epsilon, comfortably above the ~1.8e-4
// worst-case float32 absolute precision at world coordinates in the
// low thousands (24-bit mantissa) and far below a 1 m cell, so both paths
// commit to the same side of the boundary regardless of which precision
// computed `x`/`y`. Same constant in `light.frag.js`'s `sampleVis`.
export const VIS_FLOOR_EPS = 1e-3;

export function sampleVis(lights, i, x, y) {
  const w = lights.visW[i], h = lights.visH[i];
  if (w <= 0 || h <= 0) return 1;
  const lx = Math.floor(x - lights.visOx[i] + VIS_FLOOR_EPS), ly = Math.floor(y - lights.visOy[i] + VIS_FLOOR_EPS);
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

// US-007 (14.3 item 4): "lit when ... MAX_SUN_STEPS = 48 is reached (bias
// to lit)". A tiny z nudge above the surface (`sunVisible`'s `h0 = z +
// 1e-3`) so a point exactly on its own floor/ceiling plane is never
// self-shadowed by float rounding.
export const MAX_SUN_STEPS = 48;
const SUN_Z_EPS = 1e-3;

// Crossing test (14.3 item 2/4, normative, same rule in GLSL): the rising
// ray covers heights [h0, h1] while inside `sec`'s cell. Blocked iff
// `h0 < floorH` (solid: the wall body, whose column runs up to `floorH` -
// US-003; open: the step block) OR, when the cell has a real ceiling
// (`!ceilSky`), the ray's height band overlaps the closed [ceilH, topH]
// slab (`topH == ceilH` when undefined, so a zero-thickness slab still
// blocks - "closed" per the tech note). Uniform for solid and open cells
// alike - unlike the point-light `cellBlocks` above, which only applies the
// slab test to non-solid cells (a solid cell's own `ceilH` never matters,
// its column already stops at `floorH`).
function sunCellBlocked(sec, h0, h1) {
  if (h0 < sec.floorH) return true;
  if (sec.ceilH === 'sky') return false;
  const topH = sec.topH === undefined ? sec.ceilH : (sec.topH === 'sky' ? Infinity : sec.topH);
  return h0 <= topH && h1 >= sec.ceilH;
}

/**
 * JS reference of the GLSL sun DDA (14.3 item 4): is `(x,y,z)` (already the
 * caller's `S = P + N*0.01`) lit by the sun, walking the grid toward `dir`
 * (`lights.sun.dir`, unit, TOWARD the sun)? `world` may be null (no placed
 * structures yet) - returns lit (`true`), matching "outside every footprint
 * -> lit".
 *
 * Deviation from the literal 14.3 item 4 structure loop: see this file's
 * module doc - `world.sectorAt`/`world.structureAt` already resolve "which
 * placed structure (if any) owns this world cell" across every structure,
 * so the walk stays entirely in WORLD coordinates and needs no explicit
 * per-structure slab-entry step (that machinery is what the GLSL twin needs
 * instead, since it has no such world-coordinate query).
 */
export function sunVisible(world, x, y, z, dir) {
  if (!world) return true;
  const dx = dir[0], dy = dir[1], dz = dir[2];
  const horiz = Math.hypot(dx, dy);
  let h0 = z + SUN_Z_EPS;

  // 14.3 item 4 amendment (ii/iv): cell heights and `maxH` are level-local,
  // so every comparison below subtracts the owning structure's `origin.z`
  // first. `worldMaxH` = max over every placed structure of `origin.z +
  // packed.maxH` (world space) - outside every footprint the walk never
  // blocks and costs no fetch, but keeps going (a structure across a gap
  // still shadows) until `h0` clears this bound.
  let worldMaxH = 0;
  for (let i = 0; i < world.structures.length; i++) {
    const s = world.structures[i];
    const m = s.origin.z + s.packed.maxH;
    if (m > worldMaxH) worldMaxH = m;
  }

  if (horiz < 1e-9) {
    // Straight-up sun (elevation 90): never crosses a cell boundary - one
    // slab test on the starting cell against an unbounded band above.
    const struct = world.structureAt(x, y);
    if (!struct) return true;
    const sec = struct.level.sectorAt(x - struct.origin.x, y - struct.origin.y);
    if (!sec) return true;
    return !sunCellBlocked(sec, h0 - struct.origin.z, Infinity);
  }

  const ndx = dx / horiz, ndy = dy / horiz;
  const tanElev = dz / horiz;
  let mapX = Math.floor(x), mapY = Math.floor(y);
  const stepX = ndx > 0 ? 1 : ndx < 0 ? -1 : 0;
  const stepY = ndy > 0 ? 1 : ndy < 0 ? -1 : 0;
  const deltaDistX = ndx === 0 ? Infinity : Math.abs(1 / ndx);
  const deltaDistY = ndy === 0 ? Infinity : Math.abs(1 / ndy);
  let sideDistX = ndx === 0 ? Infinity : (ndx > 0 ? (mapX + 1 - x) : (x - mapX)) * deltaDistX;
  let sideDistY = ndy === 0 ? Infinity : (ndy > 0 ? (mapY + 1 - y) : (y - mapY)) * deltaDistY;

  let tPrev = 0;
  for (let step = 0; step < MAX_SUN_STEPS; step++) {
    // Structure owning the cell the ray is about to cross (pre-step); may
    // be null between/around footprints - never blocks, no fetch, the walk
    // continues (item iv), it does not exit early.
    const cx = mapX, cy = mapY;
    const owner = world.structureAt(cx + 0.5, cy + 0.5);
    let t1;
    if (sideDistX < sideDistY) { t1 = sideDistX; sideDistX += deltaDistX; mapX += stepX; }
    else { t1 = sideDistY; sideDistY += deltaDistY; mapY += stepY; }
    const h1 = h0 + tanElev * (t1 - tPrev);
    if (owner) {
      const sec = owner.level.sectorAt(cx + 0.5 - owner.origin.x, cy + 0.5 - owner.origin.y);
      if (sec) {
        const oz = owner.origin.z;
        if (sunCellBlocked(sec, h0 - oz, h1 - oz)) return false;
      }
    }
    h0 = h1; tPrev = t1;
    // Structure just entered (post-step): its own local maxH bounds it -
    // once h0 clears it, THIS structure can no longer block (item iv).
    const entered = world.structureAt(mapX + 0.5, mapY + 0.5);
    if (entered && h0 - entered.origin.z > entered.packed.maxH) return true;
    if (h0 > worldMaxH) return true;
  }
  return true; // step cap - bias to lit
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
      let nx, ny, nz;
      if (f === FACE_PACKED) {
        // US-041a (15.3 item 3): the only light-pass change - decode the
        // octahedral-packed normal from `aoD`'s bits (`unpackNormalOct`, the
        // literal twin `packNormalOct` in voxelMarch.js wrote) instead of the
        // fixed axis lookup above.
        unpackNormalOct(aoU32(gbuf)[i], modelNormalScratch);
        nx = modelNormalScratch[0]; ny = modelNormalScratch[1]; nz = modelNormalScratch[2];
      } else {
        nx = NX[f] || 0; ny = NY[f] || 0; nz = NZ[f] || 0;
      }
      lightAt(lights, world, px, py, pz, nx, ny, nz, evalScratch, idxList, idxCount);
      const o = i * 3;
      rgb[o] = evalScratch[0]; rgb[o + 1] = evalScratch[1]; rgb[o + 2] = evalScratch[2];
      // US-007 (14.3 item 3, `LIGHT.w = sunlit | litCount << 8`, debug/
      // parity only): copied out of the shared `lightFlags` scratch right
      // after the call that set it - never read across a different cell's
      // `lightAt` call.
      if (lb.sunlit) lb.sunlit[i] = lightFlags.sunlit;
      if (lb.litCount) lb.litCount[i] = lightFlags.litCount;
    }
  }
}
/** Allocates `fb.light`'s backing store (once, at FrameBuffers-construction/resize time - never inside `lightSurfaces`). */
export function makeLightBuffer(cols, rows) {
  return {
    uniform: true, rgb: new Float32Array(cols * rows * 3),
    // US-007: per-cell debug/parity mirrors of `LIGHT.w`'s two fields -
    // `?gpucompare=1`'s sunlit-flag mismatch metric reads `sunlit` back
    // against the GPU readout.
    sunlit: new Uint8Array(cols * rows), litCount: new Uint8Array(cols * rows),
  };
}
