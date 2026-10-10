// EMIS-03/04 (architecture.md 38.12 (2)+(3)): WgGlowPass - emissive bleed + halo as ONE fullscreen pass after edge / stable, before
// sprites (glow.wgsl.js; JS twin engine/render/glow.js). Optional: WgCellPipeline builds it only with `opts.glow`.
//   const gp = new WgGlowPass(device);      // pipeline; no targets yet
//   gp.resize(cols, rows);                  // outFg/outBg rgba8 + target
//   gp.configure({radius, gain, haloBg, haloMin})   // from GLOW_LEVELS / ?emissive=; radius 0 or null = off
//   gp.run(t, inFg, inBg, matF)             // t: texGI/texDepth; matF = shade pass texMatF; -> gp.outFg / gp.outBg (valid when gp.ran)
// Per frame only the uniform words and texture refs change (0 allocations). No GPU timer slot (all 16 are taken): it runs inside the
// untimed gap; measure it with the `glow` gpucompare/perf row.
import { GLOW_BLOCK, GLOW_WGSL, GLOW_TEXTURES, GLOW_RAMP_MAX } from '../wgsl/glow.wgsl.js';
import { HALO_GLYPHS, GLOW_RADIUS_MAX } from '../../glow.js';

const W = (n) => GLOW_BLOCK.field(n).word;
const W_COLS = W('gridCols'), W_ROWS = W('gridRows'), W_RADIUS = W('radius'), W_RAMPN = W('rampN');
const W_GAIN = W('gain'), W_HALOBG = W('haloBg'), W_HALOMIN = W('haloMin'), W_RAMP = W('ramp');

/** Pure, Node-tested: writes the GlowU words. */
export function packGlowUniforms(P, cols, rows, f32, i32) {
  i32[W_COLS] = cols; i32[W_ROWS] = rows;
  i32[W_RADIUS] = Math.max(0, Math.min(GLOW_RADIUS_MAX, P.radius | 0));
  const n = Math.min(HALO_GLYPHS.length, GLOW_RAMP_MAX);
  i32[W_RAMPN] = n;
  f32[W_GAIN] = P.gain; f32[W_HALOBG] = P.haloBg; f32[W_HALOMIN] = P.haloMin;
  for (let k = 0; k < GLOW_RAMP_MAX; k++) f32[W_RAMP + k] = k < n ? HALO_GLYPHS[k] : 0;
}

export class WgGlowPass {
  /** @param {any} device */
  constructor(device) {
    this.device = device;
    this.cols = 0; this.rows = 0; this.ran = false; this.params = null;
    this.pipe = device.createPipeline({
      vertex: { src: { wgsl: GLOW_WGSL } }, fragment: { src: { wgsl: GLOW_WGSL }, targets: 2 },
      bindings: { uniformBytes: GLOW_BLOCK.sizeBytes, textures: GLOW_TEXTURES.slice() },
      targetFormats: ['rgba8', 'rgba8'], cull: 'none',
    });
    this.u = new Float32Array(GLOW_BLOCK.sizeWords); this.ui = new Int32Array(this.u.buffer);
    this.tex = GLOW_TEXTURES.map((_, slot) => ({ slot, texture: null }));
    this.bindDesc = { uniforms: this.u, textures: this.tex };
    this.outFgTex = null; this.outBgTex = null; this.target = null;
  }

  resize(cols, rows) {
    const d = this.device;
    if (cols === this.cols && rows === this.rows && this.target) return;
    this._free();
    this.outFgTex = d.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.outBgTex = d.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.target = d.createTarget({ color: [this.outFgTex, this.outBgTex] });
    this.cols = cols; this.rows = rows; this.ran = false;
  }

  /** @param {{radius:number, gain:number, haloBg:number, haloMin:number}|null} P null / radius 0 = off */
  configure(P) { this.params = P && P.radius > 0 ? P : null; }
  get enabled() { return !!this.params; }
  get outFg() { return this.ran ? this.outFgTex : null; }
  get outBg() { return this.ran ? this.outBgTex : null; }

  run(t, inFg, inBg, matF) {
    this.ran = false;
    if (!this.params || !this.target || !t || !matF) return false;
    packGlowUniforms(this.params, this.cols, this.rows, this.u, this.ui);
    const tx = this.tex, d = this.device;
    tx[0].texture = t.texGI; tx[1].texture = t.texDepth; tx[2].texture = inFg; tx[3].texture = inBg; tx[4].texture = matF;
    d.beginPass(this.target); d.bind(this.pipe, this.bindDesc); d.draw(3); d.endPass();
    this.ran = true;
    return true;
  }

  _free() {
    const d = this.device;
    for (const k of ['target', 'outFgTex', 'outBgTex']) if (this[k]) { try { d.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
  }
  dispose() {
    this._free();
    if (this.pipe) { try { this.device.dispose(this.pipe); } catch (_) { /* best effort */ } this.pipe = null; }
  }
}
