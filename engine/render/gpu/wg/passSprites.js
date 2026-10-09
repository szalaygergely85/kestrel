// WG-3f: device-only sprite / particle / scene fade / scene dim pass (WebGPU twin of GpuSpritePass, US-030c/017/015/053b; GL source
// engine/render/gpu/spritesPass.js). Standalone: B1 wires it into WgCellPipeline. One fullscreen pass, WGSL = wgsl/sprites.wgsl.js (all the
// "19 WG-3c wait rows" - sprites, particles, scene fade, scene dim - are inside this one shader).
//
// B1 plug-in (pipeline/bind descriptors at construct; textures at resize / atlas change; nothing is created per frame):
//   const sp = new WgSpritesPass(device, { pool: engine.spritePool, atlas, palette });   // pool = SpritePool (projected by the caller each frame)
//   sp.resize(cols, rows)              // in resizeGrid: creates the OUTPUT textures sp.outFg / sp.outBg (rgba8) + target
//   sp.setAtlas(atlas)                 // only when the atlas object changes (uploads ATLAS + PAL once; the constructor already did for opts.atlas)
//   sp.setFadeLut(lut)                 // FadeLut {idx, ramp, minGain}; uploads once per identity change (recreates the ramp texture if its length changed)
//   sp.bindParticleLayer(engine.particleLayer)   // once (boot); the part textures follow the layer grid
//   per frame set sp.sceneFade (1 = off) and call sp.setSceneDim(fb.sceneDim) (copies {all,n,rects}); then
//   sp.run({ gi: t.texGI, depth: t.texDepth, edgeFg: t.texFinalFg, edgeBg: t.texFinalBg })
//     - GL order: ... edge -> sprites -> overlay -> present. The edge output is only READ here (no copy needed, unlike GL _copyEdge).
//     - ALWAYS call it when the cell pass ran, also with 0 sprites (the output textures are the frame final cells: fade/dim/particles still apply).
//   FINAL CELLS after this pass: sp.outFg / sp.outBg (rgba8; fg.a = glyph byte, bg.a = 1). The overlay pass (passOverlay.js) draws INTO sp.outFg
//   (give it `sp.outFg` via WgOverlayPass.setTarget). The presenter must read these two (not texFinalFg/Bg) once sprites run; `sp.ran` is true for
//   the frame that executed. Turn `rt.gpuActive` / `frameComplete` on only when water (WG-3e), the sun-map shadow (WG-3d), this pass and the overlay
//   pass are all wired and the gpucompare rows pass.
//   Stats: sp.stats.{sprites, uploadMs}. Readback (gpucompare): `await sp.readbackCells(outFg?, outBg?)` -> {fg, bg} Uint8Array(cols*rows*4) or null.
//   dispose() frees everything.
//
// Deviations from the GL pass (flagged): (1) [fixed] ATLAS is 'rgba8ui' (uploaded as is, no widening); the WGSL reads .r/.g/.b/.a as u32 either way. (2) [fixed] the particle layer uploads only the dirty rect (rows + columns, rect.stride = layer width) via writeTexture's dataOffset. (3) Sprite rows upload `pool.spr` with rect h = count (no subarray).
import { SPRITES_BLOCK, SPRITES_WGSL, SPRITES_TEXTURES } from '../wgsl/sprites.wgsl.js';
import { MAX_SPRITES, SPR_TEXELS } from '../../sprites.js';

const F = (n) => SPRITES_BLOCK.field(n).word;
const W_COUNT = F('count'), W_FADE = F('sceneFade'), W_MING = F('fadeMinGain'), W_RAMP = F('fadeRampLen');
const W_DIMALL = F('dimAll'), W_DIMN = F('dimCount'), W_DIMMUL = F('dimMul'), W_DIMRECT = F('dimRect');

export const ATLAS_FORMAT = 'rgba8ui';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class WgSpritesPass {
  /** @param {any} device @param {{pool: any, atlas?: any, palette?: any}} opts */
  constructor(device, opts) {
    this.device = device;
    this.pool = opts.pool;
    this.palette = opts.palette || null;
    this.cols = 0; this.rows = 0;
    // timeUploads (default false): the two performance.now() calls allocate ~32 B/frame; when off, stats.uploadMs stays 0.
    this.timeUploads = !!opts.timeUploads;
    this.stats = { sprites: 0, uploadMs: 0, partBytes: 0 }; // partBytes: cumulative particle-layer upload bytes (both textures)
    this.cropColumns = true; // PARTICLE-UPLOAD-02 (false = row band only, for the equivalence test)
    this.ran = false;
    this._rowRect = { x: 0, y: 0, w: 0, h: 0, stride: 0 }; // reused dirty-row rect for writeTexture (no per-frame allocation)
    this.sceneFade = 1; this.fadeMinGain = 0; this.fadeRampLen = 1;
    this.dimAll = 1; this.dimCount = 0;
    this.dimRect = new Float32Array(16); this.dimMul = new Float32Array(4);
    this.u = new Float32Array(SPRITES_BLOCK.sizeWords); this.ui = new Int32Array(this.u.buffer);
    this.outFg = null; this.outBg = null; this.target = null;
    this.atlas = null; this.texAtlas = null; this.texPal = null;
    this._lutRef = null; this._rampLen = 1;
    this.layer = null; this._partCols = 1; this._partRows = 1; this._partRef = null; this._partDirty = true;
    this.texSpr = this.texFadeLut = this.texFadeRamp = this.texPart = this.texPartZ = null; this.pipe = null;
    this.tex = [];
    this.bindDesc = null;
    try {
      this.pipe = device.createPipeline({
        vertex: { src: { wgsl: SPRITES_WGSL } }, fragment: { src: { wgsl: SPRITES_WGSL }, targets: 2 },
        bindings: { uniformBytes: SPRITES_BLOCK.sizeBytes, textures: SPRITES_TEXTURES.slice() },
        targetFormats: ['rgba8', 'rgba8'], cull: 'none',
      });
      this.texSpr = device.createTexture({ format: 'rgba32f', width: SPR_TEXELS, height: MAX_SPRITES });
      this.texFadeLut = device.createTexture({ format: 'r8ui', width: 128, height: 1 });
      this.texFadeRamp = device.createTexture({ format: 'r8ui', width: 1, height: 1 });
      this.texPart = device.createTexture({ format: 'rgba8', width: 1, height: 1 });
      this.texPartZ = device.createTexture({ format: 'r32f', width: 1, height: 1 });
      this.tex = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((slot) => ({ slot, texture: null }));
      this.bindDesc = { uniforms: this.u, textures: this.tex };
      if (opts.atlas) this.setAtlas(opts.atlas);
    } catch (e) { this.dispose(); throw e; }
  }

  /** (Re)creates the output cell textures for a grid (no-op at the same size). */
  resize(cols, rows) {
    if (this.target && cols === this.cols && rows === this.rows) return;
    this._freeTarget();
    this.cols = cols; this.rows = rows;
    const d = this.device;
    this.outFg = d.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.outBg = d.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.target = d.createTarget({ color: [this.outFg, this.outBg] });
  }

  _freeTarget() {
    for (const h of [this.target, this.outBg, this.outFg]) if (h) this.device.dispose(h);
    this.target = this.outFg = this.outBg = null; this.cols = this.rows = 0;
  }

  /** Atlas (RGBA8 cell atlas, `buildSpriteAtlas`) + palette LUT upload; call only when the atlas object changes. */
  setAtlas(atlas) {
    if (!atlas || atlas === this.atlas) return;
    const d = this.device;
    if (this.texAtlas) { d.dispose(this.texAtlas); this.texAtlas = null; }
    if (this.texPal) { d.dispose(this.texPal); this.texPal = null; }
    const data = atlas.data;
    this.texAtlas = d.createTexture({ format: ATLAS_FORMAT, width: atlas.width, height: atlas.height });
    d.writeTexture(this.texAtlas, data); // RGBA8UI: the Uint8Array uploads as is (no widening)
    const pn = atlas.pal.length / 4;
    this.texPal = d.createTexture({ format: 'rgba32f', width: pn, height: 1 });
    d.writeTexture(this.texPal, atlas.pal);
    this.atlas = atlas;
  }

  /** FadeLut {idx, ramp, minGain}: uploaded once per identity change. */
  setFadeLut(lut) {
    if (!lut || this._lutRef === lut) return;
    const d = this.device;
    d.writeTexture(this.texFadeLut, lut.idx);
    if (lut.ramp.length !== this._rampLen) {
      d.dispose(this.texFadeRamp);
      this.texFadeRamp = d.createTexture({ format: 'r8ui', width: lut.ramp.length, height: 1 });
      this._rampLen = lut.ramp.length;
    }
    d.writeTexture(this.texFadeRamp, lut.ramp);
    this.fadeMinGain = lut.minGain; this.fadeRampLen = lut.ramp.length; this._lutRef = lut;
  }

  /** SceneDim {all, n, rects: Float32Array(20)} (x0,y0,x1,y1,mul per rect); falsy leaves the previous values (GL contract). */
  setSceneDim(dim) {
    if (!dim) return;
    this.dimAll = dim.all; this.dimCount = dim.n;
    for (let i = 0; i < dim.n * 5; i++) {
      const ri = (i / 5) | 0, f = i % 5;
      if (f === 4) this.dimMul[ri] = dim.rects[i]; else this.dimRect[ri * 4 + f] = dim.rects[i];
    }
  }

  bindParticleLayer(layer) { this.layer = layer; this._partRef = null; }

  _syncParticles() {
    const l = this.layer;
    if (!l) return;
    const d = this.device;
    if (l.cols !== this._partCols || l.rows !== this._partRows) {
      if (!(l.cols > 0 && l.rows > 0)) return;
      d.dispose(this.texPart); d.dispose(this.texPartZ);
      this.texPart = d.createTexture({ format: 'rgba8', width: l.cols, height: l.rows });
      this.texPartZ = d.createTexture({ format: 'r32f', width: l.cols, height: l.rows });
      this._partCols = l.cols; this._partRows = l.rows; this._partDirty = true;
    }
    if (l.part !== this._partRef) { this._partRef = l.part; this._partDirty = true; }
    const hasNow = l.maxRow >= l.minRow, hadPrev = l.prevMaxRow >= l.prevMinRow;
    if (!this._partDirty && !hasNow && !hadPrev) return;
    // dirty-row slice (like the GL pass): rows [r0, r1] of the layer, read from the arrays at dataOffset (no subarray)
    let r0 = this._partRows, r1 = -1;
    if (hasNow) { r0 = l.minRow; r1 = l.maxRow; }
    if (hadPrev) { if (l.prevMinRow < r0) r0 = l.prevMinRow; if (l.prevMaxRow > r1) r1 = l.prevMaxRow; }
    const fullRect = this._partDirty;
    if (fullRect) { r0 = 0; r1 = this._partRows - 1; this._partDirty = false; }
    if (r0 < 0) r0 = 0; if (r1 > this._partRows - 1) r1 = this._partRows - 1;
    if (r1 < r0) return;
    // PARTICLE-UPLOAD-02: crop columns too (touched span now + last frame's footprint); full width when it covers > 75% or is degenerate
    const C = this._partCols;
    let c0 = C, c1 = -1;
    if (hasNow) { c0 = l.minCol; c1 = l.maxCol; }
    if (hadPrev) { if (l.prevMinCol < c0) c0 = l.prevMinCol; if (l.prevMaxCol > c1) c1 = l.prevMaxCol; }
    const full = fullRect || !this.cropColumns || c0 < 0 || c1 >= C || c1 < c0 || (c1 - c0 + 1) * 4 > C * 3;
    if (full) { c0 = 0; c1 = C - 1; }
    const rect = this._rowRect; rect.x = c0; rect.y = r0; rect.w = c1 - c0 + 1; rect.h = r1 - r0 + 1; rect.stride = full ? 0 : C;
    const off = r0 * C + c0;
    d.writeTexture(this.texPart, l.part, rect, off * 4);
    d.writeTexture(this.texPartZ, l.partZ, rect, off);
    this.stats.partBytes += rect.w * rect.h * 8; // rgba8 (4 B) + r32f (4 B) per texel
  }

  /**
   * @param {{gi: any, depth: any, edgeFg: any, edgeBg: any}} inp texGI, texDepth (r32uint) and the edge pass output (read only)
   */
  run(inp) {
    this.ran = false;
    if (!this.target || !this.texAtlas) return;
    const d = this.device, pool = this.pool, t0 = this.timeUploads ? now() : 0;
    const count = Math.min(pool.count, MAX_SPRITES);
    if (count > 0) d.writeTexture(this.texSpr, pool.spr, { x: 0, y: 0, w: SPR_TEXELS, h: count });
    this._syncParticles();
    const u = this.u, ui = this.ui;
    ui[W_COUNT] = count; u[W_FADE] = this.sceneFade; u[W_MING] = this.fadeMinGain; ui[W_RAMP] = this.fadeRampLen;
    u[W_DIMALL] = this.dimAll; ui[W_DIMN] = this.dimCount;
    u.set(this.dimMul, W_DIMMUL); u.set(this.dimRect, W_DIMRECT);
    const tx = this.tex;
    tx[0].texture = inp.gi; tx[1].texture = inp.depth; tx[2].texture = inp.edgeFg; tx[3].texture = inp.edgeBg;
    tx[4].texture = this.texSpr; tx[5].texture = this.texAtlas; tx[6].texture = this.texPal;
    tx[7].texture = this.texFadeLut; tx[8].texture = this.texFadeRamp; tx[9].texture = this.texPart; tx[10].texture = this.texPartZ;
    if (this.timeUploads) this.stats.uploadMs = now() - t0;
    d.beginPass(this.target);
    d.bind(this.pipe, this.bindDesc);
    d.draw(3, 0, 1);
    d.endPass();
    this.stats.sprites = count;
    this.ran = true;
  }

  /** gpucompare: the cells after sprites (+ overlay if it drew into outFg). Null before resize. */
  async readbackCells(outFg, outBg) {
    if (!this.target) return null;
    const n = this.cols * this.rows * 4, rect = { x: 0, y: 0, w: this.cols, h: this.rows };
    outFg = outFg || (this._rbFg = this._rbFg && this._rbFg.length === n ? this._rbFg : new Uint8Array(n));
    outBg = outBg || (this._rbBg = this._rbBg && this._rbBg.length === n ? this._rbBg : new Uint8Array(n));
    await this.device.readback(this.outFg, rect, outFg);
    await this.device.readback(this.outBg, rect, outBg);
    return { fg: outFg, bg: outBg };
  }

  dispose() {
    const d = this.device;
    this._freeTarget();
    for (const k of ['pipe', 'texSpr', 'texFadeLut', 'texFadeRamp', 'texPart', 'texPartZ', 'texAtlas', 'texPal']) {
      if (this[k]) { try { d.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
    }
    this.atlas = null;
  }
}
