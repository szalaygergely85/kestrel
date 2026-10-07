// WG-2a (docs/architecture.md 38.1, 38.4, 38.6, 38.8a): the device-only WebGPU cell pipeline, step 1 = skeleton.
// Same public surface as GpuCellPipeline (constructor(rt, opts), ready, stats, PASS_NAMES, frame, bind, bindVoxels,
// bindViewModel, bindInstances, resizeGrid, setEnabled, setPassTiming, setDebugMode, readback*, dispose) but it talks
// ONLY to `this.device.*` (rt.device); no navigator.gpu / GPU* here (check-deps rule 17).
//
// What exists in WG-2a: the G-buffer targets (targets.js) and a debug view of them (wgsl/debug.wgsl.js) written into the
// render target's fg/bg textures from the cell-pass hook (RenderTargetWebGPU.present -> _cellPass). No world pass is ported
// yet (mesh raster = WG-2b, shade/edge/light = WG-3), so the G-buffer stays at its cleared value and:
//  - `ready` = "skeleton built, targets allocated, device not lost" (honest: it does NOT mean the scene is rendered);
//  - `portedPasses` lists the passes that really run (only 'debug' for now); `frameComplete` stays false until WG-3,
//    main.js must not drop the CPU shading (rt.gpuActive stays false, this class never sets it);
//  - passes not ported are throw-free no-ops; the hook only draws when a debug mode is set (`?gpudebug=`).
import { allocWgTargets, freeWgTargets } from './targets.js';
import { DEBUG_BLOCK, DEBUG_WGSL, DEBUG_TEXTURES } from '../wgsl/debug.wgsl.js';

// Same list/order as GpuCellPipeline.PASS_NAMES (stats.passMs* line up with it).
export const PASS_NAMES = Object.freeze(['cast', 'terrain', 'voxel', 'resolve', 'light', 'shade', 'edge', 'shadow', 'water', 'wcomp']);

const DEPTH_FADE_K = 0.05; // debug depth view: 1 / (1 + d * K)
const DEBUG_MODE_WORD = DEBUG_BLOCK.field('mode').word;
const DEBUG_RAYS_WORD = DEBUG_BLOCK.field('rays').word;
const DEBUG_DEPTH_WORD = DEBUG_BLOCK.field('depthK').word;

export class WgCellPipeline {
  /** @param {any} rt a RenderTargetWebGPU @param {{rays?: number, terrainEnabled?: boolean, shadows?: any}} [opts] */
  constructor(rt, opts = {}) {
    this.rt = rt;
    this.device = rt.device;
    this.cols = rt.cols;
    this.rows = rt.rows;
    this.rays = Math.max(1, Math.min(4, Math.round(opts.rays || 1)));
    this.terrainEnabled = opts.terrainEnabled !== false;
    this.renderer = 'mesh';
    this.shadowOpts = opts.shadows || null;
    this.ready = false;
    /** passes that really execute in this build; `frameComplete` = the pipeline can replace the CPU shading entirely */
    this.portedPasses = [];
    this.frameComplete = false;
    this.rendererString = 'webgpu (WG-2a skeleton)';
    // same shape as GpuCellPipeline.stats so F3 / benches read it unchanged
    this.stats = {
      uploadMs: 0, repackMs: 0, drawMs: 0, gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN,
      terrainSubmitMs: NaN, terrainSubmitMsP50: NaN, terrainSubmitMsP95: NaN,
      voxelMs: NaN, voxelMsP50: NaN, voxelMsP95: NaN, voxelInstances: 0, voxelDraws: 0, instancedDraws: 0, instances: 0,
      waterSlots: 0, waterDraws: 0, shadowItems: 0, shadowDraws: 0, shadowCpuMs: 0, instancesCulled: 0, instancesLod1: 0,
      passMsP50: new Float32Array(PASS_NAMES.length).fill(NaN),
      passMsP95: new Float32Array(PASS_NAMES.length).fill(NaN),
    };
    this._passTimingOn = false;
    this.debugMode = -1;
    this._fb = null; this._light = null; this._cam = null; this._world = null;
    this._table = null; this._palette = null;
    this._voxelPool = null; this._viewModel = null; this._instances = null;
    this._enabled = false;
    this._hookFn = () => this._hook();
    this._t = null;
    this._pipeDebug = null;
    this._outTarget = null; this._outFg = null; this._outBg = null;
    this._gbufCleared = false;
    this._clearOpts = { clear: true };
    this._debugU = new Float32Array(DEBUG_BLOCK.sizeWords);
    this._debugTex = [{ slot: 0, texture: null }, { slot: 1, texture: null }, { slot: 2, texture: null }];
    this._debugBind = { uniforms: this._debugU, textures: this._debugTex };
    try {
      this._t = allocWgTargets(this.device, this.cols, this.rows, this.rays);
      this._pipeDebug = this.device.createPipeline({
        vertex: { src: { wgsl: DEBUG_WGSL } },
        fragment: { src: { wgsl: DEBUG_WGSL }, targets: 2 },
        bindings: { uniformBytes: DEBUG_BLOCK.sizeBytes, textures: DEBUG_TEXTURES.slice() },
        targetFormats: ['rgba8', 'rgba8'],
      });
      this.portedPasses.push('debug');
      this.ready = true;
      this.setEnabled(true);
      if (this.device.lost && typeof this.device.lost.then === 'function') {
        this.device.lost.then((info) => { if (!(info && info.reason === 'destroyed')) this._onLost(); });
      }
    } catch (e) {
      console.warn('[WgCellPipeline] init failed:', e);
      this.dispose();
    }
  }

  _onLost() {
    if (!this.ready) return;
    this.ready = false;
    this.setEnabled(false);
    console.warn('[WgCellPipeline] GPU device lost - pipeline disabled, reload the page');
  }

  /** Installs/removes the cell-pass hook. Never touches `rt.gpuActive` (the CPU shading must keep running until WG-3). */
  setEnabled(enabled) {
    if (enabled && !this.ready) return;
    this._enabled = !!enabled;
    if (typeof this.rt.setCellPass === 'function') this.rt.setCellPass(enabled ? this._hookFn : null);
  }

  setPassTiming(on) { this._passTimingOn = !!on; }

  /** 0 kind, 1 planeId, 2 normal, 3 depth (wgsl/debug.wgsl.js); < 0 = off. */
  setDebugMode(mode) {
    this.debugMode = mode;
  }

  /**
   * Re-allocates the grid-sized targets. The new set is built before the old one is freed and committed only on success
   * (a failed alloc leaves the old, still valid, set in place and the pipeline `ready`).
   */
  resizeGrid(cols, rows) {
    if (!this.ready) return;
    let t;
    try {
      t = allocWgTargets(this.device, cols, rows, this.rays);
    } catch (e) {
      console.error('[WgCellPipeline] resizeGrid failed at', `${cols}x${rows}`, '- keeping the old grid:', e);
      return;
    }
    freeWgTargets(this.device, this._t);
    this._t = t;
    this.cols = cols; this.rows = rows;
    this._gbufCleared = false;
    this._dropOutTarget();
  }

  // ---- binders: stored now, consumed by the passes WG-2b..WG-3 add ----
  bind(table, palette) { this._table = table; this._palette = palette; }
  bindVoxels(pool) { this._voxelPool = pool; }
  bindViewModel(vm) { this._viewModel = vm; }
  bindInstances(groups) { this._instances = groups; }
  setWaterLooks(_looks) { /* WG-3 */ }
  setSource(_mode) { /* test-only switch of the GL path; nothing to switch yet */ }

  /** Called once per frame by the main loop before present(): remembers the inputs (no GPU work in WG-2a). */
  frame(fb, light, cam, world) {
    this._fb = fb; this._light = light; this._cam = cam || null; this._world = world || null;
    if (this.device.timer.writeStats) this.device.timer.writeStats(this.stats);
  }

  // ---- readbacks (test-only, never the frame loop): Promises, always `await` (38.6) ----

  /** Async twin of GpuCellPipeline.readbackGeometry: `{GI, GA, Depth}` as 4-wide Uint32Arrays (Depth channel 0 = f32 bits). */
  async readbackGeometry() {
    const t = this._t;
    if (!t) throw new Error('WgCellPipeline.readbackGeometry: no targets');
    if (this.rays > 1) throw new Error('readbackGeometry: rays > 1 needs the WG-3a resolve');
    const n = this.cols * this.rows;
    this._rbGI = this._rbGI && this._rbGI.length === 4 * n ? this._rbGI : new Uint32Array(4 * n);
    this._rbGA = this._rbGA && this._rbGA.length === 4 * n ? this._rbGA : new Uint32Array(4 * n);
    this._rbDepth = this._rbDepth && this._rbDepth.length === 4 * n ? this._rbDepth : new Uint32Array(4 * n);
    this._rbD1 = this._rbD1 && this._rbD1.length === n ? this._rbD1 : new Uint32Array(n);
    const rect = { x: 0, y: 0, w: this.cols, h: this.rows };
    await this.device.readback(t.texSGI, rect, this._rbGI);
    await this.device.readback(t.texSGA, rect, this._rbGA);
    await this.device.readback(t.texSDepth, rect, this._rbD1); // r32uint is 1-wide; GL's RGBA_INTEGER read is 4-wide: spread
    for (let i = 0; i < n; i++) this._rbDepth[i * 4] = this._rbD1[i];
    return { GI: this._rbGI, GA: this._rbGA, Depth: this._rbDepth };
  }

  /** The cells present() sampled (delegates to the render target). */
  async readback() {
    const r = await this.rt.readbackPresent();
    return { fg: r.fg, bg: r.bg };
  }
  // passes not ported yet: resolve to null so a caller's `await` works and can see "nothing here" (no throw)
  async readbackLight() { return null; }
  async readbackWater() { return null; }
  async readbackShadowDepthBits(_out) { return null; }

  // ---- hook (RenderTargetWebGPU.present calls it between the cell upload and its own present pass) ----
  _hook() {
    if (!this.ready || this.debugMode < 0 || !this._t) return;
    const d = this.device, t = this._t, rt = this.rt;
    if (!this._gbufCleared) { // the G-buffer has no writer yet: clear once (and after each resize)
      d.beginPass(t.targetRaster, this._clearOpts);
      d.endPass();
      this._gbufCleared = true;
    }
    if (!this._outTarget || this._outFg !== rt.fgTex || this._outBg !== rt.bgTex) {
      this._dropOutTarget();
      this._outFg = rt.fgTex; this._outBg = rt.bgTex;
      this._outTarget = d.createTarget({ color: [rt.fgTex, rt.bgTex] });
    }
    const u = this._debugU;
    u[DEBUG_MODE_WORD] = this.debugMode;
    u[DEBUG_RAYS_WORD] = this.rays;
    u[DEBUG_DEPTH_WORD] = DEPTH_FADE_K;
    this._debugTex[0].texture = t.texSGI; this._debugTex[1].texture = t.texSGA; this._debugTex[2].texture = t.texSDepth;
    d.beginPass(this._outTarget);
    d.bind(this._pipeDebug, this._debugBind);
    d.draw(3);
    d.endPass();
  }

  _dropOutTarget() {
    if (this._outTarget) { try { this.device.dispose(this._outTarget); } catch (_) { /* best effort */ } }
    this._outTarget = null; this._outFg = null; this._outBg = null;
  }

  dispose() {
    this.ready = false;
    if (this.rt && typeof this.rt.setCellPass === 'function') { try { this.rt.setCellPass(null); } catch (_) { /* best effort */ } }
    this._enabled = false;
    this._dropOutTarget();
    if (this._pipeDebug) { try { this.device.dispose(this._pipeDebug); } catch (_) { /* best effort */ } }
    this._pipeDebug = null;
    freeWgTargets(this.device, this._t);
    this._t = null;
  }
}
