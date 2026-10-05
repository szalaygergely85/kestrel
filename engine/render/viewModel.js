// @ts-check
// engine/render/viewModel.js - US-078a (docs/architecture.md 30.1). The first-person view-model layer
// (`engine.viewModel`): up to four held voxel models posed in EYE space, drawn by BOTH mesh twins in the same
// raster pass as the scene, after the scene items and after a depth-buffer-only clear, so it writes the G-buffer
// like any voxel prop (lit, outlined, fogged) and overdraws walls closer than the blade ("never clips").
//
// This module is pure data + math: `load` (load time, may allocate) validates a README 7.4 def and packs it;
// `show`/`hide`/`capture`/`setBob` set the per-frame state; `buildList(cam, pitched)` fills the layer's own
// `DrawList(8)` which `GpuCellPipeline._passRaster` and `compositor.renderWorldMesh` draw. Zero allocation
// after `load` (module/instance scratch only).
//
// Eye space (README 7.4): x right, y BACK (forward = -y), z up, metres, yaw-0 / pitch-0 camera frame at the eye.
// Eye -> world (`eyeToWorld`, one helper for both twins + the trail), with fwd = (sinY, -cosY, 0), right =
// (cosY, sinY, 0), d = -pe.y:  world = eye + pe.x*right + d*fwd + (pe.z + d*tanPitch)*up.
// Pitched cameras use a true yaw/pitch rotation instead, keeping the model and trail screen-locked.
// The d*tanPitch term cancels the first-person pitch shear, so the sword keeps its screen place at any pitch.

import { DrawList, DRAW_VOXEL } from '../mesh/DrawList.js';
import { sharedVoxelMeshCache } from '../mesh/voxelMesh.js';
import { computeVoxelPose, FORWARD, setRot } from '../voxel/voxelPose.js';
import { MAX_VOX_PARTS, PART_STRIDE } from '../voxel/VoxelModel.js';
import { PROJ_NEAR } from './projection.js';

/** G-buffer objectId of the view model (props use 0x8000|k with k < 48, units >= 0x10000). */
export const VM_OBJECT_ID = 0xFFFF;
/** Maximum number of independently shown held-item handles (TORCH-01a, 37.8). */
export const VM_MAX_HANDLES = 4;
/** The model's `zBase` is the eye z minus this (a feet-height stand-in; both twins use the same value). */
export const VM_FEET_BELOW_EYE = 1.6;
const KEY_STRIDE = 7; // t, px, py, pz, rx, ry, rz

/**
 * @typedef {Object} ViewModelLayer   engine.viewModel (createEngine); fb.viewModel + pipeline.bindViewModel(vm)
 * @property {(key:string, def:Object, pool:Object)=>number} load   load time: validate the README 7.4 def, resolve def.model through `pool` (a bound VoxelPool: `models` + `partNamesFor`), pack clip keys into a Float64Array; throws on bad data; returns a handle
 * @property {(h:number, clip:string)=>number} clipId
 * @property {(h:number, mount:string)=>number} mountId
 * @property {(h:number, clip:number, tMs:number, blend:boolean)=>void} show   per rendered frame; blend = key 0 replaced by the captured pose (chain rule)
 * @property {(h?:number)=>void} hide   omitted handle hides all items
 * @property {(h:number)=>void} capture   snapshot of the last shown pose = the blend source
 * @property {(phase:number, amount:number, h?:number)=>void} setBob   def.bob numbers; shared phase = eyeFeel bobPhase, amount 0..1; omitted handle sets every item
 * @property {(h:number, clip:number, tMs:number, mount:number, out3:Float64Array)=>Float64Array} mountEye   pure: eye-space mount at a clip time (no bob)
 * @property {(cam:Object, pe:ArrayLike<number>, out3:Float64Array)=>Float64Array} eyeToWorld
 * @property {(cam:Object, pitched:boolean)=>(DrawList|null)} buildList   the list both twins draw; null only when no model is bound (hidden - e.g. before the sword is taken); draws under a pitched camera too since RE-02b/D-029 (BUG-VM-001)
 * @property {{visible:boolean, items:number}} stats
 */

/** @param {any} v @param {string} what */
function assertVec3(v, what) {
  if (!v || v.length !== 3) throw new Error(`viewModel: ${what} must be [x,y,z]`);
  for (let i = 0; i < 3; i++) if (typeof v[i] !== 'number' || !Number.isFinite(v[i])) throw new Error(`viewModel: ${what}[${i}] is not a finite number`);
}

/**
 * @typedef {Object} VmDef  one loaded view model
 * @property {string} key
 * @property {any} pm
 * @property {any} mesh
 * @property {number} partCount
 * @property {Float64Array} forward  FORWARD per part (A 3x3 row-major, b 3), model voxel -> metres around the anchor
 * @property {Float64Array} keys  KEY_STRIDE per key, all clips back to back
 * @property {Int32Array} clipOff  first key index per clip
 * @property {Int32Array} clipN
 * @property {Uint8Array} clipLoop
 * @property {Float64Array} clipEnd  last key t
 * @property {string[]} clipNames
 * @property {string[]} mountNames
 * @property {Float64Array} mountAt  3 per mount (voxels)
 * @property {Int32Array} mountPart
 * @property {Float64Array} rest  pos3, rot3
 * @property {boolean} visible
 * @property {Float64Array} last  last shown pose (no bob): pos3, rot3
 * @property {Float64Array} cap  captured pose = this handle's blend source
 * @property {number} bobAmount
 * @property {number} bobZ @property {number} bobX @property {number} bobRoll
 */

class ViewModelLayerImpl {
  constructor() {
    /** @type {VmDef[]} */
    this._defs = [];
    this.list = new DrawList(8);
    this.stats = { visible: false, items: 0 };
    this._pose = new Float64Array(6);     // scratch
    this._bobPhase = 0;
    this._Aw = new Float64Array(9);
    this._R = new Float64Array(9);
    this._E = new Float64Array(9);
    this._e = new Float64Array(3);
    this._pitched = false; // latched once per buildList() call; eyeToWorld/mountEye's trail path reads this
    // so the trail and the model agree on the eye->world convention every frame (BUG-VM-001).
  }

  load(key, def, pool) {
    if (this._defs.length >= VM_MAX_HANDLES) throw new Error(`viewModel.load('${key}'): at most ${VM_MAX_HANDLES} handles`);
    if (!def || typeof def !== 'object') throw new Error(`viewModel.load('${key}'): def missing`);
    if (typeof def.model !== 'string') throw new Error(`viewModel.load('${key}'): def.model must be a model key`);
    const pm = pool && pool.models && pool.models.get(def.model);
    if (!pm) throw new Error(`viewModel.load('${key}'): model '${def.model}' is not a bound voxel model`);
    if (pm.partCount > MAX_VOX_PARTS) throw new Error(`viewModel.load('${key}'): too many parts`);
    if (!def.depth || typeof def.depth.near !== 'number' || !(def.depth.near >= PROJ_NEAR)) {
      throw new Error(`viewModel.load('${key}'): depth.near must be a number >= PROJ_NEAR (${PROJ_NEAR})`);
    }
    if (!def.rest) throw new Error(`viewModel.load('${key}'): rest missing`);
    assertVec3(def.rest.pos, 'rest.pos'); assertVec3(def.rest.rot, 'rest.rot');
    const clipNames = Object.keys(def.clips || {});
    if (clipNames.length === 0) throw new Error(`viewModel.load('${key}'): no clips`);
    let total = 0;
    for (const cn of clipNames) {
      const c = def.clips[cn];
      if (!c || !Array.isArray(c.keys) || c.keys.length === 0) throw new Error(`viewModel.load('${key}'): clip '${cn}' has no keys`);
      total += c.keys.length;
    }
    const keys = new Float64Array(total * KEY_STRIDE);
    const clipOff = new Int32Array(clipNames.length), clipN = new Int32Array(clipNames.length);
    const clipLoop = new Uint8Array(clipNames.length), clipEnd = new Float64Array(clipNames.length);
    let ki = 0;
    for (let ci = 0; ci < clipNames.length; ci++) {
      const cn = clipNames[ci], c = def.clips[cn];
      clipOff[ci] = ki; clipN[ci] = c.keys.length; clipLoop[ci] = c.loop ? 1 : 0;
      let prevT = -Infinity;
      for (let i = 0; i < c.keys.length; i++, ki++) {
        const k = c.keys[i];
        if (!k || typeof k.t !== 'number' || !Number.isFinite(k.t)) throw new Error(`viewModel.load('${key}'): clip '${cn}' key ${i}: t must be a number`);
        if (!(k.t > prevT)) throw new Error(`viewModel.load('${key}'): clip '${cn}' key ${i}: t must increase`);
        prevT = k.t;
        assertVec3(k.pos, `clip '${cn}' key ${i} pos`); assertVec3(k.rot, `clip '${cn}' key ${i} rot`);
        const o = ki * KEY_STRIDE;
        keys[o] = k.t;
        for (let a = 0; a < 3; a++) { keys[o + 1 + a] = k.pos[a]; keys[o + 4 + a] = k.rot[a]; }
      }
      clipEnd[ci] = prevT;
    }
    // FORWARD per part from the shared pose code (identity placement, the model's own 'held' clip if it has one).
    const partCount = pm.partCount;
    const scratch = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
    const heldClip = pm.clipIndex && pm.clipIndex.held !== undefined ? pm.clipIndex.held : -1;
    computeVoxelPose(pm, { x: 0, y: 0, z: 0, yawDeg: 0, clip: heldClip, frame: 0, tMs: 0 }, scratch);
    const forward = new Float64Array(partCount * 12);
    for (let i = 0; i < partCount * 12; i++) forward[i] = FORWARD[i];
    const mountNames = Object.keys(pm.mounts || {});
    const mountAt = new Float64Array(mountNames.length * 3), mountPart = new Int32Array(mountNames.length);
    for (let i = 0; i < mountNames.length; i++) {
      const m = pm.mounts[mountNames[i]];
      mountAt[i * 3] = m.at[0]; mountAt[i * 3 + 1] = m.at[1]; mountAt[i * 3 + 2] = m.at[2];
      mountPart[i] = m.partIdx;
    }
    const partNames = pool.partNamesFor(def.model);
    const mesh = sharedVoxelMeshCache.get(pm, def.model, partNames);
    const bob = def.bob || {};
    const rest = new Float64Array(6);
    for (let a = 0; a < 3; a++) { rest[a] = def.rest.pos[a]; rest[3 + a] = def.rest.rot[a]; }
    this._defs.push({
      visible: false, last: new Float64Array(6), cap: new Float64Array(6), bobAmount: 0,
      key, pm, mesh, partCount, forward, keys, clipOff, clipN, clipLoop, clipEnd, clipNames, mountNames, mountAt, mountPart, rest,
      bobZ: Number.isFinite(bob.z) ? bob.z : 0, bobX: Number.isFinite(bob.x) ? bob.x : 0, bobRoll: Number.isFinite(bob.rollDeg) ? bob.rollDeg : 0,
    });
    return this._defs.length - 1;
  }

  clipId(h, clip) {
    const i = this._defs[h].clipNames.indexOf(clip);
    if (i < 0) throw new Error(`viewModel.clipId: unknown clip '${clip}'`);
    return i;
  }

  mountId(h, mount) {
    const i = this._defs[h].mountNames.indexOf(mount);
    if (i < 0) throw new Error(`viewModel.mountId: unknown mount '${mount}'`);
    return i;
  }

  /**
   * Linear per-component sample of a clip into `out6` (pos3, rot3). Loop clips wrap `tMs mod last.t`, others clamp.
   * `blend` replaces key 0 by `d.cap` (the chain rule).
   */
  _sample(d, clip, tMs, blend, out6) {
    const off = d.clipOff[clip], n = d.clipN[clip], keys = d.keys;
    let t = tMs;
    const end = d.clipEnd[clip];
    if (d.clipLoop[clip] && end > 0) t = t - Math.floor(t / end) * end;
    if (n === 1) {
      const o = off * KEY_STRIDE;
      for (let c = 0; c < 6; c++) out6[c] = (blend ? d.cap[c] : keys[o + 1 + c]);
      return;
    }
    let i = 0;
    while (i < n - 2 && t >= keys[(off + i + 1) * KEY_STRIDE]) i++;
    const a = (off + i) * KEY_STRIDE, b = a + KEY_STRIDE;
    const t0 = keys[a], t1 = keys[b];
    let f = (t - t0) / (t1 - t0);
    if (f < 0) f = 0; else if (f > 1) f = 1;
    const useCap = blend && i === 0;
    for (let c = 0; c < 6; c++) {
      const v0 = useCap ? d.cap[c] : keys[a + 1 + c];
      out6[c] = v0 + (keys[b + 1 + c] - v0) * f;
    }
  }

  show(h, clip, tMs, blend) {
    const d = this._defs[h];
    this._sample(d, clip, tMs, blend, d.last);
    d.visible = true;
    this.stats.visible = true;
  }

  hide(h) {
    if (h === undefined) {
      for (let i = 0; i < this._defs.length; i++) this._defs[i].visible = false;
    } else this._defs[h].visible = false;
    let n = 0;
    for (let i = 0; i < this._defs.length; i++) if (this._defs[i].visible) n++;
    this.stats.visible = n > 0;
    this.stats.items = n;
  }

  capture(h) { const d = this._defs[h]; d.cap.set(d.last); }

  setBob(phase, amount, h) {
    this._bobPhase = phase;
    if (h === undefined) {
      for (let i = 0; i < this._defs.length; i++) this._defs[i].bobAmount = amount;
    } else this._defs[h].bobAmount = amount;
  }

  /** eye-space point of mount `mount` on clip `clip` at `tMs` (no bob, no blend). */
  mountEye(h, clip, tMs, mount, out3) {
    const d = this._defs[h];
    const p = this._pose;
    this._sample(d, clip, tMs, false, p);
    const at = mount * 3, fo = d.mountPart[mount] * 12;
    const ax = d.mountAt[at], ay = d.mountAt[at + 1], az = d.mountAt[at + 2];
    const F = d.forward;
    const mx = F[fo] * ax + F[fo + 1] * ay + F[fo + 2] * az + F[fo + 9];
    const my = F[fo + 3] * ax + F[fo + 4] * ay + F[fo + 5] * az + F[fo + 10];
    const mz = F[fo + 6] * ax + F[fo + 7] * ay + F[fo + 8] * az + F[fo + 11];
    const R = this._R;
    setRot(p[3], p[4], p[5], R);
    out3[0] = R[0] * mx + R[1] * my + R[2] * mz + p[0];
    out3[1] = R[3] * mx + R[4] * my + R[5] * mz + p[1];
    out3[2] = R[6] * mx + R[7] * my + R[8] * mz + p[2];
    return out3;
  }

  /**
   * The eye -> world affine map (see the header): fills `Aw` (3x3 row-major) for `cam`.
   * `pitched` false (default/RTS shear camera, RE-02a's "shear" projection): unchanged shear math - the
   * d*tanPitch term cancels the first-person pitch shear so the view model keeps its screen place at any pitch.
   * `pitched` true (RE-02b/D-029's rotating mesh-pitched camera, the shipped default first-person mode): a true
   * yaw*pitch rotation instead - a shear doesn't rotate the view model's own geometry with pitch, it would swim
   * as the player looks up/down (BUG-VM-001, architect decision 2026-10-03).
   */
  _eyeMap(cam, Aw, pitched) {
    const yaw = (cam.yawDeg * Math.PI) / 180;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    if (pitched) {
      const pitchRad = (cam.pitchDeg * Math.PI) / 180;
      const sp = Math.sin(pitchRad), cp = Math.cos(pitchRad);
      Aw[0] = c; Aw[1] = -s * cp; Aw[2] = -s * sp;
      Aw[3] = s; Aw[4] = c * cp; Aw[5] = c * sp;
      Aw[6] = 0; Aw[7] = -sp; Aw[8] = cp;
      return;
    }
    const tp = Math.tan((cam.pitchDeg * Math.PI) / 180);
    Aw[0] = c; Aw[1] = -s; Aw[2] = 0;
    Aw[3] = s; Aw[4] = c; Aw[5] = 0;
    Aw[6] = 0; Aw[7] = -tp; Aw[8] = 1;
  }

  /** Uses the layer's own latched `this._pitched` (set once per frame by `buildList`) so the trail (this + `mountEye`,
   * called from `swordView.js`'s `drawTrail`) and the model (`buildList`) agree on the same eye->world convention. */
  eyeToWorld(cam, pe, out3) {
    const Aw = this._Aw;
    this._eyeMap(cam, Aw, this._pitched);
    const x = pe[0], y = pe[1], z = pe[2];
    out3[0] = cam.x + Aw[0] * x + Aw[1] * y + Aw[2] * z;
    out3[1] = cam.y + Aw[3] * x + Aw[4] * y + Aw[5] * z;
    out3[2] = cam.z + Aw[6] * x + Aw[7] * y + Aw[8] * z;
    return out3;
  }

  buildList(cam, pitched) {
    const list = this.list;
    list.begin();
    // Latch once per call (not only on the taken branch): `eyeToWorld`/the trail read `this._pitched` every
    // frame regardless of whether the model itself is currently shown (BUG-VM-001 architect decision).
    this._pitched = !!pitched;
    // Only gate on "no model bound" (nothing to draw, e.g. before the sword is picked up) - the pitched camera
    // is the mesh renderer's own default first-person mode since RE-02b/D-029, not a reason to hide the layer.
    const Aw = this._Aw, R = this._R, E = this._E, e = this._e, p = this._pose;
    this._eyeMap(cam, Aw, this._pitched);
    for (let h = 0; h < this._defs.length; h++) {
      const d = this._defs[h];
      if (!d.visible) continue;
      p.set(d.last);
      // walk bob: z +- bobZ sin(phase), x +- bobX sin(phase/2), roll (ry) +- bobRoll sin(phase/2); scaled by amount
      const amt = d.bobAmount;
      if (amt > 0) {
        p[2] += d.bobZ * Math.sin(this._bobPhase) * amt;
        const h2 = Math.sin(this._bobPhase * 0.5) * amt;
        p[0] += d.bobX * h2;
        p[4] += d.bobRoll * h2;
      }
      setRot(p[3], p[4], p[5], R);
      const item = list.push(d.mesh, DRAW_VOXEL);
      const F = d.forward, pm = item.partMatrices;
      for (let q = 0; q < d.partCount; q++) {
        const fo = q * 12;
        // E = R * Fa, e = R * Fb + pos
        for (let r = 0; r < 3; r++) {
          const r0 = R[r * 3], r1 = R[r * 3 + 1], r2 = R[r * 3 + 2];
          E[r * 3] = r0 * F[fo] + r1 * F[fo + 3] + r2 * F[fo + 6];
          E[r * 3 + 1] = r0 * F[fo + 1] + r1 * F[fo + 4] + r2 * F[fo + 7];
          E[r * 3 + 2] = r0 * F[fo + 2] + r1 * F[fo + 5] + r2 * F[fo + 8];
          e[r] = r0 * F[fo + 9] + r1 * F[fo + 10] + r2 * F[fo + 11] + p[r];
        }
        // world: A = Aw * E, b = Aw * e + eye
        const o = q * 12;
        for (let r = 0; r < 3; r++) {
          const a0 = Aw[r * 3], a1 = Aw[r * 3 + 1], a2 = Aw[r * 3 + 2];
          pm[o + r * 3] = a0 * E[0] + a1 * E[3] + a2 * E[6];
          pm[o + r * 3 + 1] = a0 * E[1] + a1 * E[4] + a2 * E[7];
          pm[o + r * 3 + 2] = a0 * E[2] + a1 * E[5] + a2 * E[8];
        }
        pm[o + 9] = Aw[0] * e[0] + Aw[1] * e[1] + Aw[2] * e[2] + cam.x;
        pm[o + 10] = Aw[3] * e[0] + Aw[4] * e[1] + Aw[5] * e[2] + cam.y;
        pm[o + 11] = Aw[6] * e[0] + Aw[7] * e[1] + Aw[8] * e[2] + cam.z;
        // The GPU uploads float32 model matrices: round here so the JS twin rasterises the exact same matrix (fewer
        // sub-pixel coverage ties between the twins).
        for (let c = 0; c < 12; c++) pm[o + c] = Math.fround(pm[o + c]);
        item.partFlags[q] = 0;
      }
      item.planeIdOr = 0xF << 24;
      item.objectId = VM_OBJECT_ID - h;
      item.zBase = cam.z - VM_FEET_BELOW_EYE;
    }
    this.stats.items = list.count;
    this.stats.visible = list.count > 0;
    return list.count > 0 ? list : null;
  }
}

/** @returns {ViewModelLayer} a fresh, empty (hidden) layer. */
export function createViewModelLayer() {
  return /** @type {any} */ (new ViewModelLayerImpl());
}
