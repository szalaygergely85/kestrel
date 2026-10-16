// WG-3a (docs/architecture.md 38.8a items 20-22): resolve + deriv as fullscreen passes (GpuCellPipeline._passResolve/_passDeriv twin).
// Resolve votes the raster sub-sample set (texSGI/SGA/SDepth) down to cell-res texGI/texGA/texDepth; deriv reads those and
// writes texGD; WG-3b then runs the light pass (passLight.js) into texLight. Pipelines and bind descriptors are built once here (22b); per frame only uniform words change.
import { RESOLVE_BLOCK, RESOLVE_WGSL, RESOLVE_TEXTURES } from '../wgsl/resolve.wgsl.js';
import { STABLE_BLOCK } from '../wgsl/stable.wgsl.js';
import { DERIV_BLOCK, DERIV_WGSL, DERIV_TEXTURES } from '../wgsl/deriv.wgsl.js';
import { WgLightPass } from './passLight.js';
import { WgShadePass } from './passShade.js';
import { WgUploadSource } from './passUpload.js';
import { PROJ_HFOV_DEG } from '../../projection.js';
import { fogShapeCtx } from '../../fogShape.js'; // AA-17 (OB-208): aaFolE switch
import { WG_PASS_SLOT, wgSpanBegin, wgSpanEnd } from '../device/WebGpuTimer.js'; // S8-B1-07: per-pass GPU timer slots

const R_N = RESOLVE_BLOCK.field('n').word, R_BAND = RESOLVE_BLOCK.field('bandM').word, R_HVALID = RESOLVE_BLOCK.field('histValid').word, R_FOLE = RESOLVE_BLOCK.field('folEdge').word, R_VOX = RESOLVE_BLOCK.field('vox').word;
// AA-04b: StableU words copied into ResolveU by field name (vec4 = 4 words)
const HYST_COPY = [['curA', 4], ['curB', 4], ['curC', 4], ['prevA', 4], ['prevB', 4], ['prevC', 4], ['dEye', 4], ['gridCols', 1], ['gridRows', 1], ['ortho', 1]]
  .map(([n, w]) => ({ from: STABLE_BLOCK.field(n).word, to: RESOLVE_BLOCK.field(n).word, w }));
const D_COLS = DERIV_BLOCK.field('cols').word, D_ROWS = DERIV_BLOCK.field('rows').word;
const D_TAN = DERIV_BLOCK.field('tanHalfHFov').word, D_PDY = DERIV_BLOCK.field('planeDistY').word;

/** GpuCellPipeline._computeCamBasis twin for the two scalars deriv needs. */
export function derivTerms(cols, rows, pxCellW, pxCellH, out) {
  const tanHalfHFov = Math.tan(PROJ_HFOV_DEG * Math.PI / 180 / 2);
  const screenAspect = (cols * (pxCellW || 1)) / (rows * (pxCellH || 1));
  out.tanHalfHFov = tanHalfHFov;
  out.planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
  return out;
}

export class WgCellPass {
  /** @param {{stable?: boolean}} [opts] stable (US-073c): shade also writes the ramp-level target; absent = unchanged */
  constructor(device, shadowPass = null, waterPass = null, opts = null) {
    this.water = waterPass; // WG-3e WgWaterPass (owned by the pipeline)
    this.device = device;
    this.pipeResolve = device.createPipeline({
      vertex: { src: { wgsl: RESOLVE_WGSL } }, fragment: { src: { wgsl: RESOLVE_WGSL }, targets: 3 },
      bindings: { uniformBytes: RESOLVE_BLOCK.sizeBytes, textures: RESOLVE_TEXTURES.slice() },
      targetFormats: ['rgba32ui', 'rgba32ui', 'r32ui'],
    });
    this.pipeDeriv = device.createPipeline({
      vertex: { src: { wgsl: DERIV_WGSL } }, fragment: { src: { wgsl: DERIV_WGSL }, targets: 1 },
      bindings: { uniformBytes: DERIV_BLOCK.sizeBytes, textures: DERIV_TEXTURES.slice() },
      targetFormats: ['rgba32ui'],
    });
    this.lightPass = new WgLightPass(device, shadowPass);
    this.shadePass = new WgShadePass(device, { stable: !!(opts && opts.stable), aaCov: !(opts && opts.aaCov === false) }); // WG-3c: shade + edge after light
    this.shaded = false; // true when this frame's shade + edge ran (final cells valid)
    this.upload = new WgUploadSource(device);  // WG-3c: `?gpucompare=shade` test source
    this.ru = new Float32Array(RESOLVE_BLOCK.sizeWords); this.ri = new Int32Array(this.ru.buffer);
    this.du = new Float32Array(DERIV_BLOCK.sizeWords); this.di = new Int32Array(this.du.buffer);
    this.dummyHist = device.createTexture({ format: 'rgba32ui', width: 1, height: 1 }); // AA-04b: bound when the hysteresis is off
    this.rTex = [0, 1, 2, 3, 4, 5].map(slot => ({ slot, texture: null }));
    this.dTex = [0, 1, 2].map(slot => ({ slot, texture: null }));
    this.rBind = { uniforms: this.ru, textures: this.rTex };
    this.dBind = { uniforms: this.du, textures: this.dTex };
    this.terms = { tanHalfHFov: 0, planeDistY: 0 };
    this.carpet = null; // OB-073-D2d: WgCarpetPass (set by the pipeline on setCarpet); null = never encoded
  }

  /** Test hook: forwards the bound MaterialTable + palette (the shade pass packs lazily, only when they change). */
  bind(table, palette) { this.shadePass.bind(table, palette); }

  /** Runs resolve then deriv into the cell-res targets of `t`, then light, shade, edge. @param {{rt:any, rays:number, cols:number, rows:number}} p */
  run(p, t) {
    const d = this.device, rt = p.rt;
    this.shaded = false;
    if (p._source === 'upload') { // ?gpucompare=shade: CPU G-buffer straight into the cell-res set (no raster/resolve/deriv)
      if (!this.upload.run(p, t)) return;
      wgSpanBegin(p, WG_PASS_SLOT.light);
      try { this.lightPass.run(p, t); } finally { wgSpanEnd(p); }
      this.shaded = this.shadePass.run(p, t, this.lightPass.cam);
      return;
    }
    const wp = this.water, sceneOk = !!(p._cam && p._world);
    if (wp) wp.active = false;
    if (wp && sceneOk) wp.prepare(p, p._rasterPass); // selection needs the camera/frustum of this frame's raster pass
    const rTex = this.rTex;
    rTex[0].texture = t.texSGI; rTex[1].texture = t.texSGA; rTex[2].texture = t.texSDepth; rTex[3].texture = t.texMask;
    rTex[4].texture = this.dummyHist; this.ri[R_HVALID] = 0;
    rTex[5].texture = this.shadePass.texMatI; // AA-17: F_SOFT_EDGE per material (shade packs it; 1x1 stub until the first upload)
    this.ri[R_FOLE] = fogShapeCtx.aaFolE ? 1 : 0;
    this.ri[R_VOX] = fogShapeCtx.aaVox !== false ? 1 : 0; // AA-21 (OB-208): ?aavox=0
    const hs = p._hystSp; // AA-04b: the stable pass whose camera terms/history resolve may use this frame (set by the pipeline, null = off)
    if (hs && p.rays > 1 && hs.st.histValid && hs.outHist) {
      rTex[4].texture = hs.outHist; this.ri[R_HVALID] = 1; // last frame's stable output (set[_k ^ 1])
      for (const c of HYST_COPY) for (let k = 0; k < c.w; k++) this.ri[c.to + k] = hs.ui[c.from + k]; // raw words: floats and ints alike
    }
    this.ri[R_N] = p.rays;
    this.ru[R_BAND] = p.rays === 4 ? (p.resolveBandM || 0) : 0; // 38.79: one f32 into the existing scratch
    // S8-B1-07: resolve + deriv share one 'resolve' timer slot (GpuCellPipeline.PASS_RESOLVE precedent: one query spans both).
    wgSpanBegin(p, WG_PASS_SLOT.resolve);
    try {
      d.beginPass(t.targetResolve);
      d.bind(this.pipeResolve, this.rBind);
      d.draw(3);
      d.endPass();
      const dTex = this.dTex;
      dTex[0].texture = t.texGI; dTex[1].texture = t.texGA; dTex[2].texture = t.texDepth;
      derivTerms(p.cols, p.rows, rt.pxCellW, rt.pxCellH, this.terms);
      this.di[D_COLS] = p.cols; this.di[D_ROWS] = p.rows;
      this.du[D_TAN] = this.terms.tanHalfHFov; this.du[D_PDY] = this.terms.planeDistY;
      d.beginPass(t.targetDeriv);
      d.bind(this.pipeDeriv, this.dBind);
      d.draw(3);
      d.endPass();
    } finally { wgSpanEnd(p); }
    if (wp && wp.active) { // WG-3e: water layer after deriv, before light
      wgSpanBegin(p, WG_PASS_SLOT.water);
      try { wp.runWater(t.texDepth); } finally { wgSpanEnd(p); }
    }
    // WG-3b: light (needs the camera + world; without them the frame has no lit content)
    if (sceneOk) {
      let tl = t; // OB-073-D2d: carpet after resolve/deriv/water, before light (no free timer slot: it is counted in 'light')
      wgSpanBegin(p, WG_PASS_SLOT.light);
      try { const cp = this.carpet; if (cp && cp.active) tl = cp.run(p, t) || t; this.lightPass.run(p, tl); } finally { wgSpanEnd(p); }
      this.shaded = this.shadePass.run(p, tl, this.lightPass.cam, wp); // WG-3c (+ water composite WG-3e)
    }
  }

  dispose() {
    if (this.lightPass) { this.lightPass.dispose(); this.lightPass = null; }
    if (this.shadePass) { this.shadePass.dispose(); this.shadePass = null; }
    this.upload = null;
    for (const k of ['pipeResolve', 'pipeDeriv']) { if (this[k]) { try { this.device.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; } }
  }
}
