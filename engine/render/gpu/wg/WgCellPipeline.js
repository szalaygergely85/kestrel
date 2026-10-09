// WG-2a/2b (docs/architecture.md 38.1, 38.4, 38.6, 38.8a): device-only WebGPU cell pipeline, geometry first.
// Same public surface as GpuCellPipeline (constructor(rt, opts), ready, stats, PASS_NAMES, frame, bind, bindVoxels,
// bindViewModel, bindInstances, resizeGrid, setEnabled, setPassTiming, setDebugMode, readback*, dispose) but it talks
// ONLY to `this.device.*` (rt.device); no navigator.gpu / GPU* here (check-deps rule 17).
//
// The cell-pass hook writes geometry through passRaster then optionally displays its debug view. Terrain is WG-2c,
// cloth uses the device extra-vertex-stream API.
// WG-3f: bindSprites() builds WgSpritesPass + WgOverlayPass (sprites/particles/fade/dim, then overlay, right after edge, every frame the
// cell pass shaded). Once shadow MAP (3d) + water (3e) + sprites + overlay are wired, `frameComplete` = true: the pipeline sets `rt.gpuActive`
// and the render target PRESENTS the sprite pass output (rt.setPresentCells), so the CPU compositor stops drawing (supersedes the DECISION below).
// WG-3c: after light the cell pass also runs shade + edge into pipeline-owned textures (t.texFinalFg/Bg). DECISION (38.8): the WebGPU
// path keeps PRESENTING the CPU cells (rt.gpuActive false, frameComplete false) until sprites/overlay/water/shadow-map land (WG-3d..3f):
// presenting GPU-shaded cells earlier would drop sprites, overlay, water and map shadows that only the CPU compositor draws. The GPU
// result is observable through readbackCells() (`?gpucompare=1` / `=shade` cell rows).
import { bootNow, span as bootSpan } from '../../../core/bootMarks.js'; // BOOT-SPEED-01
import { allocWgTargets, freeWgTargets } from './targets.js';
import { DEBUG_BLOCK, DEBUG_WGSL, DEBUG_TEXTURES } from '../wgsl/debug.wgsl.js';
import { WgRasterPass } from './passRaster.js';
import { WgCellPass } from './passCell.js';
import { WgShadowPass } from './passShadow.js';
import { WgWaterPass } from './passWater.js';
import { WgSpritesPass } from './passSprites.js';
import { WgOverlayPass } from './passOverlay.js';

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
    this.gpuCull = opts.gpuCull !== false; // WG-4a compute cull of instance batches (`?gpucull=0` = CPU path)
    this.ready = false;
    /** passes that really execute in this build; `frameComplete` = the pipeline can replace the CPU shading entirely */
    this.portedPasses = [];
    this.frameComplete = false;
    /** the sun map holds depth in [0.5, 1] (38.5 item 6): shadowParity converts `(d - 0.5) * 2` before the twin compare */
    this.shadowDepthHalfRange = true;
    this.rendererString = 'webgpu (WG-4b raster+cull+shadow+water+light+shade+edge+sprites+overlay)';
    this._source = 'scene'; // 'upload' = `?gpucompare=shade` test source (CPU G-buffer -> cell-res textures)
    // same shape as GpuCellPipeline.stats so F3 / benches read it unchanged
    this.stats = {
      uploadMs: 0, repackMs: 0, drawMs: 0, gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN,
      terrainSubmitMs: NaN, terrainSubmitMsP50: NaN, terrainSubmitMsP95: NaN,
      voxelMs: NaN, voxelMsP50: NaN, voxelMsP95: NaN, voxelInstances: 0, voxelDraws: 0, meshDraws: 0, vmDraws: 0, clothDraws: 0, instancedDraws: 0, instances: 0,
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
    this._rasterPass = null;
    this._cellPass = null;
    this._shadowPass = null;
    this._waterPass = null;
    this._spritesPass = null; this._overlayPass = null; this._spritesBound = false; this._spritesRan = false;
    this._outTarget = null; this._outFg = null; this._outBg = null;
    this._gbufCleared = false; this._cellsShaded = false;
    this._clearOpts = { clear: true };
    this._debugU = new Float32Array(DEBUG_BLOCK.sizeWords);
    this._debugTex = [{ slot: 0, texture: null }, { slot: 1, texture: null }, { slot: 2, texture: null }];
    this._debugBind = { uniforms: this._debugU, textures: this._debugTex };
    // S8-B1-09b (38.10b): every pass pipeline is created inside ONE compile batch; `compiled` resolves to the per-pipeline list
    // (an `ok:false` entry or a creation throw disables the pipeline). createRenderer awaits it behind the loading card.
    /** @type {Promise<{label: string, ms: number, ok: boolean}[]>} */ this.compiled = Promise.resolve([]);
    const batched = typeof this.device.beginCompileBatch === 'function' && typeof this.device.endCompileBatch === 'function';
    if (batched) this.device.beginCompileBatch();
    try {
      let tp = bootNow();
      this._t = allocWgTargets(this.device, this.cols, this.rows, this.rays);
      bootSpan('WgCellPipeline targets', tp);
      this._pipeDebug = this.device.createPipeline({
        vertex: { src: { wgsl: DEBUG_WGSL } },
        fragment: { src: { wgsl: DEBUG_WGSL }, targets: 2 },
        bindings: { uniformBytes: DEBUG_BLOCK.sizeBytes, textures: DEBUG_TEXTURES.slice() },
        targetFormats: ['rgba8', 'rgba8'],
      });
      tp = bootNow();
      this._rasterPass = new WgRasterPass(this.device, { gpuCull: this.gpuCull });
      bootSpan('pass raster (ctor total)', tp); tp = bootNow();
      this._meshDrawList = this._rasterPass.list;
      this._shadowPass = new WgShadowPass(this.device, { shadows: this.shadowOpts, renderer: this.renderer, buffers: this._rasterPass.buffers, gpuCull: this.gpuCull });
      bootSpan('pass shadow (ctor total)', tp); tp = bootNow();
      this._waterPass = new WgWaterPass(this.device);
      this._waterPass.resize(this.cols, this.rows, this.rays);
      bootSpan('pass water (ctor total)', tp); tp = bootNow();
      this._cellPass = new WgCellPass(this.device, this._shadowPass, this._waterPass);
      bootSpan('pass cell (ctor total)', tp);
      this.shadowOpts = this._shadowPass.shadowOpts; // resolved (GL pipeline exposes the same field)
      this.portedPasses.push('debug', 'raster', 'resolve', 'deriv', 'light', 'shade', 'edge');
      if (this._shadowPass.enabled) this.portedPasses.push('shadow');
      this.portedPasses.push('water');
      if (batched) this.compiled = this._watchCompile(this.device.endCompileBatch());
      this.ready = true;
      this.setEnabled(true);
      if (this.device.lost && typeof this.device.lost.then === 'function') {
        this.device.lost.then((info) => { if (!(info && info.reason === 'destroyed')) this._onLost(); });
      }
    } catch (e) {
      if (batched) { try { this.device.endCompileBatch().catch(() => {}); } catch (_) { /* best effort */ } }
      console.warn('[WgCellPipeline] init failed:', e);
      this.dispose();
    }
  }

  /** Turns a failed compile (any `ok:false`) into `ready=false` + warn; the list itself is passed through. @param {Promise<any[]>} p */
  _watchCompile(p) {
    return p.then((list) => {
      const bad = list.filter((x) => !x.ok);
      if (bad.length) { console.warn('[WgCellPipeline] pipeline compile failed:', bad.map((x) => x.label).join(', ')); this.ready = false; this.setEnabled(false); }
      return list;
    }, (e) => { console.warn('[WgCellPipeline] pipeline compile failed:', e); this.ready = false; this.setEnabled(false); return []; });
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
    this._syncActive();
  }

  /** WG-3f: `frameComplete` + `rt.gpuActive` follow the wiring (rt.gpuActive is left alone while the pipeline was never complete). */
  _syncActive() {
    const complete = !!(this.ready && this._enabled && this._spritesBound && this._spritesPass && this._overlayPass &&
      this._waterPass && this._shadowPass && (this._shadowPass.enabled || this._shadowPass.off) && this._source === 'scene');
    this.frameComplete = complete;
    const rt = this.rt;
    if (complete || rt.gpuActive) rt.gpuActive = complete;
    if (!complete) this._setPresent(null, null);
  }

  _setPresent(fg, bg) { if (typeof this.rt.setPresentCells === 'function') this.rt.setPresentCells(fg, bg); }

  /**
   * WG-3f (mirrors createSpriteSystem + GpuOverlayPass wiring in GL): hands the pipeline the sprite pool/atlas/palette, the particle
   * layer and the overlay. Call once at boot after the CPU-side sprite system exists. False = a pass failed to build (CPU path keeps presenting).
   */
  bindSprites({ pool, atlas, palette, particleLayer, overlay }) {
    if (!this.ready || !pool || !overlay) return false;
    try {
      if (this._spritesPass) this._spritesPass.dispose();
      if (this._overlayPass) this._overlayPass.dispose();
      this._spritesPass = null; this._overlayPass = null;
      const tp = bootNow();
      if (this.device.beginCompileBatch) this.device.beginCompileBatch();
      this._spritesPass = new WgSpritesPass(this.device, { pool, atlas, palette });
      this._spritesPass.resize(this.cols, this.rows);
      if (particleLayer) this._spritesPass.bindParticleLayer(particleLayer);
      this._overlayPass = new WgOverlayPass(this.device, overlay);
      this._overlayPass.resize(this.cols, this.rows);
      this._overlayPass.setTarget(this._spritesPass.outFg);
      bootSpan('bindSprites (sprites + overlay passes)', tp);
      if (this.device.endCompileBatch) {
        const pending = this.device.endCompileBatch();
        // asynchronous devices: the passes only count as wired once their pipelines exist (draw before that would throw)
        if (this.device.compiling) {
          this._spritesBound = false; this._spritesPending = true;
          this.spritesCompiled = this._watchCompile(pending).then((list) => { this._spritesPending = false; if (this.ready) { this._spritesBound = true; this._syncActive(); } return list; });
          if (!this.portedPasses.includes('sprites')) this.portedPasses.push('sprites', 'overlay');
          this._syncActive();
          return true;
        }
      }
    } catch (e) {
      if (this.device.endCompileBatch) { try { this.device.endCompileBatch().catch(() => {}); } catch (_) { /* best effort */ } }
      console.warn('[WgCellPipeline] sprites/overlay init failed (CPU compositor keeps drawing them):', e);
      for (const k of ['_spritesPass', '_overlayPass']) { if (this[k]) { try { this[k].dispose(); } catch (_) { /* best effort */ } this[k] = null; } }
      this._spritesBound = false;
      this._syncActive();
      return false;
    }
    this._spritesBound = true;
    if (!this.portedPasses.includes('sprites')) this.portedPasses.push('sprites', 'overlay');
    this._syncActive();
    return true;
  }

  setPassTiming(on) { this._passTimingOn = !!on; }

  /** 0 kind, 1 planeId, 2 normal, 3 depth (wgsl/debug.wgsl.js); < 0 = off. */
  setDebugMode(mode) {
    this.debugMode = mode;
  }

  /**
   * Re-allocates the grid-sized targets. The new set is built before the old one is freed and committed only on success
   * (a failed alloc keeps the old set but sets `ready=false` + `setEnabled(false)`: rt and pipeline grids must not diverge).
   */
  resizeGrid(cols, rows) {
    if (!this.ready) return;
    let t;
    try {
      t = allocWgTargets(this.device, cols, rows, this.rays);
    } catch (e) {
      // rt and pipeline grids must never diverge (38.8a 23a/24a): a failed resize disables the pipeline (the CPU path keeps presenting)
      console.warn('[WgCellPipeline] resizeGrid failed at', `${cols}x${rows}`, '- pipeline disabled:', e);
      this.ready = false;
      this.setEnabled(false);
      return;
    }
    freeWgTargets(this.device, this._t);
    this._t = t;
    this.cols = cols; this.rows = rows;
    if (this._waterPass) this._waterPass.resize(cols, rows, this.rays);
    this._gbufCleared = false; this._cellsShaded = false;
    this._dropOutTarget();
    if (this._spritesPass) {
      try {
        this._spritesPass.resize(cols, rows);
        this._overlayPass.resize(cols, rows);
        this._overlayPass.setTarget(this._spritesPass.outFg);
      } catch (e) {
        console.warn('[WgCellPipeline] sprites/overlay resize failed - pipeline disabled:', e);
        this.ready = false; this.setEnabled(false); return;
      }
    }
    // async validation errors of the new targets surface only through the error scopes: drain them once (warn, never throw)
    if (typeof this.device.checkErrors === 'function') {
      this.device.checkErrors().then((errs) => { if (errs && errs.length) console.warn('[WgCellPipeline] resizeGrid validation errors:', errs); }, (e) => console.warn('[WgCellPipeline] resizeGrid checkErrors failed:', e));
    }
  }

  // ---- binders: stored now, consumed by the passes WG-2b..WG-3 add ----
  bind(table, palette) {
    this._table = table; this._palette = palette;
    if (this._rasterPass) this._rasterPass.bind(table);
    if (this._cellPass) this._cellPass.bind(table, palette); // WG-3c: shade data textures re-pack lazily on the next frame
  }
  bindVoxels(pool) { this._voxelPool = pool; }
  bindViewModel(vm) { this._viewModel = vm; }
  bindInstances(groups) {
    // 38.10a: a different groups object (new world/reload) means every batch the cull passes hold keys off the old
    // InstanceGroup objects and would otherwise leak until the idle sweep - release them now, not 10 s from now.
    if (groups !== this._instances) {
      if (this._rasterPass && this._rasterPass.cull) this._rasterPass.cull.releaseAll();
      if (this._shadowPass && this._shadowPass.cull) this._shadowPass.cull.releaseAll();
    }
    this._instances = groups;
  }
  setWaterLooks(looks) { if (this._waterPass) this._waterPass.setLooks(looks); }
  /** Test-only (14.2 item 7): 'upload' feeds the CPU fb.gbuf into the cell-res textures (`?gpucompare=shade`); 'scene' = raster path. */
  setSource(mode) { this._source = mode === 'upload' ? 'upload' : 'scene'; }

  /** Called once per frame before present(): remembers inputs; GPU commands run in the render-target hook. */
  frame(fb, light, cam, world) {
    const sp = this._spritesPass;
    if (sp && fb) { // WG-3f: scene fade amount + LUT and scene dim: the same inputs the GL sprite pass gets
      sp.sceneFade = typeof fb.sceneFade === 'number' ? fb.sceneFade : 1;
      if (fb.fadeLut) sp.setFadeLut(fb.fadeLut);
      if (fb.sceneDim) sp.setSceneDim(fb.sceneDim);
    }
    this._fb = fb; this._light = light; this._cam = cam || null; this._world = world || null;
    if (this._waterPass && this._world) this._waterPass.bindWorld(this._world);
    this.stats.waterSlots = this._waterPass ? this._waterPass.stats.waterSlots : 0; this.stats.waterDraws = this._waterPass ? this._waterPass.stats.waterDraws : 0;
    if (this.device.timer.writeStats) this.device.timer.writeStats(this.stats);
  }

  // ---- readbacks (test-only, never the frame loop): Promises, always `await` (38.6) ----

  /** Async twin of GpuCellPipeline.readbackGeometry: the RESOLVED cell-res set `{GI, GA, Depth}` (cols*rows, 4-wide Uint32Arrays; Depth channel 0 = f32 bits). */
  async readbackGeometry() {
    const t = this._t;
    if (!t) throw new Error('WgCellPipeline.readbackGeometry: no targets');
    const n = this.cols * this.rows;
    this._rbGI = this._rbGI && this._rbGI.length === 4 * n ? this._rbGI : new Uint32Array(4 * n);
    this._rbGA = this._rbGA && this._rbGA.length === 4 * n ? this._rbGA : new Uint32Array(4 * n);
    this._rbDepth = this._rbDepth && this._rbDepth.length === 4 * n ? this._rbDepth : new Uint32Array(4 * n);
    this._rbD1 = this._rbD1 && this._rbD1.length === n ? this._rbD1 : new Uint32Array(n);
    const rect = { x: 0, y: 0, w: this.cols, h: this.rows };
    await this.device.readback(t.texGI, rect, this._rbGI);
    await this.device.readback(t.texGA, rect, this._rbGA);
    await this.device.readback(t.texDepth, rect, this._rbD1); // r32uint is 1-wide; GL's RGBA_INTEGER read is 4-wide: spread
    this._rbDepth.fill(0);
    for (let i = 0; i < n; i++) this._rbDepth[i * 4] = this._rbD1[i];
    return { GI: this._rbGI, GA: this._rbGA, Depth: this._rbDepth };
  }

  /** The cells present() sampled (delegates to the render target). */
  async readback() {
    const r = await this.rt.readbackPresent();
    return { fg: r.fg, bg: r.bg };
  }
  // passes not ported yet: resolve to null so a caller's `await` works and can see "nothing here" (no throw)
  /** Async twin of GpuCellPipeline.readbackLight: LIGHT rgba32uint (xyz = bitcast L, w = sunlit | litCount << 8 | sunN << SUN_N_SHIFT), cols*rows 4-wide. */
  async readbackLight() {
    const t = this._t;
    if (!t) throw new Error('WgCellPipeline.readbackLight: no targets');
    const n = this.cols * this.rows;
    this._rbLight = this._rbLight && this._rbLight.length === 4 * n ? this._rbLight : new Uint32Array(4 * n);
    await this.device.readback(t.texLight, { x: 0, y: 0, w: this.cols, h: this.rows }, this._rbLight);
    return this._rbLight;
  }
  /**
   * WG-3c: the FINAL cells shade + edge produced this frame (rgba8: r,g,b + glyph byte in .a, like RenderTargetGL.readbackPresent).
   * Test-only, a frame boundary: call right after present(). Returns null when the passes did not run (nothing bound).
   */
  async readbackCells(outFg, outBg) {
    const t = this._t;
    if (!t || !this._cellsShaded) return null;
    if (this._spritesRan) return this._spritesPass.readbackCells(outFg, outBg); // WG-3f: final cells = sprites (+ overlay) output
    const n = this.cols * this.rows * 4;
    outFg = outFg || (this._rbFg = this._rbFg && this._rbFg.length === n ? this._rbFg : new Uint8Array(n));
    outBg = outBg || (this._rbBg = this._rbBg && this._rbBg.length === n ? this._rbBg : new Uint8Array(n));
    const rect = { x: 0, y: 0, w: this.cols, h: this.rows };
    await this.device.readback(t.texFinalFg, rect, outFg);
    await this.device.readback(t.texFinalBg, rect, outBg);
    return { fg: outFg, bg: outBg };
  }
  /** WG-3e: the WATER layer (rgba32uint, 4 words/cell); null when no water drew this frame. */
  async readbackWater(out) { return this._waterPass ? this._waterPass.readbackWater(out) : null; }
  /** WG-3d: the sun map depth as float32 bits (res*res Uint32Array); false = no map rendered this frame (gpucompare shadowDepth row). */
  async readbackShadowDepthBits(out) { return this._shadowPass ? this._shadowPass.readbackDepth(out) : false; }

  // ---- hook (RenderTargetWebGPU.present calls it between the cell upload and its own present pass) ----
  _hook() {
    if (!this.ready || !this._t) return;
    const d = this.device, t = this._t, rt = this.rt;
    if (this._cam && this._world) {
      try { this._rasterPass.run(this); }
      catch (e) { this.ready = false; this.setEnabled(false); console.warn('[WgCellPipeline] raster disabled:', e); return; }
    } else {
      d.beginPass(t.targetRaster, this._clearOpts);
      d.endPass();
      if (this._shadowPass) this._shadowPass.active = false; // no camera/world: no valid map (the light pass falls back to the dummy)
    }
    const sh = this._shadowPass;
    if (sh && (sh.enabled || sh.off)) {
      try { sh.run(this, this._rasterPass); }
      catch (e) { sh.active = false; console.warn('[WgCellPipeline] sun shadow map failed this frame (DDA sun):', e); }
      this.stats.shadowItems = sh.stats.shadowItems; this.stats.shadowDraws = sh.stats.shadowDraws; this.stats.shadowCpuMs = sh.stats.shadowCpuMs;
    }
    try { this._cellPass.run(this, t); }
    catch (e) { this.ready = false; this.setEnabled(false); console.warn('[WgCellPipeline] resolve/deriv/light/shade/edge disabled:', e); return; }
    this._cellsShaded = this._cellPass.shaded;
    this._runSprites(t);
    if (!this.ready) return;
    if (this.debugMode < 0) return;
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

  /** WG-3f: sprites then overlay right after edge, every frame the cell pass shaded (also with 0 sprites). */
  _runSprites(t) {
    const sp = this._spritesPass;
    this._spritesRan = false;
    if (!sp || !this._cellsShaded || this._spritesPending) { this._setPresent(null, null); return; } // pending = pipelines still compiling
    try {
      sp.run({ gi: t.texGI, depth: t.texDepth, edgeFg: t.texFinalFg, edgeBg: t.texFinalBg });
      this._overlayPass.run(t.texDepth);
    } catch (e) {
      this.ready = false; this.setEnabled(false); console.warn('[WgCellPipeline] sprites/overlay disabled:', e); return;
    }
    this._spritesRan = sp.ran;
    this.stats.sprites = sp.stats.sprites;
    if (this.frameComplete && sp.ran && this.debugMode < 0) this._setPresent(sp.outFg, sp.outBg); else this._setPresent(null, null);
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
    if (this._rasterPass) this._rasterPass.dispose();
    this._rasterPass = null;
    if (this._cellPass) this._cellPass.dispose();
    this._cellPass = null;
    if (this._shadowPass) this._shadowPass.dispose();
    this._shadowPass = null;
    if (this._waterPass) this._waterPass.dispose();
    this._waterPass = null;
    if (this._overlayPass) this._overlayPass.dispose();
    this._overlayPass = null;
    if (this._spritesPass) this._spritesPass.dispose();
    this._spritesPass = null; this._spritesBound = false;
    this._syncActive();
    freeWgTargets(this.device, this._t);
    this._t = null;
  }
}
