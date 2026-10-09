// US-073b (docs/architecture.md 38.25): WgStablePass - the device side of the temporal glyph-stability pass (stable.wgsl.js; JS twin
// temporalStable.js). Standalone, NOT wired into WgCellPipeline (US-073c: order after edge / before sprites, sprites + readback input,
// resizeGrid, invalidateHistory, `?stable=1`, timer slot).
//
// Plug-in surface for 073c:
//   const sp = new WgStablePass(device);          // pipeline; no targets yet
//   sp.resize(cols, rows);                         // ping-pong pair k = 0/1: {outFg, outBg: rgba8; hist: rgba32ui} (32 B/attachment set); history invalid
//   sp.invalidate();                               // teleport / camera cut / world load / cells not shaded / debug mode / enable (next frame = fresh)
//   sp.beginFrame(cam, grid, { invalidate });      // camera terms (f64 twin state) + the StableU words; returns histValid
//   sp.run(p, t, { shadeFg, shadeBg, water })      // t: texGI/GA/Depth/FinalFg/FinalBg/Level (+ ShadeFg/Bg); shadeFg/Bg = the edge pass INPUT
//                                                  // (default t.texShadeFg/Bg), water = WATER layer texture (default: 1x1 dummy = no water).
//   sp.outFg / sp.outBg                            // this frame's output (valid after run): sprites' edgeFg/edgeBg and the readback read these
// `this._k` is flipped HERE and only after a successful run (item 3). All textures/targets/bind descriptors are built at construct/resize;
// per frame only the uniform words and the shared texture refs change (0 allocations).
import { STABLE_BLOCK, STABLE_WGSL, STABLE_TEXTURES } from '../wgsl/stable.wgsl.js';
import { createStableState, beginFrame, CHANNEL_SNAP, DEFAULT_DETAIL } from '../../temporalStable.js';

const W = (n) => STABLE_BLOCK.field(n).word;
const W_CUR_A = W('curA'), W_CUR_B = W('curB'), W_CUR_C = W('curC'), W_PREV_A = W('prevA'), W_PREV_B = W('prevB'), W_PREV_C = W('prevC');
const W_DEYE = W('dEye'), W_COLS = W('gridCols'), W_ROWS = W('gridRows'), W_VALID = W('histValid'), W_ORTHO = W('ortho'), W_SNAP = W('snap'), W_DETAIL = W('detailDefault');
/** STABLE_TEXTURES slot order (stable.wgsl.js header). */
const ST = { GI: 0, GA: 1, DEPTH: 2, SHADE_FG: 3, SHADE_BG: 4, FINAL_FG: 5, FINAL_BG: 6, LEVEL: 7, WATER: 8, HIST_FG: 9, HIST_BG: 10, HIST: 11 };

function putTerms(f32, a, b, c, t) {
  f32[a] = t.fX; f32[a + 1] = t.fY; f32[a + 2] = t.fZ; f32[a + 3] = t.tanHalfX;
  f32[b] = t.rX; f32[b + 1] = t.rY; f32[b + 2] = t.uX; f32[b + 3] = t.uY;
  f32[c] = t.uZ; f32[c + 1] = t.tanHalfY; f32[c + 2] = 0; f32[c + 3] = 0;
}

/** Writes the StableU words from a twin state after `beginFrame` (f64 -> f32 here; pure, Node-tested). */
export function packStableUniforms(st, cols, rows, f32, i32) {
  putTerms(f32, W_CUR_A, W_CUR_B, W_CUR_C, st.cur);
  putTerms(f32, W_PREV_A, W_PREV_B, W_PREV_C, st.prev);
  f32[W_DEYE] = st.dEx; f32[W_DEYE + 1] = st.dEy; f32[W_DEYE + 2] = st.dEz; f32[W_DEYE + 3] = 0;
  i32[W_COLS] = cols; i32[W_ROWS] = rows; i32[W_VALID] = st.histValid ? 1 : 0; i32[W_ORTHO] = st.cur.ortho === 1 ? 1 : 0;
  i32[W_SNAP] = CHANNEL_SNAP; f32[W_DETAIL] = DEFAULT_DETAIL;
}

export class WgStablePass {
  /** @param {any} device */
  constructor(device) {
    this.device = device;
    this.cols = 0; this.rows = 0; this._k = 0; this.ran = false;
    this.st = createStableState();
    this.pipe = device.createPipeline({
      vertex: { src: { wgsl: STABLE_WGSL } }, fragment: { src: { wgsl: STABLE_WGSL }, targets: 3 },
      bindings: { uniformBytes: STABLE_BLOCK.sizeBytes, textures: STABLE_TEXTURES.slice() },
      targetFormats: ['rgba8', 'rgba8', 'rgba32ui'],
    });
    this.u = new Float32Array(STABLE_BLOCK.sizeWords); this.ui = new Int32Array(this.u.buffer);
    this.dummyWater = device.createTexture({ format: 'rgba32ui', width: 1, height: 1 });
    this.set = [null, null];
    this.tex = STABLE_TEXTURES.map((_, slot) => ({ slot, texture: null }));
    this.bindDesc = [{ uniforms: this.u, textures: this.tex }, { uniforms: this.u, textures: this.tex }];
    this._invalid = true;
  }

  /** (Re)allocates the ping-pong pair; history is invalid afterwards. */
  resize(cols, rows) {
    const d = this.device;
    const next = [0, 1].map(() => {
      const outFg = d.createTexture({ format: 'rgba8', width: cols, height: rows });
      const outBg = d.createTexture({ format: 'rgba8', width: cols, height: rows });
      const hist = d.createTexture({ format: 'rgba32ui', width: cols, height: rows });
      return { outFg, outBg, hist, target: d.createTarget({ color: [outFg, outBg, hist] }) };
    });
    this._freeSets();
    this.set = next; this.cols = cols; this.rows = rows; this._k = 0; this._invalid = true; this.ran = false;
  }

  invalidate() { this._invalid = true; }

  /** Camera terms + histValid for this frame. @returns {boolean} histValid */
  beginFrame(cam, grid, flags) {
    const inv = this._invalid || !!(flags && flags.invalidate);
    const valid = beginFrame(this.st, cam, grid, { invalidate: inv });
    this._invalid = false;
    packStableUniforms(this.st, this.cols, this.rows, this.u, this.ui);
    return valid;
  }

  // after a run `_k` already points at the NEXT write set, so this frame's output is set[_k ^ 1]
  get outFg() { return this.ran ? this.set[this._k ^ 1].outFg : null; }
  get outBg() { return this.ran ? this.set[this._k ^ 1].outBg : null; }

  run(p, t, inputs = null) {
    if (!this.set[0] || !t || !t.texLevel) return false;
    const d = this.device, k = this._k, out = this.set[k], hist = this.set[k ^ 1], tx = this.tex;
    const sFg = (inputs && inputs.shadeFg) || t.texShadeFg, sBg = (inputs && inputs.shadeBg) || t.texShadeBg;
    tx[ST.GI].texture = t.texGI; tx[ST.GA].texture = t.texGA; tx[ST.DEPTH].texture = t.texDepth;
    tx[ST.SHADE_FG].texture = sFg; tx[ST.SHADE_BG].texture = sBg; tx[ST.FINAL_FG].texture = t.texFinalFg; tx[ST.FINAL_BG].texture = t.texFinalBg;
    tx[ST.LEVEL].texture = t.texLevel; tx[ST.WATER].texture = (inputs && inputs.water) || this.dummyWater;
    tx[ST.HIST_FG].texture = hist.outFg; tx[ST.HIST_BG].texture = hist.outBg; tx[ST.HIST].texture = hist.hist;
    d.beginPass(out.target); d.bind(this.pipe, this.bindDesc[k]); d.draw(3); d.endPass();
    this._k = k ^ 1; this.ran = true; // flip only after a successful run
    return true;
  }

  _freeSets() {
    const d = this.device;
    for (const s of this.set) if (s) for (const f of ['target', 'outFg', 'outBg', 'hist']) { try { d.dispose(s[f]); } catch (_) { /* best effort */ } }
    this.set = [null, null];
  }

  dispose() {
    this._freeSets();
    for (const k of ['pipe', 'dummyWater']) if (this[k]) { try { this.device.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
  }
}
