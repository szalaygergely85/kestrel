// OB-073-D2d (architecture.md 38.52 item 8): WgCarpetPass - the grass carpet as ONE fullscreen pass over the cell grid, after resolve/deriv/water and
// right before light (carpet.wgsl.js; JS twin engine/render/carpet.js). It reads t.texGI/GA/Depth and writes a SCRATCH set (kind-10 cells where a
// blade is hit, every other cell copied), because a texture cannot be sampled and rendered in one pass (GpuDevice computes bind storage buffers only).
// `run` returns an alias of `t` whose texGI/texGA/texDepth are the scratch set: light/shade/edge read the alias. The HZB is built earlier from the
// pre-carpet raster depth, so it is unaffected. Off (no setCarpet, or null) = the pipeline is never created and nothing is encoded.
//   const cp = new WgCarpetPass(device);
//   cp.setCarpet(carpet, nearH, version)  // carpet = world.carpet {cfg, classMap, x0, y0, w, h}; nearH = {data:Float32Array, w, h, x0, y0, cell}; version: bump on every rebake
//   cp.setTime(sec)                       // wind clock (seconds), once per frame
//   const tv = cp.run(p, t)               // p = WgCellPipeline (p._cam, p._rasterPass.pitch); null when it did not run
// The class map (r8ui) and the near-band height (r32f) are uploaded ONLY when `version` changed (or the data object changed): never per frame.
// Per frame only uniform words change (0 allocations). No timer slot is free (all 16 taken): the pass runs inside the light span.
import { CARPET_BLOCK, CARPET_WGSL, CARPET_TEXTURES, CARPET_TARGETS, CARPET_VTAB_ROWS, CARPET_KNOTS } from '../wgsl/carpet.wgsl.js';
import { makeCarpetCtx, MAX_VARIANTS } from '../../carpet.js';
import { CARPET_DEFAULTS } from '../../../world/carpet.js';

const W = (n) => CARPET_BLOCK.field(n).word;
const W_COLS = W('gridCols'), W_ROWS = W('gridRows'), W_SEED = W('seed'), W_WINDON = W('windOn');
const W_CLW = W('classW'), W_CLH = W('classHt'), W_NW = W('nearW'), W_NH = W('nearHt');
const W_CELL = W('cellM'), W_RAD = W('radiusM'), W_PATCH = W('patchM'), W_CCELL = W('classCellM'), W_CJIT = W('classJitterM');
const W_GUST = W('gustM'), W_TRAVEL = W('travelM'), W_TIME = W('timeSec'), W_CX0 = W('classX0'), W_CY0 = W('classY0');
const W_NX0 = W('nearX0'), W_NY0 = W('nearY0'), W_NCELL = W('nearCell'), W_MAXH = W('maxH'), W_WMAX = W('wMax'), W_FPK = W('fpK');
const W_WIND0 = W('windP0'), W_WIND1 = W('windP1'), W_EYE = W('eye'), W_PA = W('pitchA'), W_PB = W('pitchB'), W_PC = W('pitchC');
const W_KNOTS = W('knots'), W_VTAB = W('vtab'), W_IX0 = W('ix0'), W_IY0 = W('iy0'), W_ORGX = W('orgX'), W_ORGY = W('orgY');
const NOOP_GROUND = () => {};

/**
 * Pure, Node-tested: the per-rebake part of the uniform block (config scalars + variant table). Variant id 0 = no carpet (density 0, sway 1).
 * @param {{cfg:any, classMap:Uint8Array, x0:number, y0:number, w:number, h:number}} carpet
 * @param {{w:number, h:number, x0:number, y0:number, cell:number}} nearH
 */
export function packCarpetConfig(carpet, nearH, f32, i32) {
  const cfg = carpet.cfg, D = CARPET_DEFAULTS, ctx = makeCarpetCtx(carpet, NOOP_GROUND, null);
  i32[W_SEED] = ctx.seed; i32[W_CLW] = carpet.w; i32[W_CLH] = carpet.h; i32[W_NW] = nearH.w; i32[W_NH] = nearH.h;
  f32[W_CELL] = ctx.cellM; f32[W_RAD] = ctx.radiusM; f32[W_PATCH] = ctx.patchM; f32[W_CCELL] = ctx.classCellM; f32[W_CJIT] = ctx.classJitterM;
  f32[W_GUST] = ctx.gustM; f32[W_TRAVEL] = ctx.travelM; f32[W_CX0] = carpet.x0; f32[W_CY0] = carpet.y0;
  f32[W_NX0] = nearH.x0; f32[W_NY0] = nearH.y0; f32[W_NCELL] = nearH.cell; f32[W_MAXH] = ctx.maxH; f32[W_WMAX] = ctx.wMax;
  f32.fill(0, W_VTAB, W_VTAB + (MAX_VARIANTS + 1) * CARPET_VTAB_ROWS * 4);
  for (let v = 0; v <= MAX_VARIANTS; v++) {
    const o = W_VTAB + v * CARPET_VTAB_ROWS * 4;
    f32[o] = v === 0 ? 0 : ctx.dens[v]; f32[o + 1] = ctx.hMin[v]; f32[o + 2] = ctx.hMax[v]; f32[o + 3] = ctx.bw[v];
    f32[o + 4] = v === 0 ? 1 : ctx.sway[v]; f32[o + 5] = ctx.tuftP[v]; f32[o + 6] = ctx.tuftMul[v];
  }
  void cfg; void D;
}

/** Pure, Node-tested: wind field params + knot table (engine/world/wind.js `field.params`: dirX, dirY, speed, amp, P, travel, K). null = calm. */
export function packCarpetWind(params, f32, i32) {
  if (!params) { i32[W_WINDON] = 0; return; }
  i32[W_WINDON] = 1;
  f32[W_WIND0] = params.dirX; f32[W_WIND0 + 1] = params.dirY; f32[W_WIND0 + 2] = params.speed; f32[W_WIND0 + 3] = params.amp;
  f32[W_WIND1] = params.P; f32[W_WIND1 + 1] = params.travel;
  for (let k = 0; k < CARPET_KNOTS * 4; k++) f32[W_KNOTS + k] = params.K[k];
}

export class WgCarpetPass {
  /** @param {any} device */
  constructor(device) {
    this.device = device;
    this.cols = 0; this.rows = 0; this.active = false; this.ran = false;
    this.timeSec = 0; this.fpK = 0; this.windParams = null;
    this.pipe = device.createPipeline({
      vertex: { src: { wgsl: CARPET_WGSL } }, fragment: { src: { wgsl: CARPET_WGSL }, targets: 3 },
      bindings: { uniformBytes: CARPET_BLOCK.sizeBytes, textures: CARPET_TEXTURES.slice() },
      targetFormats: CARPET_TARGETS.slice(),
    });
    this.u = new Float32Array(CARPET_BLOCK.sizeWords); this.ui = new Int32Array(this.u.buffer);
    this.tex = CARPET_TEXTURES.map((_, slot) => ({ slot, texture: null }));
    this.bindDesc = { uniforms: this.u, textures: this.tex };
    this.texGI = null; this.texGA = null; this.texDepth = null; this.target = null;
    this.texClass = null; this.texNear = null;
    this._carpet = null; this._nearH = null; this._version = NaN; this._dirty = false;
    this._view = null; this._viewFor = null;
    this.stats = { classUploads: 0, nearUploads: 0, runs: 0 };
  }

  resize(cols, rows) {
    const d = this.device;
    if (cols === this.cols && rows === this.rows && this.target) return;
    this._freeTargets();
    this.texGI = d.createTexture({ format: 'rgba32ui', width: cols, height: rows });
    this.texGA = d.createTexture({ format: 'rgba32ui', width: cols, height: rows });
    this.texDepth = d.createTexture({ format: 'r32ui', width: cols, height: rows });
    this.target = d.createTarget({ color: [this.texGI, this.texGA, this.texDepth] });
    this.cols = cols; this.rows = rows; this._viewFor = null;
  }

  /**
   * @param {any} carpet world.carpet or null (off) @param {{data:Float32Array, w:number, h:number, x0:number, y0:number, cell:number}|null} nearH
   * @param {number} version bump on every class-map / near-band rebake: the textures re-upload only then
   */
  setCarpet(carpet, nearH, version) {
    if (!carpet || !nearH) { this.active = false; this.ran = false; this._carpet = null; this._nearH = null; return; }
    if (this._carpet !== carpet || this._nearH !== nearH || this._version !== version || this._dirty) {
      this._carpet = carpet; this._nearH = nearH; this._version = version;
      this._upload(carpet, nearH);
    }
    this.active = true;
  }
  setTime(sec) { this.timeSec = sec; }
  /** world wind field params (`createWind(..).params`) or null = calm. */
  setWind(params) { this.windParams = params || null; }
  /** groundFootprint hashCell parameter (the shade pass's hashCell: <0 = -k, >0 fixed cell, 0 = default k). */
  setFootprintK(k) { this.fpK = k; }

  _upload(carpet, nearH) {
    const d = this.device;
    if (!this.texClass || this._clW !== carpet.w || this._clH !== carpet.h) {
      if (this.texClass) d.dispose(this.texClass);
      this.texClass = d.createTexture({ format: 'r8ui', width: carpet.w, height: carpet.h }); this._clW = carpet.w; this._clH = carpet.h;
    }
    if (!this.texNear || this._nW !== nearH.w || this._nH !== nearH.h) {
      if (this.texNear) d.dispose(this.texNear);
      this.texNear = d.createTexture({ format: 'r32f', width: nearH.w, height: nearH.h }); this._nW = nearH.w; this._nH = nearH.h;
    }
    d.writeTexture(this.texClass, carpet.classMap, { x: 0, y: 0, w: carpet.w, h: carpet.h }, 0); this.stats.classUploads++;
    d.writeTexture(this.texNear, nearH.data, { x: 0, y: 0, w: nearH.w, h: nearH.h }, 0); this.stats.nearUploads++;
    packCarpetConfig(carpet, nearH, this.u, this.ui);
  }

  /**
   * Runs the pass for this frame. @param {any} p WgCellPipeline (needs p._cam and a pitched p._rasterPass) @param {any} t targets of the pipeline
   * @returns {any|null} alias of `t` with the carpet-adjusted GI/GA/Depth, or null when it did not run (use `t`)
   */
  run(p, t) {
    this.ran = false;
    const rp = p._rasterPass, cam = p._cam;
    if (!this.active || !cam || !rp || !rp.pitched || rp.ortho || !this.texClass || !this.texNear) return null; // perspective + pitched only (ortho: no carpet)
    if (p.cols !== this.cols || p.rows !== this.rows || !this.target) this.resize(p.cols, p.rows);
    const f = this.u, q = rp.pitch;
    this.ui[W_COLS] = this.cols; this.ui[W_ROWS] = this.rows;
    f[W_TIME] = this.timeSec; f[W_FPK] = this.fpK;
    packCarpetWind(this.windParams, f, this.ui);
    // PREC-01a: lattice origin (i32 cell of the eye) and the eye relative to it, computed in f64 here
    const cm = f[W_CELL], ix0 = Math.floor(cam.x / cm), iy0 = Math.floor(cam.y / cm);
    this.ui[W_IX0] = ix0; this.ui[W_IY0] = iy0; f[W_ORGX] = ix0 * cm; f[W_ORGY] = iy0 * cm;
    f[W_EYE] = cam.x - ix0 * cm; f[W_EYE + 1] = cam.y - iy0 * cm; f[W_EYE + 2] = cam.z; f[W_EYE + 3] = 0;
    f[W_PA] = q.fX; f[W_PA + 1] = q.fY; f[W_PA + 2] = q.fZ; f[W_PA + 3] = q.tanHalfX;
    f[W_PB] = q.rX; f[W_PB + 1] = q.rY; f[W_PB + 2] = q.uX; f[W_PB + 3] = q.uY;
    f[W_PC] = q.uZ; f[W_PC + 1] = q.tanHalfY; f[W_PC + 2] = 0; f[W_PC + 3] = 0;
    const tx = this.tex, d = this.device;
    tx[0].texture = t.texGI; tx[1].texture = t.texGA; tx[2].texture = t.texDepth; tx[3].texture = this.texClass; tx[4].texture = this.texNear;
    d.beginPass(this.target); d.bind(this.pipe, this.bindDesc); d.draw(3); d.endPass();
    if (this._viewFor !== t) { this._view = Object.create(t); this._viewFor = t; }
    const v = this._view;
    v.texGI = this.texGI; v.texGA = this.texGA; v.texDepth = this.texDepth;
    this.ran = true; this.stats.runs++;
    return v;
  }

  _freeTargets() {
    const d = this.device;
    for (const k of ['target', 'texGI', 'texGA', 'texDepth']) if (this[k]) { try { d.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
  }
  dispose() {
    this._freeTargets();
    for (const k of ['texClass', 'texNear', 'pipe']) if (this[k]) { try { this.device.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
  }
}
