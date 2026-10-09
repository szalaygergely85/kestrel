// game/js/quest/dialogueView.js (DIALOGUE-01b1 + DIALOGUE-STYLE-01, architecture.md 38.28 item 4/8).
// Pure draw of the dialogue box into a duck-typed UiLayer ({cols, rows, setCellRGB}). It reads a runner
// (engine/ui/dialogue.js) only through its public fields; no input. Zero allocation per draw: glyphs come
// from charCodeAt, word wrap + `*word*` emphasis are done in one scan of the line, colours are pre-resolved.
//
// Skin = the designer's ASSETS.uiStyle.dialogue (design/models/title.js, mock design/preview/dialogue-box.html):
// fg values are palette KEYS (resolved through ASSETS.palette), bg values literal RGB (bgRgb). Every key has a
// built-in fallback (DEF below = the designer's v1.51 values), so a missing / odd key never crashes.
// Not drawn (UiLayer is write-only): plate pad dimming of the scene, sceneDim, fadeIn/Out.

const DEF = {
  panel: { w: 96, h: 12, bottomMargin: 3 },
  bgRgb: { plate: [10, 11, 16], band: [52, 42, 16] },
  frame: { corner: '+', h: '=', v: '|', fg: 'brass', cornerFg: 'brassLight', rivets: { glyph: 'o', cols: [3, 92], fg: 'brassLight' } },
  nameTag: { col: 6, bracketFg: 'brassLight', fg: { npc: 'brassHot', player: 'heroGreen' } },
  text: { row: 2, col: 3, w: 88, maxLines: 4, fg: 'uiText', emphasis: { mark: '*', fg: 'gold' }, typeOn: { cps: 28 } },
  more: { glyph: 'v', col: 4, fg: 'gold', blink: { periodSec: 0.8, duty: 0.6 } }, // col = distance from the right edge
  separator: { row: 6, glyph: '-', fg: 'brassShadow', inset: 3 },
  choices: { firstRow: 7, max: 3, markerCol: 1, numberCol: 3, textCol: 6, bandFrom: 1, bandTo: 94,
    number: { fg: 'uiDim', focusFg: 'brassLight' }, normal: { fg: 'uiText' },
    focus: { fg: 'gold', marker: '>', markerFg: 'gold' }, seen: { fg: 'uiHint' }, disabled: { fg: 'uiDim', suffix: ' (locked)' } },
  keyHints: { fg: 'uiDim', keyFg: 'gold', text: 'E: next   W/S: choose   Esc: leave' },
};
// Last-resort colours when neither the palette nor the key resolves.
const FB = { brass: [201, 160, 74], brassLight: [240, 210, 122], brassHot: [255, 240, 180], heroGreen: [79, 214, 106], uiText: [232, 226, 208],
  gold: [255, 210, 74], brassShadow: [74, 55, 22], uiDim: [106, 106, 120], uiHint: [169, 163, 144] };
const WHITE = [255, 255, 255];

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
function num(v, fb) { return typeof v === 'number' && isFinite(v) ? v : fb; }
function chr(v, fb) { return typeof v === 'string' && v.length > 0 ? v.charCodeAt(0) : fb.charCodeAt(0); }
/** Deep fill: values of `st` win where they have the same kind as the default, else the default stays. */
function merge(def, st) {
  const out = {};
  for (const k of Object.keys(def)) {
    const d = def[k], v = isObj(st) ? st[k] : undefined;
    if (isObj(d)) out[k] = merge(d, v);
    else out[k] = v !== undefined && typeof v === typeof d && Array.isArray(v) === Array.isArray(d) ? v : d;
  }
  return out;
}
function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

/**
 * @param {{style?: object, palette?: object}} [opt] style = ASSETS.uiStyle.dialogue; palette = ASSETS.palette
 *   ({colors:{key:'#rrggbb'}} or {rgb:{key:[r,g,b]}}); defaults to globalThis.ASSETS.palette.
 */
export function createDialogueView(opt = {}) {
  const S = merge(DEF, opt.style);
  const P = opt.palette || (globalThis.ASSETS && globalThis.ASSETS.palette) || null;
  /** palette key | '#hex' | [r,g,b] -> [r,g,b] (resolved once at creation). */
  function col(v, fbKey) {
    if (Array.isArray(v) && v.length >= 3) return v;
    if (typeof v === 'string') {
      if (v[0] === '#' && v.length === 7) return hexRgb(v);
      const r = P && P.rgb && P.rgb[v]; if (r) return r;
      const h = P && P.colors && P.colors[v]; if (typeof h === 'string' && h.length === 7) return hexRgb(h);
    }
    return fbKey && FB[fbKey] ? FB[fbKey] : WHITE;
  }
  const bg = (v, fb) => (Array.isArray(v) && v.length >= 3 ? v : fb);
  const { frame: fr, nameTag: nt, text: tx, more: mo, separator: sp, choices: ch, keyHints: kh } = S;
  const C = {
    plate: bg(S.bgRgb.plate, DEF.bgRgb.plate), band: bg(S.bgRgb.band, DEF.bgRgb.band),
    frame: col(fr.fg, 'brass'), corner: col(fr.cornerFg, 'brassLight'), rivet: col(fr.rivets.fg, 'brassLight'),
    bracket: col(nt.bracketFg, 'brassLight'), npc: col(nt.fg.npc, 'brassHot'), player: col(nt.fg.player, 'heroGreen'),
    text: col(tx.fg, 'uiText'), emph: col(tx.emphasis.fg, 'gold'), more: col(mo.fg, 'gold'), sep: col(sp.fg, 'brassShadow'),
    num: col(ch.number.fg, 'uiDim'), numFocus: col(ch.number.focusFg, 'brassLight'), normal: col(ch.normal.fg, 'uiText'),
    focus: col(ch.focus.fg, 'gold'), marker: col(ch.focus.markerFg, 'gold'), seen: col(ch.seen.fg, 'uiHint'), dis: col(ch.disabled.fg, 'uiDim'),
    hint: col(kh.fg, 'uiDim'), hintKey: col(kh.keyFg, 'gold'),
  };
  const cH = chr(fr.corner, '+'), hH = chr(fr.h, '='), vH = chr(fr.v, '|'), rivetCode = chr(fr.rivets.glyph, 'o');
  const markCode = chr(mo.glyph, 'v'), sepCode = chr(sp.glyph, '-'), starCode = chr(tx.emphasis.mark, '*'), focusMarker = chr(ch.focus.marker, '>');
  const rivetCols = Array.isArray(fr.rivets.cols) ? fr.rivets.cols : DEF.frame.rivets.cols;
  const disSuffix = typeof ch.disabled.suffix === 'string' ? ch.disabled.suffix : '';
  const PANEL_W = num(S.panel.w, 96), PANEL_H = num(S.panel.h, 12), MARGIN = num(S.panel.bottomMargin, 3);
  const NO_CH_H = 8, MAX_CH = num(ch.max, 3) | 0, MAX_LINES = num(tx.maxLines, 4) | 0;
  const period = num(mo.blink.periodSec, 0.8) > 0 ? num(mo.blink.periodSec, 0.8) : 0.8, duty = num(mo.blink.duty, 0.6);

  // Key hints: precomputed text + per-char "is key" flag (the part before each ':'), with / without the W/S part.
  function hintOf(withChoose) {
    let t = typeof kh.text === 'string' ? kh.text : DEF.keyHints.text;
    if (!withChoose) t = t.split('   ').filter((p) => p.indexOf('W/S') !== 0).join('   ');
    const key = new Uint8Array(t.length);
    let k = 1;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === ':') k = 0;
      else if (i >= 3 && t[i] !== ' ' && t[i - 1] === ' ' && t[i - 2] === ' ' && t[i - 3] === ' ') k = 1;
      key[i] = k && t[i] !== ' ' ? 1 : 0;
    }
    return { t, key };
  }
  const HINT_NEXT = hintOf(false), HINT_CHOOSE = hintOf(true);

  // The typing speed the runner should be created with (style typeOn.cps).
  const cps = num(tx.typeOn.cps, 28) > 0 ? num(tx.typeOn.cps, 28) : 28;

  let ui = null;
  function put(x, y, code, c, b) {
    ui.setCellRGB(x, y, code > 32 ? code - 32 : 0, c[0], c[1], c[2], b[0], b[1], b[2]);
  }
  function str(x, y, text, c, b, maxX) {
    for (let i = 0; i < text.length && x + i < maxX; i++) put(x + i, y, text.charCodeAt(i), c, b);
  }
  /** Visible length of the word starting at `i` (stops at space, skips the emphasis marks). */
  function wordLen(line, i) {
    let n = 0;
    for (; i < line.length; i++) { const c = line.charCodeAt(i); if (c === 32) break; if (c !== starCode) n++; }
    return n;
  }

  return {
    cps, boxHeight: PANEL_H, colors: C,
    /**
     * @param {{cols:number, rows:number, setCellRGB:Function}} layer
     * @param {object} r runner (state, speakerLabel, isPlayer, line, visibleChars, choiceCount, choiceText(i), selected);
     *   optional r.choiceSeen(i) / r.choiceDisabled(i) for the seen / locked looks
     * @param {number} timeSec for the marker blink
     */
    draw(layer, r, timeSec) {
      if (r.state === 'idle' || r.state === 'ended') return;
      ui = layer;
      const cols = layer.cols, rows = layer.rows;
      const choosing = r.state === 'choosing';
      const w = Math.min(PANEL_W, cols - 2);
      const h = Math.min(choosing ? PANEL_H : NO_CH_H, rows - 1);
      if (w < 12 || h < 5) { ui = null; return; }
      const x0 = (cols - w) >> 1, yb = rows - MARGIN - (choosing ? PANEL_H : NO_CH_H);
      const y0 = yb > 0 ? yb : 0;
      const plate = C.plate, x1 = x0 + w - 1, y1 = y0 + h - 1;
      // plate + frame
      for (let y = y0; y <= y1; y++) {
        const edgeY = y === y0 || y === y1;
        for (let x = x0; x <= x1; x++) {
          const edgeX = x === x0 || x === x1;
          if (edgeX && edgeY) put(x, y, cH, C.corner, plate);
          else if (edgeY) put(x, y, hH, C.frame, plate);
          else if (edgeX) put(x, y, vH, C.frame, plate);
          else put(x, y, 32, C.text, plate);
        }
      }
      // rivets on top + bottom
      for (let i = 0; i < rivetCols.length; i++) {
        const rc = rivetCols[i] | 0;
        if (rc > 0 && rc < w - 1) { put(x0 + rc, y0, rivetCode, C.rivet, plate); put(x0 + rc, y1, rivetCode, C.rivet, plate); }
      }
      // name tag over the top frame: "[ NAME ]"
      const label = r.speakerLabel || '';
      const ntc = num(nt.col, 6) | 0;
      const maxName = w - 2 * ntc - 4;
      const nameLen = label.length < maxName ? label.length : (maxName > 0 ? maxName : 0);
      let nx = x0 + ntc;
      put(nx++, y0, 91, C.bracket, plate);
      put(nx++, y0, 32, C.bracket, plate);
      const nc = r.isPlayer ? C.player : C.npc;
      for (let i = 0; i < nameLen; i++) put(nx++, y0, label.charCodeAt(i), nc, plate);
      put(nx++, y0, 32, C.bracket, plate);
      put(nx, y0, 93, C.bracket, plate);
      // text: one scan, word wrap + *emphasis*, typed prefix only
      const line = r.line || '';
      const tcol = num(tx.col, 3) | 0;
      const tw = Math.min(num(tx.w, 88) | 0, w - 2 * tcol);
      const tX = x0 + tcol, tY = y0 + (num(tx.row, 2) | 0);
      const maxL = Math.min(MAX_LINES, h - 3);
      const vis = r.visibleChars, n = line.length;
      let row = 0, cx = 0, emph = false;
      for (let i = 0; i < n && i < vis && row < maxL; i++) {
        const c = line.charCodeAt(i);
        if (c === starCode) { emph = !emph; continue; }
        if (c === 32) {
          if (cx === 0) continue;                              // no leading space on a row
          if (cx + 1 + wordLen(line, i + 1) > tw) { row++; cx = 0; continue; } // wrap: the space is swallowed
          cx++; continue;                                      // space cell is already plate
        }
        if (cx >= tw) { row++; cx = 0; if (row >= maxL) break; } // over-long word: hard break
        put(tX + cx, tY + row, c, emph ? C.emph : C.text, plate);
        cx++;
      }
      // key hints (right-aligned, ending left of the `more` marker)
      const hint = choosing ? HINT_CHOOSE : HINT_NEXT;
      const hy = y1 - 1, markX = x1 - (num(mo.col, 4) | 0) + 1;
      const hx = markX - hint.t.length;
      if (hx > x0 + 2) for (let i = 0; i < hint.t.length; i++) put(hx + i, hy, hint.t.charCodeAt(i), hint.key[i] ? C.hintKey : C.hint, plate);
      // `more` marker: line complete, no choices
      if (r.state === 'waiting' && (timeSec % period) / period < duty) put(markX, hy, markCode, C.more, plate);
      // choices
      if (choosing) {
        const cnt = r.choiceCount < MAX_CH ? r.choiceCount : MAX_CH;
        const inset = num(sp.inset, 3) | 0, sepY = y0 + (num(sp.row, 6) | 0);
        if (sepY < y1) for (let x = x0 + inset; x <= x1 - inset; x++) put(x, sepY, sepCode, C.sep, plate);
        const bFrom = x0 + (num(ch.bandFrom, 1) | 0), bTo = Math.min(x0 + (num(ch.bandTo, 94) | 0), x1 - 1);
        for (let i = 0; i < cnt; i++) {
          const y = y0 + (num(ch.firstRow, 7) | 0) + i;
          if (y >= y1) break;
          const dis = r.choiceDisabled ? r.choiceDisabled(i) : false;
          const sel = i === r.selected && !dis;
          const b = sel ? C.band : plate;
          if (sel) { for (let x = bFrom; x <= bTo; x++) put(x, y, 32, C.text, b); put(x0 + (num(ch.markerCol, 1) | 0), y, focusMarker, C.marker, b); }
          const nX = x0 + (num(ch.numberCol, 3) | 0);
          put(nX, y, 49 + i, sel ? C.numFocus : C.num, b);
          put(nX + 1, y, 46, sel ? C.numFocus : C.num, b);
          const seen = r.choiceSeen ? r.choiceSeen(i) : false;
          const tc = dis ? C.dis : sel ? C.focus : seen ? C.seen : C.normal;
          const tX2 = x0 + (num(ch.textCol, 6) | 0), t = r.choiceText(i);
          str(tX2, y, t, tc, b, x1 - 1);
          if (dis) str(tX2 + t.length, y, disSuffix, tc, b, x1 - 1);
        }
      }
      ui = null;
    },
  };
}
