// engine/ui/panel.js (US-015, docs/architecture.md 7.6 item 2). Generic UI
// "panel" overlay: a model (design/README.md 5 shape - base rows + optional
// per-frame key overrides, same animation shape sprites use) baked once into
// a flat `PanelArt`, then opened/closed/stepped/drawn with no idea what it
// is showing (the map card today; US-021's log and later dialogue reuse it).
// No strings, no `ASSETS` read here (D-006) - `buildPanelArt` takes the
// model object and a resolved `palette` directly.
//
// Allocation rule (9): `step`/`pushDim`/`drawPanel` never allocate - only
// `buildPanelArt`/`createPanel` (load-time / open-time setup) do.
import { hexToRgb } from './richText.js';
import { fadeGlyph } from './fade.js';
import { pushDimRect } from './sceneDim.js';

/** @typedef {{w:number, h:number, nFrames:number, codes:Uint8Array, rgb:Uint8Array, durMs:Float64Array, loopMs:number}} PanelArt */

/**
 * Bakes `model.animations[animName]` (frames of `{S:{glyphs:[rows], fg:[rows]}}`,
 * `model.keys` mapping a fg-row char to `{c: paletteColorKey}`) into a flat
 * `PanelArt`. `codes[i] === 0` means "transparent" (space in the model,
 * never drawn - not the same as ASCII code 32, which the model never emits
 * for an opaque cell). Call once at load time.
 * @param {Object} model - `design/README.md` section 4/5 shape (e.g. `ASSETS.models.mapCard`)
 * @param {{colors:Object<string,string>}} palette
 * @param {string} [animName]
 * @returns {PanelArt}
 */
export function buildPanelArt(model, palette, animName = 'show') {
  const w = model.size.w, h = model.size.h;
  const anim = model.animations[animName];
  const frames = anim.frames;
  const nFrames = frames.length;
  const codes = new Uint8Array(nFrames * w * h);
  const rgb = new Uint8Array(nFrames * w * h * 3);
  const durMs = new Float64Array(nFrames);
  let loopMs = 0;
  const rgbCache = new Map(); // paletteColorKey -> [r,g,b], load-time only

  for (let f = 0; f < nFrames; f++) {
    const { glyphs, fg } = frames[f].S;
    for (let y = 0; y < h; y++) {
      const grow = glyphs[y] || '', krow = fg[y] || '';
      for (let x = 0; x < w; x++) {
        const gi = f * w * h + y * w + x;
        const ch = grow[x];
        if (!ch || ch === ' ') { codes[gi] = 0; continue; }
        codes[gi] = ch.charCodeAt(0);
        const keyCh = krow[x];
        const keyDef = keyCh && model.keys[keyCh];
        const colorKey = keyDef ? keyDef.c : null;
        let colRgb = colorKey && rgbCache.get(colorKey);
        if (!colRgb) {
          colRgb = hexToRgb(colorKey ? palette.colors[colorKey] : '#ffffff');
          if (colorKey) rgbCache.set(colorKey, colRgb);
        }
        const ri = gi * 3;
        rgb[ri] = colRgb[0]; rgb[ri + 1] = colRgb[1]; rgb[ri + 2] = colRgb[2];
      }
    }
    durMs[f] = anim.durations ? anim.durations[f] : (anim.fps ? 1000 / anim.fps : 1000);
    loopMs += durMs[f];
  }
  return { w, h, nFrames, codes, rgb, durMs, loopMs: loopMs || 1 };
}

/**
 * Runtime-only panel state (7.6 item 6: not part of `world.state`/save -
 * rebuilt on every 'world:loaded', see mapCard.js). Plain fields; the
 * methods below never allocate.
 */
export class Panel {
  /** @param {PanelArt} art @param {{fadeIn?:number, fadeOut?:number, sceneMul?:number, plateMul?:number, platePad?:number}} [opts] */
  constructor(art, opts = {}) {
    this.art = art;
    this.state = 'closed'; // 'closed' | 'opening' | 'open' | 'closing'
    this.a = 0;
    this.openSec = 0;
    this.fadeIn = typeof opts.fadeIn === 'number' ? opts.fadeIn : 0.3;
    this.fadeOut = typeof opts.fadeOut === 'number' ? opts.fadeOut : 0.3;
    this.sceneMul = typeof opts.sceneMul === 'number' ? opts.sceneMul : 1;
    this.plateMul = typeof opts.plateMul === 'number' ? opts.plateMul : 1;
    this.platePad = opts.platePad || 0;
    this.x0 = 0;
    this.y0 = 0;
  }

  open() {
    if (this.state === 'open') return;
    this.state = 'opening';
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closing';
  }

  /** @param {number} dtSec */
  step(dtSec) {
    if (this.state === 'closed') return;
    if (this.state === 'opening') {
      this.a += this.fadeIn > 0 ? dtSec / this.fadeIn : 1;
      if (this.a >= 1) { this.a = 1; this.state = 'open'; }
    } else if (this.state === 'closing') {
      this.a -= this.fadeOut > 0 ? dtSec / this.fadeOut : 1;
      if (this.a <= 0) { this.a = 0; this.state = 'closed'; this.openSec = 0; return; }
    }
    this.openSec += dtSec;
  }

  /**
   * UI-grid rule (7.6 item 4): `centerX`/`top` are 160x60 UI-grid cells;
   * this scales the panel's CENTRE into scene cells and keeps its size
   * (art.w/h) unscaled, so a `240x90`/`320x120` scene grid draws the same
   * glyph count, just re-centred.
   * @param {number} sceneCols @param {number} sceneRows
   * @param {number} top @param {number} centerX
   * @param {{cols:number, rows:number}} uiGrid
   */
  layout(sceneCols, sceneRows, top, centerX, uiGrid) {
    const sx = sceneCols / uiGrid.cols, sy = sceneRows / uiGrid.rows;
    const cx = Math.round(centerX * sx);
    this.y0 = Math.round(top * sy);
    this.x0 = cx - (this.art.w >> 1);
  }

  /**
   * Before render: `dim.all = lerp(1, sceneMul, a)` (whole-scene dim, e.g.
   * the map card), and a plate rect (`panel + platePad`) multiplied by
   * `lerp(1, plateMul, a)` (a dark sheet right under the panel so the 3D
   * view still ghosts through). Either multiplier defaults to 1 (no-op).
   *
   * OWN-REQ-003 (architecture.md 17.5): `x0`/`y0`/`art.w`/`art.h` are now UI-
   * grid cells (the panel draws into the fixed-size UI layer, section 17.4),
   * but `dim` always multiplies the SCENE's cells (`sceneDim.js` iterates
   * `rt.cells`, the scene CellBuffer) - so the plate rect is converted UI
   * cells -> scene cells via `ui.sx`/`ui.sy` (outset by `Math.floor`/`ceil`
   * so the darkened rect never clips a scaled-up glyph at its edge). `ui` is
   * optional (sx=sy=1, i.e. UI cells === scene cells) for callers that don't
   * have a `UiLayer` (tests, or a caller drawing straight into the scene).
   * @param {import('./sceneDim.js').SceneDim} dim
   * @param {import('./uiLayer.js').UiLayer} [ui]
   */
  pushDim(dim, ui) {
    if (this.state === 'closed') return;
    const a = this.a;
    if (this.sceneMul !== 1) {
      const all = 1 + (this.sceneMul - 1) * a;
      if (all < dim.all) dim.all = all;
    }
    if (this.plateMul !== 1) {
      const mul = 1 + (this.plateMul - 1) * a;
      const sx = ui ? ui.sx : 1, sy = ui ? ui.sy : 1;
      const ux0 = this.x0 - this.platePad, uy0 = this.y0 - this.platePad;
      const ux1 = this.x0 + this.art.w + this.platePad, uy1 = this.y0 + this.art.h + this.platePad;
      pushDimRect(dim,
        Math.floor(ux0 * sx), Math.floor(uy0 * sy),
        Math.ceil(ux1 * sx), Math.ceil(uy1 * sy), mul);
    }
  }
}

/** @param {PanelArt} art @param {Object} [opts] @returns {Panel} */
export function createPanel(art, opts) {
  return new Panel(art, opts);
}

/**
 * Draws the panel's current animation frame (by `timeMs % art.loopMs`),
 * skipping transparent cells (`code === 0`), fading at `panel.a` (ramp-step
 * rule, `lut` required once `a < 1`). No-op while closed.
 * @param {import('../render/RenderTarget.js').RenderTarget} rt
 * @param {Panel} panel @param {number} timeMs
 * @param {import('./fade.js').FadeLut|null} lut
 */
export function drawPanel(rt, panel, timeMs, lut) {
  if (panel.state === 'closed') return;
  const art = panel.art;
  const loop = art.loopMs > 0 ? art.loopMs : 1;
  const t = ((timeMs % loop) + loop) % loop;
  let f = 0, acc = 0;
  for (; f < art.nFrames; f++) {
    acc += art.durMs[f];
    if (t < acc) break;
  }
  if (f >= art.nFrames) f = art.nFrames - 1;

  const a = panel.a;
  const fgGain = lut ? lut.minGain + (1 - lut.minGain) * a : a;
  const base = f * art.w * art.h;
  for (let y = 0; y < art.h; y++) {
    for (let x = 0; x < art.w; x++) {
      const gi = base + y * art.w + x;
      const code = art.codes[gi];
      if (code === 0) continue;
      const ri = gi * 3;
      let outCode = code, r = art.rgb[ri], g = art.rgb[ri + 1], b = art.rgb[ri + 2];
      if (a < 1) {
        outCode = lut ? fadeGlyph(code, a, lut) : code;
        r = (r * fgGain) | 0; g = (g * fgGain) | 0; b = (b * fgGain) | 0;
      }
      if (outCode <= 32) continue;
      rt.setCellRGB(panel.x0 + x, panel.y0 + y, outCode - 32, r, g, b, 0, 0, 0);
    }
  }
}
