// ME-16c (note 38.22): device-only point-light shadow maps, the caster side. One depth24+sampled 2D-array texture, layer = slot*6 + face
// (face order shadowPoint.js FACE_TABLE: +X,-X,+Y,-Y,+Z,-Z), one cached per-layer target each. Not sampled yet (light pass = ME-16d/e).
// Plug-in (WgCellPipeline, ME-16e), all objects built once, zero allocation per frame:
//   const ps = new WgPointShadowPass(device, { pointShadows: opts, level, casters: sunPass /* WgShadowPass: pipelines + buffers shared */ });
//   per frame, AFTER sun.run(p, raster):  ps.run(p, raster);   light pass: ps.depthTex (kind 'depthArray'), ps.origins (xyz + far per slot), ps.slotLight[s], ps.ready[s]
// Per frame: selectShadowLights -> stable slots; per slot the caster list = buildShadowList(box planes origin +- radius, src.eye = origin, src.gpu = null) and a
// key = pointShadowKey(quantised origin, radius, shadowInputHash(list), structVersion, wind). Unchanged key = skip (wall torches render once). Changed slots
// queue: moving/entity-carried first, the rest round-robin from `rr`; WHOLE lights (6 faces) until `faceCap` faces are spent (the first light always renders).
// Per face the item index scratch is filled by classifyAABB(facePlanes) (never DrawList.cull per face) and WgShadowPass.renderCasters draws it.
// Instanced groups write engine-owned `g.shadowIb` while the list is built, so a slot whose list holds instanced casters is rebuilt right before it renders.
import { WgShadowPass } from './passShadow.js';
import { createShadowList, buildShadowList } from '../../../mesh/shadowList.js';
import { shadowInputHash } from '../../shadowSun.js';
import { classifyAABB, CULL_OUT } from '../../../mesh/culling.js';
import { DRAW_INSTANCED } from '../../../mesh/DrawList.js';
import { terrainMeshSetFor } from '../../../mesh/terrainMesh.js';
import { windShadowKey } from '../../../mesh/sway.js';
import { resolvePointShadowOptions, createShadowLightState, selectShadowLights, pointFaceMatrix, pointFacePlanes, pointShadowKeyO, quantiseOrigin } from '../../shadowPoint.js';
import { WG_PASS_SLOT, wgSpanBegin, wgSpanEnd } from '../device/WebGpuTimer.js';

const RING_RESERVE = 160; // uniform-ring slots left for the passes after the point shadows (resolve/light/shade/edge/sprites/overlays)
const IDENT =new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export class WgPointShadowPass {
  /** @param {any} device @param {{pointShadows?: any, level?: string, casters?: WgShadowPass, buffers?: any}} [opts] */
  constructor(device, opts = {}) {
    this.device = device;
    const o = this.opts = resolvePointShadowOptions(opts.pointShadows, opts.level);
    this.n = o.n; this.enabled = o.n > 0;
    this.active = false; this.renders = 0; this.skips = 0; this.facesRendered = 0;
    this.stats = { slots: 0, faces: 0, draws: 0, cpuMs: 0 };
    this.depthTex = null; this.targets = []; this.ownCasters = false; this.casters = null;
    const m = Math.max(1, o.n);
    this.state = createShadowLightState(m);
    this.slotLight = new Int32Array(m).fill(-1);      // light handle per slot this frame (-1 = free)
    this.ready = new Uint8Array(m);                   // the slot's 6 layers hold a valid map for its current holder
    this.origins = new Float32Array(m * 4);           // build origin xyz + far per slot (what the faces are being rendered with)
    this.renderedOrigins = new Float32Array(m * 4);   // light-pass uniforms: origin of the layers that are actually complete (written only when all 6 faces are in)
    this.keys = new Int32Array(m * 2); this.pendKey = new Int32Array(m * 2);
    this.keyValid = new Uint8Array(m); this.keyHolder = new Int32Array(m).fill(-1);
    this.dirty = new Uint8Array(m); this.moving = new Uint8Array(m); this.hasInst = new Uint8Array(m);
    this.faceMask = new Uint8Array(m); this.partKey = new Int32Array(m * 2); this.partHolder = new Int32Array(m); this.ringSkips = 0; this.lastFaceDraws = 0; // faces done for the pending key (bit f), resumed across frames when the uniform ring is short
    this.rr = 0; this._lastBuilt = -1;
    this.lists = []; this.key2 = new Int32Array(2); this.hash3 = new Int32Array(3);
    this.O = new Float64Array(4); this.M = new Float64Array(16); this.planes = new Float64Array(24); this.box = new Float64Array(24); // O = xyz + radius (pointShadowKeyO reads it: no boxed-double args)
    this.idx = null; this.cam = { x: 0, y: 0, z: 0, planes: null };
    this.src = { centre: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 0 }, meshLod0M: 25, instCastM: 6, cache: null, terrainSet: null, voxelPool: null, voxelMeshCache: undefined, fogFarM: 2000, instances: null, cloths: null, matIdFor: undefined, meshCache: null, meshIdFor: undefined, maskAtlas: null, gpu: /** @type {any} */ (null) };
    if (!this.enabled) return;
    try {
      this.casters = opts.casters || null;
      if (!this.casters) { this.casters = new WgShadowPass(device, { shadows: { sun: 'off' }, casters: true, buffers: opts.buffers, gpuCull: false }); this.ownCasters = true; }
      if (!this.casters.staticPipe) throw new Error('WgPointShadowPass: caster pipelines missing');
      this.src.voxelMeshCache = this.casters.src.voxelMeshCache;
      for (let s = 0; s < o.n; s++) this.lists.push(createShadowList());
      this.idx = new Uint16Array(this.lists[0].items.length);
      this.depthTex = device.createTexture({ format: 'depth24', width: o.res, height: o.res, sampled: true, layers: o.n * 6 });
      for (let l = 0; l < o.n * 6; l++) this.targets.push(device.createTarget({ color: [], depth: this.depthTex, layer: l }));
    } catch (e) { this.dispose(); throw e; }
  }

  /** Box planes (inside n.p + d >= 0) of origin +- r into this.box. */
  _boxPlanes(x, y, z, r) {
    const b = this.box;
    b[0] = 1; b[1] = 0; b[2] = 0; b[3] = -(x - r); b[4] = -1; b[5] = 0; b[6] = 0; b[7] = x + r;
    b[8] = 0; b[9] = 1; b[10] = 0; b[11] = -(y - r); b[12] = 0; b[13] = -1; b[14] = 0; b[15] = y + r;
    b[16] = 0; b[17] = 0; b[18] = 1; b[19] = -(z - r); b[20] = 0; b[21] = 0; b[22] = -1; b[23] = z + r;
    return b;
  }

  /** Per-frame source fields shared by every slot (same inputs as the sun pass). */
  _fillSrc(p, raster, world) {
    const src = this.src, so = this.casters.shadowOpts;
    src.cache = raster.levelCache;
    src.terrainSet = p.terrainEnabled && world.terrain ? terrainMeshSetFor(world.terrain) : null;
    const vp = p._voxelPool; src.voxelPool = vp && vp.shadowView ? vp.shadowView : null;
    src.instances = p._instances || null;
    src.meshLod0M = so.meshLod0M; src.meshCastM = so.meshCastM; src.meshCastCap = so.meshCastCap;
    src.cloths = world.cloths && world.cloths.count > 0 ? world.cloths : null;
    src.matIdFor = p._table ? p._table.idFor : undefined;
    src.meshCache = raster.meshCache; src.meshIdFor = raster.strictMatIdFor || undefined;
    src.maskAtlas = world.maskAtlas || null;
  }

  /** Build slot s's caster list; returns its 2-lane key (this.key2). Leaves the slot origin in this.O. */
  _build(s, raster, world, lights, tSec) {
    const h = this.state.slots[s], src = this.src, O = this.O, q = this.opts.originQ, list = this.lists[s];
    const ox = quantiseOrigin(lights.defX[h], q), oy = quantiseOrigin(lights.defY[h], q), oz = quantiseOrigin(lights.defZ[h], q), r = lights.pos[h * 4 + 3];
    O[0] = ox; O[1] = oy; O[2] = oz; O[3] = r;
    const c = src.centre; c.x = ox; c.y = oy; c.z = oz; src.eye.x = ox; src.eye.y = oy; src.instCastM = r; src.fogFarM = r + 128;
    buildShadowList(list, raster.list, world, this._boxPlanes(ox, oy, oz, r), src);
    this._lastBuilt = s;
    let inst = 0; for (let i = 0; i < list.count; i++) if (list.items[i].type === DRAW_INSTANCED) { inst = 1; break; }
    this.hasInst[s] = inst;
    const hs = shadowInputHash(list, IDENT, 0, this.hash3, undefined, 0);
    return pointShadowKeyO(this.key2, O, hs[0], hs[1], world.structVersion | 0, inst ? windShadowKey(world.wind, tSec) : 0, q);
  }

  /**
   * Render the missing faces of slot s (its list and this.O are current). The device uniform ring (one per frame, fixed size) is shared with
   * every other pass, so each face first checks its worst-case draw count against the ring headroom (minus RING_RESERVE for the cell passes);
   * a face that does not fit stops the slot and resumes next frame (faceMask keeps the finished faces). @returns {number} faces rendered now
   */
  _renderSlot(s, world) {
    const list = this.lists[s], O = this.O, far = this.origins[s * 4 + 3], M = this.M, pl = this.planes, idx = this.idx, items = list.items, cs = this.casters;
    const ring = this.device.uniformRing; let done = 0;
    for (let f = 0; f < 6; f++) {
      if (this.faceMask[s] & (1 << f)) continue;
      pointFaceMatrix(O, far, f, M); pointFacePlanes(O, far, f, pl);
      let k = 0;
      for (let i = 0; i < list.count; i++) { const a = items[i].aabb; if (classifyAABB(pl, a[0], a[1], a[2], a[3], a[4], a[5]) !== CULL_OUT) idx[k++] = i; }
      if (ring && Math.max(k + (k >> 1) + 4, this.lastFaceDraws) > ring.slots - ring.usedSlots - RING_RESERVE) { this.ringSkips++; break; } // masked ranges can split an item into several draws
      cs.renderCasters(this.targets[s * 6 + f], M, list, world, idx, k, false, s + 1); // consumer s+1: its own GPU instance copy (sun = 0)
      this.stats.draws += cs.draws; this.lastFaceDraws = cs.draws; this.faceMask[s] |= 1 << f; done++;
    }
    this.facesRendered += done; this.stats.faces += done;
    return done;
  }

  /** @returns {boolean} any slot holds a shadow map (see `ready`) */
  run(p, raster) {
    this.active = false;
    const st = this.stats; st.slots = 0; st.faces = 0; st.draws = 0;
    if (!this.enabled) return false;
    const lights = p._light, world = p._world, cam = p._cam;
    if (!lights || !lights.defX || !world || !cam || !raster) return false;
    const timing = p._passTimingOn === true, t0 = timing ? performance.now() : 0, n = this.n, state = this.state, cs = this.casters, c = this.cam;
    c.x = cam.x; c.y = cam.y; c.z = cam.z;
    selectShadowLights(lights, c, n, state, this.opts.hysteresis);
    cs._world = world; cs._raster = raster;
    let tSec = 0; const fb = p._fb; if (fb) { const v = fb.timeSec; if (v) tSec = v; }
    this._fillSrc(p, raster, world);
    // pass 1: lists + keys, mark dirty / moving
    let nDirty = 0;
    for (let s = 0; s < n; s++) {
      const h = state.slots[s]; this.slotLight[s] = h; this.dirty[s] = 0; this.moving[s] = 0;
      if (h < 0) { this.ready[s] = 0; this.keyValid[s] = 0; this.keyHolder[s] = -1; this.faceMask[s] = 0; continue; }
      const key = this._build(s, raster, world, lights, tSec); st.slots++;
      const o = s * 4; this.origins[o] = this.O[0]; this.origins[o + 1] = this.O[1]; this.origins[o + 2] = this.O[2]; this.origins[o + 3] = lights.pos[h * 4 + 3];
      const sameHolder = this.keyValid[s] === 1 && this.keyHolder[s] === h;
      if (sameHolder && this.keys[s * 2] === key[0] && this.keys[s * 2 + 1] === key[1]) { this.skips++; continue; }
      if (!sameHolder) this.ready[s] = 0; // new holder: the old layers show another light
      if (this.faceMask[s] !== 0 && (this.partHolder[s] !== h || this.partKey[s * 2] !== key[0] || this.partKey[s * 2 + 1] !== key[1])) this.faceMask[s] = 0; // inputs changed mid-way: start over
      this.partKey[s * 2] = key[0]; this.partKey[s * 2 + 1] = key[1]; this.partHolder[s] = h;
      this.dirty[s] = 1; nDirty++;
      this.moving[s] = sameHolder || (lights.entity && lights.entity[h]) ? 1 : 0; // key moved under the same holder, or a carried light: first in the queue
      this.pendKey[s * 2] = key[0]; this.pendKey[s * 2 + 1] = key[1];
    }
    // pass 2: spend the face budget (moving first, then round-robin), whole lights; the first light always renders
    if (nDirty > 0) {
      let spent = 0;
      wgSpanBegin(p, WG_PASS_SLOT.pshadow !== undefined ? WG_PASS_SLOT.pshadow : WG_PASS_SLOT.shadow);
      try {
        for (let ph = 0; ph < 2; ph++) {
          for (let k = 0; k < n; k++) {
            const s = ph === 0 ? k : (this.rr + k) % n;
            if (!this.dirty[s] || (ph === 0) !== (this.moving[s] === 1)) continue;
            if (spent > 0 && spent + 6 > this.opts.faceCap) continue;
            if (this._lastBuilt !== s && this.hasInst[s]) this._build(s, raster, world, lights, tSec); // restores this slot's g.shadowIb banding
            else { this.O[0] = this.origins[s * 4]; this.O[1] = this.origins[s * 4 + 1]; this.O[2] = this.origins[s * 4 + 2]; }
            const nf = this._renderSlot(s, world); spent += nf;
            if (this.faceMask[s] !== 63) break; // ring ran short: resume next frame
            this.faceMask[s] = 0;
            this.keys[s * 2] = this.pendKey[s * 2]; this.keys[s * 2 + 1] = this.pendKey[s * 2 + 1];
            const o4 = s * 4; for (let q = 0; q < 4; q++) this.renderedOrigins[o4 + q] = this.origins[o4 + q]; // commit the origin with the keys: all 6 faces are in
            this.keyValid[s] = 1; this.keyHolder[s] = state.slots[s]; this.ready[s] = 1; this.dirty[s] = 0; this.renders++;
            if (ph === 1) this.rr = (s + 1) % n;
          }
        }
      } finally { wgSpanEnd(p); }
    }
    for (let s = 0; s < n; s++) if (this.ready[s]) this.active = true;
    st.cpuMs = timing ? performance.now() - t0 : 0; // boxed doubles: only while pass timing is on
    return this.active;
  }

  dispose() {
    const d = this.device;
    for (const t of this.targets) d.dispose(t);
    this.targets.length = 0;
    if (this.depthTex) { d.dispose(this.depthTex); this.depthTex = null; }
    if (this.ownCasters && this.casters) this.casters.dispose();
    this.casters = null; this.active = false;
  }
}
