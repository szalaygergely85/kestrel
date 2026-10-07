// WG-3a (docs/architecture.md 38.8a items 20-22): resolve + deriv as fullscreen passes (GpuCellPipeline._passResolve/_passDeriv twin).
// Resolve votes the raster sub-sample set (texSGI/SGA/SDepth) down to cell-res texGI/texGA/texDepth; deriv reads those and
// writes texGD; WG-3b then runs the light pass (passLight.js) into texLight. Pipelines and bind descriptors are built once here (22b); per frame only uniform words change.
import { RESOLVE_BLOCK, RESOLVE_WGSL, RESOLVE_TEXTURES } from '../wgsl/resolve.wgsl.js';
import { DERIV_BLOCK, DERIV_WGSL, DERIV_TEXTURES } from '../wgsl/deriv.wgsl.js';
import { WgLightPass } from './passLight.js';
import { PROJ_HFOV_DEG } from '../../projection.js';

const R_N = RESOLVE_BLOCK.field('n').word;
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
  constructor(device) {
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
    this.lightPass = new WgLightPass(device);
    this.ru = new Float32Array(RESOLVE_BLOCK.sizeWords); this.ri = new Int32Array(this.ru.buffer);
    this.du = new Float32Array(DERIV_BLOCK.sizeWords); this.di = new Int32Array(this.du.buffer);
    this.rTex = [0, 1, 2, 3].map(slot => ({ slot, texture: null }));
    this.dTex = [0, 1, 2].map(slot => ({ slot, texture: null }));
    this.rBind = { uniforms: this.ru, textures: this.rTex };
    this.dBind = { uniforms: this.du, textures: this.dTex };
    this.terms = { tanHalfHFov: 0, planeDistY: 0 };
  }

  /** Runs resolve then deriv into the cell-res targets of `t`. @param {{rt:any, rays:number, cols:number, rows:number}} p */
  run(p, t) {
    const d = this.device, rt = p.rt;
    const rTex = this.rTex;
    rTex[0].texture = t.texSGI; rTex[1].texture = t.texSGA; rTex[2].texture = t.texSDepth; rTex[3].texture = t.texMask;
    this.ri[R_N] = p.rays;
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
    // WG-3b: light (needs the camera + world; without them the frame has no lit content)
    if (p._cam && p._world) this.lightPass.run(p, t);
  }

  dispose() {
    if (this.lightPass) { this.lightPass.dispose(); this.lightPass = null; }
    for (const k of ['pipeResolve', 'pipeDeriv']) { if (this[k]) { try { this.device.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; } }
  }
}
