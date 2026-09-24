// engine/render/voxelPool.js - US-040 `VoxelPool` (architecture.md 15.2
// item 1/2): the per-frame voxel-model instance list, shared by `castModels`
// (the CPU oracle) and the GPU voxel pass (`GpuCellPipeline.bindVoxels` /
// `VoxelTextures.writeInstanceRows`, US-040 build-order step 2). Binding
// entities (`collect(world)`) is US-041a; US-040 only has the test/dev
// harness feed `pushInstance(...)`.

import { MAX_VOX_INSTANCES, MAX_VOX_PARTS, PART_STRIDE } from '../voxel/VoxelModel.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { computeProjection, instanceRect } from '../voxel/instanceRect.js';

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
  }

  /** Packs every `ModelDef.voxel` in the registry (bind time, may allocate -
   * not a hot path). `table` is a bound MaterialTable (`table.idFor`). */
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
    let slot = this.raw[this._rawCount];
    if (!slot) { slot = {}; this.raw[this._rawCount] = slot; }
    slot.model = pm;
    slot.modelKey = modelKey;
    slot.x = x; slot.y = y; slot.z = z;
    slot.yawDeg = yawDeg || 0;
    slot.clip = clip === undefined ? -1 : clip;
    slot.frame = frame || 0;
    slot.tMs = tMs || 0;
    this._rawCount++;
  }

  /** Poses and culls this frame's queued instances via the shared
   * `instanceRect` step (architecture.md 15.2 item 2: castModels and the
   * pool must be able to never disagree), compacting survivors into
   * `this.list` in queue order (slot = compact index). Zero allocation once
   * `raw`/`list` are warm (reused per-slot objects/typed arrays). */
  project(cam, rt) {
    computeProjection(cam, rt, _proj);
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
