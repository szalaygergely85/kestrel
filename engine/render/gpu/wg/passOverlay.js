// WG-3f: device-only overlay composite (WebGPU twin of GpuOverlayPass, RE-07b, architecture.md 28.9; GL source engine/render/gpu/overlayPass.js).
// Standalone: B1 wires it. The overlay cells are rasterised in JS (engine/ui/overlay.js); this pass uploads the layer (`ovl` rgba8 + `ovlZ` r32f)
// and draws one fullscreen triangle with the depth rule of WGSL `overlayHidden` into the FG texture ONLY (glyph + fg; bg stays; empty/hidden
// cells `discard`, no blend, load op = keep what the sprite pass wrote).
//
// B1 plug-in (pipeline at construct; textures + target at resize / setTarget; nothing per frame):
//   const ov = new WgOverlayPass(device, engine.overlay);
//   ov.resize(cols, rows)              // in resizeGrid: creates the layer textures (OVL rgba8, OVL_Z r32f)
//   ov.setTarget(sp.outFg)             // the FG texture to draw into = the sprite pass output (call again after sp.resize replaced it; no-op if same)
//   per frame, AFTER sp.run(...) (GL order: sprites -> overlay -> present):  ov.run(texDepth)   // texDepth = r32uint resolved depth
//     - skipped (no upload, no pass) when neither this frame nor the last had overlay cells, or the layer is not bound to this grid yet.
//   No own active switch: `ov.ran` says whether it drew this frame; the final fg is sp.outFg either way (bg = sp.outBg, untouched).
//   Stats: ov.stats.{rows, runs, drawn}. Readback: read the target through sp.readbackCells (the overlay modifies sp.outFg in place).
//   dispose() frees everything.
//
// Dirty rows upload as a row slice (writeTexture dataOffset, no subarray), like the GL pass; `stats.rows` = dirty-row count.
import { OVERLAY_WGSL, OVERLAY_TEXTURES } from '../wgsl/overlay.wgsl.js';

export class WgOverlayPass {
  /** @param {any} device @param {any} overlay engine.overlay */
  constructor(device, overlay) {
    this.device = device;
    this.overlay = overlay;
    this.cols = 0; this.rows = 0;
    this.stats = { rows: 0, runs: 0, drawn: 0 };
    this.ran = false;
    this._rowRect = { x: 0, y: 0, w: 0, h: 0 }; // reused dirty-row rect for writeTexture (no per-frame allocation)
    this.texOvl = null; this.texOvlZ = null; this.target = null; this._fg = null; this._ovlRef = null; this._full = true;
    this.tex = [{ slot: 0, texture: null }, { slot: 1, texture: null }, { slot: 2, texture: null }];
    this.bindDesc = { uniforms: null, textures: this.tex };
    this.pipe = device.createPipeline({
      vertex: { src: { wgsl: OVERLAY_WGSL } }, fragment: { src: { wgsl: OVERLAY_WGSL }, targets: 1 },
      bindings: { uniformBytes: 0, textures: OVERLAY_TEXTURES.slice() },
      targetFormats: ['rgba8'], cull: 'none',
    });
  }

  resize(cols, rows) {
    if (this.texOvl && cols === this.cols && rows === this.rows) return;
    const d = this.device;
    for (const h of [this.texOvl, this.texOvlZ]) if (h) d.dispose(h);
    this.texOvl = d.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.texOvlZ = d.createTexture({ format: 'r32f', width: cols, height: rows });
    this.cols = cols; this.rows = rows; this._full = true;
  }

  /** The fg texture the overlay draws into (sprite pass `outFg`). */
  setTarget(fgTex) {
    if (fgTex === this._fg) return;
    if (this.target) { this.device.dispose(this.target); this.target = null; }
    this._fg = fgTex;
    if (fgTex) this.target = this.device.createTarget({ color: [fgTex] });
  }

  /** @param {any} depth r32uint resolved depth texture (pipeline texDepth) */
  run(depth) {
    this.ran = false;
    const ov = this.overlay;
    if (!this.target || !this.texOvl) return;
    if (ov.cols !== this.cols || ov.rows !== this.rows) return; // layer not bound to the scene grid yet
    const hasNow = ov.stats.cells > 0, hadPrev = ov.prevMaxRow >= 0;
    if (!hasNow && !hadPrev) { this.stats.rows = 0; return; }
    const d = this.device;
    if (ov.ovl !== this._ovlRef) { this._ovlRef = ov.ovl; this._full = true; } // overlay.bind swaps arrays on every accepted grid request
    let r0 = this.rows, r1 = -1;
    if (hasNow) { r0 = ov.minRow; r1 = ov.maxRow; }
    if (hadPrev) { if (ov.prevMinRow < r0) r0 = ov.prevMinRow; if (ov.prevMaxRow > r1) r1 = ov.prevMaxRow; }
    if (this._full) { r0 = 0; r1 = this.rows - 1; this._full = false; }
    if (r1 >= r0) {
      const rect = this._rowRect; rect.y = r0; rect.w = this.cols; rect.h = r1 - r0 + 1;
      d.writeTexture(this.texOvl, ov.ovl, rect, r0 * this.cols * 4);
      d.writeTexture(this.texOvlZ, ov.ovlZ, rect, r0 * this.cols);
      this.stats.rows = r1 - r0 + 1;
    }
    if (hasNow) {
      const tx = this.tex;
      tx[0].texture = this.texOvl; tx[1].texture = this.texOvlZ; tx[2].texture = depth;
      d.beginPass(this.target); // no clear: keeps the sprite pass output, discarded cells stay untouched
      d.bind(this.pipe, this.bindDesc);
      d.draw(3, 0, 1);
      d.endPass();
      this.ran = true; this.stats.drawn++;
    }
    this.stats.runs++;
  }

  dispose() {
    const d = this.device;
    for (const k of ['target', 'texOvl', 'texOvlZ', 'pipe']) if (this[k]) { try { d.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
    this._fg = null;
  }
}
