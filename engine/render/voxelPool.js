// engine/render/voxelPool.js - US-040 `VoxelPool` (architecture.md 15.2
// item 1/2): the per-frame voxel-model instance list, shared by `castModels`
// (the CPU oracle) and the GPU voxel pass (`GpuCellPipeline.bindVoxels` /
// `VoxelTextures.writeInstanceRows`, US-040 build-order step 2). Binding
// entities (`collect(world)`) is US-041a; US-040 only has the test/dev
// harness feed `pushInstance(...)`.

import { MAX_VOX_INSTANCES, MAX_VOX_INSTANCES_MESH, MAX_VOX_PARTS, PART_STRIDE } from '../voxel/VoxelModel.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { voxelPointWorld } from '../voxel/voxelPose.js';
import { computeProjection, computeProjectionPitched, instanceRect } from '../voxel/instanceRect.js';
import { createPitchedTerms, pitchedTerms, resolveProjection, isPitchedFamily } from './projection.js';
import { lodCentreX, lodCentreY, lodCentreZ } from '../core/camFocus.js';
import { buildVoxelAtlas } from './gpu/VoxelTextures.js';

const _proj = { cols: 0, rows: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0, planeDet: 0, horizonRow: 0, planeDistY: 0, eyeX: 0, eyeY: 0, eyeZ: 0,
  pitched: false, fX: 0, fY: 0, fZ: 0, rX: 0, rY: 0, uX: 0, uY: 0, uZ: 0, tanHalfX: 0, tanHalfY: 0 };
const _noCullProj = { cols: 1, rows: 1, planeDet: 0, pitched: false }; // ME-15c: instanceRect with no screen cull (world AABB only)
const _emisPt = new Float64Array(3); // offerEmissive scratch
// Stable non-zero int identity for derived-light slots (FNV-1a over a string).
function hashStr(str, h = 0x811c9dc5) {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}
// EMIS-01b: mixes a running hash with an already-integer value (Math.imul, no strings/allocation).
function hashInt(h, v) {
  h ^= v | 0;
  return Math.imul(h, 0x01000193) | 0;
}
const _poolPitch = createPitchedTerms(); // RE-02a
const _poolGrid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 };

function warnOnce(pool, msg) {
  if (!pool._warned) pool._warned = new Set();
  if (pool._warned.has(msg)) return;
  pool._warned.add(msg);
  if (typeof console !== 'undefined' && console.warn) console.warn(msg);
}

function projectedSlot() {
  return { model: null, modelKey: '', x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, fromClip: -1, fromFrame: 0, fromTMs: 0, fromW: 0, scale: 1, slot: 0, entity: null, addPart: -1, addRx: 0, addRy: 0, addRz: 0,
    pose: new Float64Array(MAX_VOX_PARTS * PART_STRIDE),
    rect: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, minCol: 0, maxCol: 0, minRow: 0, maxRow: 0, empty: false } };
}

export class VoxelPool {
  constructor() {
    /** RE-02b F1: which renderer resolves an unset `cam.projection` ('mesh' -> pitched). */
    this.renderer = 'mesh';
    /** modelKey -> PackedVoxelModel (packed at bind()). */
    this.models = new Map();
    // This frame's pushInstance() queue - plain objects, reused slot by
    // slot across frames (no per-frame allocation once warm).
    this.raw = Array.from({ length: MAX_VOX_INSTANCES_MESH }, () => ({ model: null, modelKey: '', x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, fromClip: -1, fromFrame: 0, fromTMs: 0, fromW: 0, scale: 1, seed: 0, entity: null, addPart: -1, addRx: 0, addRy: 0, addRz: 0 }));
    this._rawCount = 0;
    // Projected + culled instances, compact 0..count-1 (list.length ===
    // stats.count after project()); each entry's `slot` index is what the
    // GPU instance rows / planeId's slot field key off.
    this.list = [];
    this._slots = Array.from({ length: MAX_VOX_INSTANCES_MESH }, projectedSlot);
    this.stats = { count: 0, instancesCulled: 0 };
    // ME-08a (27.16 item 5): modelKey -> part-name array (voxelPack order),
    // recorded once at bind(); `partNamesFor` returns the stored array,
    // never a new one (zero per-frame allocation in addVoxelInstances).
    this._partNames = new Map();
    /** @type {(modelKey: string) => string[]} */
    this.partNamesFor = (key) => /** @type {string[]} */ (this._partNames.get(key));
    // ME-15c (27.9a amendment, caster gap b): every queued prop posed WITHOUT the screen cull, for the sun
    // shadow list (props behind the player still cast). `shadowView` is the {list, partNamesFor} shape
    // `buildShadowList` feeds to `addVoxelInstances`.
    this.shadowList = []; // ME-15c/d: per-frame view (references), length = prop count
    this._shadowSlots = Array.from({ length: MAX_VOX_INSTANCES_MESH }, projectedSlot); // ME-15d: posed records, never shrink (zero alloc when the prop count grows back)
    this.shadowView = { list: this.shadowList, partNamesFor: this.partNamesFor };
    // Camera eye position from this frame's project() call - VoxelTextures.js's
    // writeInstanceRows reads these to compute the part-local eye (oL = A*eye+b,
    // 15.2 item 3) in float64 JS.
    this.eyeX = 0; this.eyeY = 0; this.eyeZ = 0;
    // Built by bind() (15.2 item 2): the shared VOX atlas and a modelKey ->
    // index map into `atlas.modelBase` (writeInstanceRows' lookup).
    this.atlas = null;
    this._modelIndexByKey = {};
    this._atlasVersion = 0;

    // US-041a (15.3 item 1): `collect(world)`'s entity cache, cached by
    // `world.renderVersion` - same pattern as `SpritePool.collect`
    // (engine/render/sprites.js). Rebuilt only when the entity LIST shape
    // changes (spawn/remove/etc bump renderVersion); a restart hands
    // `collect` a brand-new `World` (deserialize), so `world !== _entWorld`
    // alone forces a fresh scan - no extra "on restart" special case needed.
    this._ents = [];
    this._entVersion = -1;
    this._entWorld = null;
    // Per-renderer nearest selection; all storage covers the mesh cap once.
    this._nearIdx = new Int32Array(MAX_VOX_INSTANCES_MESH);
    this._nearDist = new Float64Array(MAX_VOX_INSTANCES_MESH);
    this._collectWarned = 0;
    this._pushWarned = 0;
  }

  get renderer() { return this._renderer; }
  set renderer(value) {
    this._renderer = value;
    this.cap = value === 'mesh' ? MAX_VOX_INSTANCES_MESH : MAX_VOX_INSTANCES;
  }

  /** Packs every `ModelDef.voxel` in the registry (bind time, may allocate -
   * not a hot path). `table` is a bound MaterialTable (`table.idFor`). Also
   * (re)builds the shared VOX atlas (architecture.md 15.2 item 2) - GPU
   * re-upload key is `this.atlas.version`, bumped on every bind(). */
  bind(registry, table) {
    this.models.clear();
    this._partNames.clear();
    const keys = registry.keys('model');
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const def = registry.model(key);
      if (def && def.voxel) {
        this._partNames.set(key, Object.keys(def.voxel.parts));
        const pm = packVoxelModel(def.voxel, (matKey) => table.idFor(matKey), lightInfo(registry, def));
        // ME-22 (28.12 item 4): a static per-model flag, set once here (not
        // re-read from JSON per frame) - routes a mesh-only model away from
        // the shared VOX atlas/VoxelTextures (DDA-only, 16-slot/256-row
        // budget) below, and away from the DDA instance queue in project().
        pm.meshOnly = def.voxel.meshOnly === true;
        this.models.set(key, pm);
      }
    }
    const modelKeys = Array.from(this.models.keys());
    // A mesh-only model never enters the atlas: it can be far larger than
    // the atlas budget, and the mesh renderer reads `pm.vox` directly via
    // buildVoxelMesh, never through this atlas/index map.
    const atlasKeys = modelKeys.filter((k) => !this.models.get(k).meshOnly);
    const packedList = atlasKeys.map((k) => this.models.get(k));
    this._atlasVersion++;
    this.atlas = buildVoxelAtlas(packedList, this._atlasVersion);
    this._modelIndexByKey = {};
    for (let i = 0; i < atlasKeys.length; i++) this._modelIndexByKey[atlasKeys[i]] = i;
  }

  /** Clears this frame's instance queue. Call once before this frame's
   * pushInstance() calls (US-041a's collect(world) replaces the harness
   * loop but keeps this reset). */
  beginFrame() {
    this._rawCount = 0;
  }

  /** Test/dev harness feed (architecture.md 15.2 item 7's gpucompare poses):
   * queues one instance of `modelKey` (must be bound, i.e. have `.voxel`) at
   * world feet position (x,y,z), yaw `yawDeg`, playing `clip`/`frame`/`tMs`
   * (clip -1 or omitted = rest pose, matching voxelPose.js's samplePose).
   * Past the active renderer cap, extra pushes are dropped (warn once). Returns the raw slot index, -1 when dropped. */
  pushInstance(modelKey, x, y, z, yawDeg, clip, frame, tMs, scale = 1) {
    const pm = this.models.get(modelKey);
    if (!pm) { warnOnce(this, `VoxelPool.pushInstance: unknown or non-voxel model '${modelKey}'`); return -1; }
    if (this._rawCount >= this.cap) {
      const bit = this.cap === MAX_VOX_INSTANCES_MESH ? 2 : 1;
      if (!(this._pushWarned & bit)) {
        this._pushWarned |= bit;
        warnOnce(this, `VoxelPool.pushInstance: cap (${this.cap}) exceeded, extra instances dropped`);
      }
      return -1;
    }
    const slot = this._rawSlot(this._rawCount);
    slot.model = pm;
    slot.modelKey = modelKey;
    slot.x = x; slot.y = y; slot.z = z;
    slot.yawDeg = yawDeg || 0;
    slot.clip = clip === undefined ? -1 : clip;
    slot.frame = frame || 0;
    slot.tMs = tMs || 0;
    slot.fromClip = -1; slot.fromW = 0;
    slot.scale = scale > 0 ? scale : 1; // ED-SCALE-1a (34.2 item 5)
    // EMIS-01b: harness instances have no entity id -> identity from model + position.
    // Integer hash (Math.round to 1cm buckets, Math.imul mixing) instead of string concat - no strings/allocation per push.
    slot.seed = pm.emissiveLight
      ? (hashInt(hashInt(hashInt(hashStr(modelKey), Math.round(x * 100)), Math.round(y * 100)), Math.round(z * 100)) || 1)
      : 0;
    slot.entity = null;
    slot.addPart = -1;
    return this._rawCount++;
  }

  /** WILD-01 (38.31 item 8): sets the from-clip of raw slot `i` (a `pushInstance` return). `fromW` = weight of the old pose (1 -> 0). */
  blendInstance(i, fromClip, fromFrame, fromTMs, fromW) {
    if (i < 0 || i >= this._rawCount) return;
    const slot = this.raw[i];
    slot.fromClip = fromClip; slot.fromFrame = fromFrame || 0; slot.fromTMs = fromTMs || 0; slot.fromW = fromW;
  }

  /** 38.23: the G-buffer objectId (0x8000 | slot, same as voxelMesh's draw item) of `entity` in the last project(); -1 when it has no slot. */
  objectIdFor(entity) {
    const list = this.list;
    for (let i = 0; i < list.length; i++) if (list[i].entity === entity) return 0x8000 | list[i].slot;
    return -1;
  }

  /** Reused per-slot raw-instance object at `this.raw[idx]` (no per-frame allocation once warm). */
  _rawSlot(idx) {
    return this.raw[idx];
  }

  /**
   * Queues one entity's `components.voxel` (already known-good: caller
   * picked it) as this frame's next raw instance. `voxel.anim` (a clip
   * NAME, matching `sprite`'s shape) resolves through the packed model's
   * `clipIndex` to the numeric index `computeVoxelPose`/`instanceRect`
   * expect (-1 = rest pose, same as `pushInstance`'s default) - an unknown
   * anim name falls back to the rest pose rather than throwing (a render
   * tick must never crash over stale/test data, same rule as `clipFor`).
   */
  _queueEntity(e) {
    const v = e.components.voxel, t = e.transform;
    const pm = this.models.get(v.model);
    if (!pm) { warnOnce(this, `VoxelPool.collect: unknown or non-voxel model '${v.model}'`); return; }
    const slot = this._rawSlot(this._rawCount);
    slot.model = pm;
    slot.modelKey = v.model;
    slot.x = t.x; slot.y = t.y; slot.z = t.z;
    if (t.yawDeg) slot.yawDeg = t.yawDeg; else slot.yawDeg = 0;
    const idx = v.anim && pm.clipIndex && Object.prototype.hasOwnProperty.call(pm.clipIndex, v.anim) ? pm.clipIndex[v.anim] : -1;
    slot.clip = idx;
    if (v.frame) slot.frame = v.frame; else slot.frame = 0;
    if (v.t) slot.tMs = v.t; else slot.tMs = 0;
    slot.fromClip = -1; slot.fromW = 0;
    if (t.scale > 0) slot.scale = t.scale; else slot.scale = 1;
    // EMIS-01b: stable identity of the entity (numeric id as-is; string id hashed, no allocation)
    slot.entity = e; // 38.23: objectIdFor(entity)
    // TALK-E1 (38.28 item 7): optional `components.voxel.partRot = {part, rx, ry, rz}`, added to the clip rotation.
    const pr = v.partRot;
    const ap = pr && pm.partIndex && pm.partIndex[pr.part] !== undefined ? pm.partIndex[pr.part] : -1;
    slot.addPart = ap;
    if (ap >= 0) { slot.addRx = pr.rx || 0; slot.addRy = pr.ry || 0; slot.addRz = pr.rz || 0; }
    slot.seed = 0;
    if (pm.emissiveLight) slot.seed = (typeof e.id === 'number' ? (e.id | 0) : hashStr(e.id)) || 1;
    this._rawCount++;
  }

  /**
   * US-041a (15.3 item 1): fills the raw list from every entity with a
   * `components.voxel`, nearest renderer-cap instances to `cam` win when
   * there are more candidates than that (insertion-selection into fixed-size
   * scratch - same no-allocation pattern as `lighting.js`'s
   * `selectCpuLights`). The entity ref array itself is rebuilt only when
   * `world.renderVersion` changes (mirrors `SpritePool.collect`); `cam` may
   * be omitted (falls back to distance from the origin) for callers that
   * only ever have <= the active cap of voxel entities and don't care about the ordering.
   *
   * US-079b0 (37.16.1 item 1): an entity whose `components.voxel.hidden ===
   * true` is skipped in BOTH branches below - the <= cap path and the
   * nearest-cap selection - so a hidden instance never renders and never
   * takes one of the nearest slots. The flag is read LIVE each frame (not
   * cached by `renderVersion`), since the view toggles it per state.
   */
  /** Slow path of collect(), split out so collect() holds no closure (an arrow capturing `this` allocates a context on EVERY call; FRAME-ALLOC-02). */
  _rebuildEnts(world) {
    this._ents.length = 0;
    world.forEachEntity((e) => { if (e.components && e.components.voxel) this._ents.push(e); });
    this._entVersion = world.renderVersion;
    this._entWorld = world;
  }

  collect(world, cam) {
    this.beginFrame();
    if (!world) return;
    if (world !== this._entWorld || world.renderVersion !== this._entVersion) this._rebuildEnts(world);
    const ents = this._ents;
    const n = ents.length;
    if (n <= this.cap) {
      for (let i = 0; i < n; i++) {
        // US-079b0 (37.16.1 item 1): a hidden voxel entity renders nothing.
        if (ents[i].components.voxel.hidden === true) continue;
        this._queueEntity(ents[i]);
      }
      return;
    }
    // Warn once per renderer cap, without formatting a message every frame.
    const bit = this.cap === MAX_VOX_INSTANCES_MESH ? 2 : 1;
    if (!(this._collectWarned & bit)) {
      this._collectWarned |= bit;
      warnOnce(this, `VoxelPool.collect: ${n} voxel entities exceed cap (${this.cap}); only the nearest ${this.cap} render`);
    }
    const cx = cam ? lodCentreX(cam) : 0, cy = cam ? lodCentreY(cam) : 0, cz = cam ? lodCentreZ(cam) : 0;
    const idx = this._nearIdx, dist = this._nearDist;
    let count = 0;
    for (let i = 0; i < n; i++) {
      // US-079b0 (37.16.1 item 1): a hidden entity does not take one of the
      // nearest `cap` slots (checked before the distance sort, so it can't
      // displace a visible entity).
      if (ents[i].components.voxel.hidden === true) continue;
      const t = ents[i].transform;
      const dx = t.x - cx, dy = t.y - cy, dz = t.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (count < this.cap) {
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
    for (let k = 0; k < count; k++) this._queueEntity(ents[idx[k]]);
  }

  /**
   * EMIS-01b (38.12 (1)): offers every QUEUED instance whose model has a derived emissive
   * light to `lights` (LightSet) - not only the drawn ones, so a lamp behind the camera keeps
   * its slot while you turn. Root pose only (centroid through the root part's current pose,
   * like `voxelMountWorld`). Call after `collect`/`pushInstance`, once per frame, before
   * `lights.update`. `cam` = {x,y,z} eye. Zero allocation. Returns the number offered.
   */
  offerEmissive(lights, cam) {
    lights.beginDerived(undefined, cam ? cam.x : 0, cam ? cam.y : 0, cam ? cam.z : 0);
    let offered = 0;
    const n = Math.min(this._rawCount, this.cap);
    for (let i = 0; i < n; i++) {
      const inst = this.raw[i];
      const rec = inst.model.emissiveLight;
      if (!rec) continue;
      voxelPointWorld(inst.model, inst, 0, rec.x, rec.y, rec.z, _emisPt);
      lights.offerDerived(_emisPt[0], _emisPt[1], _emisPt[2], rec, inst.seed);
      offered++;
    }
    lights.endDerived();
    return offered;
  }

  /**
   * ME-15c: poses every queued instance (same cap as `project`, meshOnly models included - shadows are mesh-only)
   * into `this.shadowList` with no screen cull; `rect` carries the world AABB the shadow-plane cull uses.
   * Zero allocation once warm.
   */
  projectShadow() {
    const n = Math.min(this._rawCount, this.cap);
    for (let i = 0; i < n; i++) {
      const inst = this.raw[i];
      const out = this._shadowSlots[i];
      this.shadowList[i] = out; // references only: the posed records live in the never-shrinking `_shadowSlots`
      instanceRect(_noCullProj, inst.model, inst, out.pose, null, out.rect);
      out.model = inst.model; out.modelKey = inst.modelKey;
      out.x = inst.x; out.y = inst.y; out.z = inst.z; out.yawDeg = inst.yawDeg;
      out.clip = inst.clip; out.frame = inst.frame; out.tMs = inst.tMs; out.fromClip = inst.fromClip; out.fromFrame = inst.fromFrame; out.fromTMs = inst.fromTMs; out.fromW = inst.fromW; out.scale = inst.scale;
      out.addPart = inst.addPart; out.addRx = inst.addRx; out.addRy = inst.addRy; out.addRz = inst.addRz;
      out.slot = i;
    }
    this.shadowList.length = n;
    return n;
  }

  /** Poses and culls this frame's queued instances via the shared
   * `instanceRect` step (architecture.md 15.2 item 2: castModels and the
   * pool must be able to never disagree), compacting survivors into
   * `this.list` in queue order (slot = compact index). Zero allocation once
   * `raw`/`list` are warm (reused per-slot objects/typed arrays). */
  project(cam, rt, renderer = this.renderer) {
    if (isPitchedFamily(resolveProjection(cam, renderer))) {
      // RE-02a (28.1 A2 item 2): pitched screen-rect cull.
      _poolGrid.cols = rt.cols; _poolGrid.rows = rt.rows; _poolGrid.pxCellW = rt.pxCellW || 1; _poolGrid.pxCellH = rt.pxCellH || 1;
      computeProjectionPitched(pitchedTerms(cam, _poolGrid, _poolPitch), _proj);
    } else {
      computeProjection(cam, rt, _proj);
    }
    this.eyeX = _proj.eyeX; this.eyeY = _proj.eyeY; this.eyeZ = _proj.eyeZ;
    let count = 0;
    let culled = 0;
    for (let i = 0; i < Math.min(this._rawCount, this.cap); i++) {
      const inst = this.raw[i];
      // ME-22 (28.12 item 4): the single place instances are routed into
      // the per-frame DDA/CPU-oracle list - a meshOnly model is skipped
      // (one warn per modelKey, never thrown, no placeholder geometry)
      // whenever the renderer actually used THIS frame is not 'mesh'. Uses
      // the `renderer` param (not `this.renderer`) since callers like
      // ?gpucompare=1 pass it per-call without ever setting `this.renderer`.
      if (inst.model && inst.model.meshOnly && renderer !== 'mesh') {
        warnOnce(this, `VoxelPool: model '${inst.modelKey}' is meshOnly, skipped for a non-mesh renderer (ME-22)`);
        continue;
      }
      const out = this._slots[count];
      this.list[count] = out;
      instanceRect(_proj, inst.model, inst, out.pose, null, out.rect);
      if (out.rect.empty) { culled++; continue; }
      out.model = inst.model; out.modelKey = inst.modelKey;
      out.x = inst.x; out.y = inst.y; out.z = inst.z; out.yawDeg = inst.yawDeg;
      out.clip = inst.clip; out.frame = inst.frame; out.tMs = inst.tMs; out.fromClip = inst.fromClip; out.fromFrame = inst.fromFrame; out.fromTMs = inst.fromTMs; out.fromW = inst.fromW; out.scale = inst.scale;
      out.addPart = inst.addPart; out.addRx = inst.addRx; out.addRy = inst.addRy; out.addRz = inst.addRz;
      out.slot = count;
      out.entity = inst.entity;
      count++;
    }
    this.list.length = count;
    this.stats.count = count;
    this.stats.instancesCulled = culled + Math.max(0, this._rawCount - this.cap);
  }
}

/**
 * EMIS-01b: material / preset lookups for `packVoxelModel`'s derived light (bind time).
 * Palette material: radiance colour = `glowColor` (palette key) else `base`; flicker = a
 * palette.lights preset name or an object; `hit_flash` (baked into the target / boar layers)
 * and any `light:false` material never makes a permanent light. `def.light` is the record
 * override (`false` | {preset}); undefined falls back to `def.voxel.light`.
 */
export function lightInfo(registry, def) {
  const pal = registry && registry.palette;
  if (!pal || !pal.materials) return undefined;
  const fixed = (f) => (typeof f === 'string' ? (pal.lights && pal.lights[f] && pal.lights[f].flicker) || null : f || null);
  return {
    override: def.light,
    matInfo(key) {
      const m = pal.materials[key];
      if (!m) return null;
      if (key === 'hit_flash' || m.light === false) return { emissive: 0, rgb: [1, 1, 1], light: false };
      const ck = m.glowColor || m.base;
      return { emissive: m.emissive || 0, rgb: (pal.rgb && pal.rgb[ck]) || [255, 255, 255], flicker: fixed(m.flicker) };
    },
    presetInfo(name) {
      const l = pal.lights && pal.lights[name];
      if (!l) return null;
      return { hue: (pal.hue && pal.hue[l.color]) || [1, 1, 1], intensity: l.intensity, radius: l.radius, flicker: l.flicker || null };
    },
  };
}
