// engine/render/voxelPool.js - US-040 `VoxelPool` (architecture.md 15.2
// item 1/2): the per-frame voxel-model instance list, shared by `castModels`
// (the CPU oracle) and the GPU voxel pass (`GpuCellPipeline.bindVoxels` /
// `VoxelTextures.writeInstanceRows`, US-040 build-order step 2). Binding
// entities (`collect(world)`) is US-041a; US-040 only has the test/dev
// harness feed `pushInstance(...)`.

import { MAX_VOX_INSTANCES, MAX_VOX_PARTS, PART_STRIDE } from '../voxel/VoxelModel.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { computeProjection, instanceRect } from '../voxel/instanceRect.js';
import { buildVoxelAtlas } from './gpu/VoxelTextures.js';

const _proj = { cols: 0, rows: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0, planeDet: 0, horizonRow: 0, planeDistY: 0, eyeX: 0, eyeY: 0, eyeZ: 0 };

function warnOnce(pool, msg) {
  if (!pool._warned) pool._warned = new Set();
  if (pool._warned.has(msg)) return;
  pool._warned.add(msg);
  if (typeof console !== 'undefined' && console.warn) console.warn(msg);
}

export class VoxelPool {
  constructor() {
    /** modelKey -> PackedVoxelModel (packed at bind()). */
    this.models = new Map();
    // This frame's pushInstance() queue - plain objects, reused slot by
    // slot across frames (no per-frame allocation once warm).
    this.raw = [];
    this._rawCount = 0;
    // Projected + culled instances, compact 0..count-1 (list.length ===
    // stats.count after project()); each entry's `slot` index is what the
    // GPU instance rows / planeId's slot field key off.
    this.list = [];
    this.stats = { count: 0, instancesCulled: 0 };
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
    // Nearest-MAX_VOX_INSTANCES selection scratch (15.3 item 1: "the nearest
    // 16 instances win") - fixed size (MAX_VOX_INSTANCES), never grows, so
    // this never allocates regardless of how many voxel entities exist.
    this._nearIdx = new Int32Array(MAX_VOX_INSTANCES);
    this._nearDist = new Float64Array(MAX_VOX_INSTANCES);
  }

  /** Packs every `ModelDef.voxel` in the registry (bind time, may allocate -
   * not a hot path). `table` is a bound MaterialTable (`table.idFor`). Also
   * (re)builds the shared VOX atlas (architecture.md 15.2 item 2) - GPU
   * re-upload key is `this.atlas.version`, bumped on every bind(). */
  bind(registry, table) {
    this.models.clear();
    const keys = registry.keys('model');
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const def = registry.model(key);
      if (def && def.voxel) {
        this.models.set(key, packVoxelModel(def.voxel, (matKey) => table.idFor(matKey)));
      }
    }
    const modelKeys = Array.from(this.models.keys());
    const packedList = modelKeys.map((k) => this.models.get(k));
    this._atlasVersion++;
    this.atlas = buildVoxelAtlas(packedList, this._atlasVersion);
    this._modelIndexByKey = {};
    for (let i = 0; i < modelKeys.length; i++) this._modelIndexByKey[modelKeys[i]] = i;
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
   * Past MAX_VOX_INSTANCES per frame, extra pushes are dropped (warn once) -
   * castModels applies the same cap. */
  pushInstance(modelKey, x, y, z, yawDeg, clip, frame, tMs) {
    const pm = this.models.get(modelKey);
    if (!pm) { warnOnce(this, `VoxelPool.pushInstance: unknown or non-voxel model '${modelKey}'`); return; }
    if (this._rawCount >= MAX_VOX_INSTANCES) { warnOnce(this, 'VoxelPool.pushInstance: MAX_VOX_INSTANCES exceeded, extra instances dropped'); return; }
    const slot = this._rawSlot(this._rawCount);
    slot.model = pm;
    slot.modelKey = modelKey;
    slot.x = x; slot.y = y; slot.z = z;
    slot.yawDeg = yawDeg || 0;
    slot.clip = clip === undefined ? -1 : clip;
    slot.frame = frame || 0;
    slot.tMs = tMs || 0;
    this._rawCount++;
  }

  /** Reused per-slot raw-instance object at `this.raw[idx]` (no per-frame allocation once warm). */
  _rawSlot(idx) {
    let slot = this.raw[idx];
    if (!slot) { slot = {}; this.raw[idx] = slot; }
    return slot;
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
    slot.yawDeg = t.yawDeg || 0;
    const idx = v.anim && pm.clipIndex && Object.prototype.hasOwnProperty.call(pm.clipIndex, v.anim) ? pm.clipIndex[v.anim] : -1;
    slot.clip = idx;
    slot.frame = v.frame || 0;
    slot.tMs = v.t || 0;
    this._rawCount++;
  }

  /**
   * US-041a (15.3 item 1): fills the raw list from every entity with a
   * `components.voxel`, nearest `MAX_VOX_INSTANCES` (16) to `cam` win when
   * there are more candidates than that (insertion-selection into fixed-size
   * scratch - same no-allocation pattern as `lighting.js`'s
   * `selectCpuLights`). The entity ref array itself is rebuilt only when
   * `world.renderVersion` changes (mirrors `SpritePool.collect`); `cam` may
   * be omitted (falls back to distance from the origin) for callers that
   * only ever have <= 16 voxel entities and don't care about the ordering.
   */
  collect(world, cam) {
    this.beginFrame();
    if (!world) return;
    if (world !== this._entWorld || world.renderVersion !== this._entVersion) {
      this._ents.length = 0;
      world.forEachEntity((e) => { if (e.components && e.components.voxel) this._ents.push(e); });
      this._entVersion = world.renderVersion;
      this._entWorld = world;
    }
    const ents = this._ents;
    const n = ents.length;
    if (n <= MAX_VOX_INSTANCES) {
      for (let i = 0; i < n; i++) this._queueEntity(ents[i]);
      return;
    }
    const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0, cz = cam ? cam.z : 0;
    const idx = this._nearIdx, dist = this._nearDist;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const t = ents[i].transform;
      const dx = t.x - cx, dy = t.y - cy, dz = t.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (count < MAX_VOX_INSTANCES) {
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

  /** Poses and culls this frame's queued instances via the shared
   * `instanceRect` step (architecture.md 15.2 item 2: castModels and the
   * pool must be able to never disagree), compacting survivors into
   * `this.list` in queue order (slot = compact index). Zero allocation once
   * `raw`/`list` are warm (reused per-slot objects/typed arrays). */
  project(cam, rt) {
    computeProjection(cam, rt, _proj);
    this.eyeX = _proj.eyeX; this.eyeY = _proj.eyeY; this.eyeZ = _proj.eyeZ;
    let count = 0;
    let culled = 0;
    for (let i = 0; i < this._rawCount; i++) {
      const inst = this.raw[i];
      let out = this.list[count];
      if (!out) {
        out = { model: null, modelKey: '', x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, slot: 0,
          pose: new Float64Array(MAX_VOX_PARTS * PART_STRIDE),
          rect: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, minCol: 0, maxCol: 0, minRow: 0, maxRow: 0, empty: false } };
        this.list[count] = out;
      }
      instanceRect(_proj, inst.model, inst, out.pose, null, out.rect);
      if (out.rect.empty) { culled++; continue; }
      out.model = inst.model; out.modelKey = inst.modelKey;
      out.x = inst.x; out.y = inst.y; out.z = inst.z; out.yawDeg = inst.yawDeg;
      out.clip = inst.clip; out.frame = inst.frame; out.tMs = inst.tMs;
      out.slot = count;
      count++;
    }
    this.list.length = count;
    this.stats.count = count;
    this.stats.instancesCulled = culled + Math.max(0, this._rawCount - MAX_VOX_INSTANCES);
  }
}
