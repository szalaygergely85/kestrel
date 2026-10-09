// game/js/quest/dialogueView.js (DIALOGUE-01b1, architecture.md 38.28 item 4/8).
// Pure draw of the dialogue box into a duck-typed UiLayer ({cols, rows,
// setCellRGB}). It reads a runner (engine/ui/dialogue.js) only through its
// public fields; no input, no main.js wiring (that is 01b2). Zero allocation
// per draw: glyphs come from charCodeAt(i) for i < visibleChars, word wrap is
// computed by scanning the line string each frame (no slice/split).
//
// Skin: the title/settings brass frame (uiStyle.menu / settings.full).

// DESIGN: uiStyle.dialogue pending. This is the ONLY place the fallback lives;
// once the designer adds ASSETS.uiStyle.dialogue it overrides these keys.
const FALLBACK_STYLE = {
  frame: { corner: '+', h: '=', v: '|', color: '#c9a04a', cornerColor: '#f0d27a' },
  plate: [10, 11, 16],
  band: [52, 42, 16],
  name: '#fff0b4', namePlayer: '#4fd66a', nameDecor: '#f0d27a',
  text: '#e8e2d0', choice: '#a9a390', choiceSel: '#ffd24a', cursor: '#ffd24a',
  marker: { glyph: 'v', color: '#ffd24a', blinkSec: 0.5 },
  hint: { text: ' [Esc] close ', color: '#6a6a78' },
  maxW: 60,        // box width (56 text cols + 2 pad + 2 frame)
  textRows: 3, maxChoices: 3,
};

function rgbOf(hex) {
  if (Array.isArray(hex)) return hex;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * @param {{style?: object}} [opt] style = ASSETS.uiStyle.dialogue (optional)
 */
export function createDialogueView(opt = {}) {
  const s = Object.assign({}, FALLBACK_STYLE, opt.style || {});
  const fr = Object.assign({}, FALLBACK_STYLE.frame, s.frame || {});
  const mk = Object.assign({}, FALLBACK_STYLE.marker, s.marker || {});
  const hn = Object.assign({}, FALLBACK_STYLE.hint, s.hint || {});
  const C = {
    frame: rgbOf(fr.color), corner: rgbOf(fr.cornerColor), plate: rgbOf(s.plate), band: rgbOf(s.band),
    name: rgbOf(s.name), namePlayer: rgbOf(s.namePlayer), nameDecor: rgbOf(s.nameDecor),
    text: rgbOf(s.text), choice: rgbOf(s.choice), choiceSel: rgbOf(s.choiceSel), cursor: rgbOf(s.cursor),
    marker: rgbOf(mk.color), hint: rgbOf(hn.color),
  };
  const cH = fr.corner.charCodeAt(0), hH = fr.h.charCodeAt(0), vH = fr.v.charCodeAt(0);
  const markCode = mk.glyph.charCodeAt(0);
  const hintText = hn.text;
  const TEXT_ROWS = s.textRows, MAX_CH = s.maxChoices;
  const BOX_H = 2 + TEXT_ROWS + MAX_CH; // frame + text rows + choice rows (fixed: the box never jumps)

  let ui = null;
  function put(x, y, code, c, bg) {
    if (code <= 32) { // space: plate only
      ui.setCellRGB(x, y, 0, c[0], c[1], c[2], bg[0], bg[1], bg[2]);
      return;
    }
    ui.setCellRGB(x, y, code - 32, c[0], c[1], c[2], bg[0], bg[1], bg[2]);
  }
  function str(x, y, text, c, bg, maxX) {
    for (let i = 0; i < text.length && x + i < maxX; i++) put(x + i, y, text.charCodeAt(i), c, bg);
  }

  /** Word-wrap scan: end (exclusive) of the row starting at `start`. */
  function rowEnd(line, start, w) {
    const n = line.length;
    if (n - start <= w) return n;
    let brk = -1;
    for (let i = start; i <= start + w; i++) if (line.charCodeAt(i) === 32) brk = i;
    return brk > start ? brk : start + w; // hard break for an over-long word
  }

  return {
    boxHeight: BOX_H,
    /**
     * @param {{cols:number, rows:number, setCellRGB:Function}} layer
     * @param {object} r runner (state, speakerLabel, isPlayer, line, visibleChars, choiceCount, choiceText(i), selected)
     * @param {number} timeSec for the marker blink
     */
    draw(layer, r, timeSec) {
      if (r.state === 'idle' || r.state === 'ended') return;
      ui = layer;
      const cols = layer.cols, rows = layer.rows;
      const w = Math.min(s.maxW, cols - 2);
      const h = Math.min(BOX_H, rows - 1);
      if (w < 12 || h < 5) return;
      const x0 = ((cols - w) >> 1), y0 = rows - h - ((rows / 8) | 0) - 1 > 0 ? rows - h - ((rows / 8) | 0) - 1 : 0;
      const x1 = x0 + w - 1, y1 = y0 + h - 1;
      const plate = C.plate;
      // plate + frame
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const edgeX = x === x0 || x === x1, edgeY = y === y0 || y === y1;
          if (edgeX && edgeY) put(x, y, cH, C.corner, plate);
          else if (edgeY) put(x, y, hH, C.frame, plate);
          else if (edgeX) put(x, y, vH, C.frame, plate);
          else put(x, y, 32, C.text, plate);
        }
      }
      // name tag on the top frame: "[ NAME ]" at col 3
      const label = r.speakerLabel || '';
      const maxName = w - 10 > 0 ? w - 10 : 0;
      const nameLen = label.length < maxName ? label.length : maxName;
      let nx = x0 + 3;
      put(nx++, y0, 91, C.nameDecor, plate); // [
      put(nx++, y0, 32, C.name, plate);
      const nc = r.isPlayer ? C.namePlayer : C.name;
      for (let i = 0; i < nameLen; i++) put(nx++, y0, label.charCodeAt(i), nc, plate);
      put(nx++, y0, 32, C.name, plate);
      put(nx, y0, 93, C.nameDecor, plate); // ]
      // hint in the bottom frame, right
      const hx = x1 - 2 - hintText.length;
      if (hx > x0 + 2) str(hx, y1, hintText, C.hint, plate, x1);
      // text: rows wrapped on the fly, typed prefix only
      const line = r.line || '';
      const tw = w - 4, tx = x0 + 2;
      const vis = r.visibleChars;
      let start = 0;
      for (let row = 0; row < TEXT_ROWS && start < line.length && row < h - 2; row++) {
        const end = rowEnd(line, start, tw);
        const y = y0 + 1 + row;
        for (let i = start; i < end && i < vis; i++) put(tx + i - start, y, line.charCodeAt(i), C.text, plate);
        start = end;
        while (start < line.length && line.charCodeAt(start) === 32) start++;
      }
      // waiting: blinking continue marker, bottom-right of the text area
      if (r.state === 'waiting' && ((timeSec / mk.blinkSec) | 0) % 2 === 0) {
        put(x1 - 2, y0 + TEXT_ROWS, markCode, C.marker, plate);
      }
      // choices
      if (r.state === 'choosing') {
        const n = r.choiceCount < MAX_CH ? r.choiceCount : MAX_CH;
        for (let i = 0; i < n; i++) {
          const y = y0 + 1 + TEXT_ROWS + i;
          if (y >= y1) break;
          const sel = i === r.selected;
          const bg = sel ? C.band : plate;
          if (sel) for (let x = x0 + 1; x < x1; x++) put(x, y, 32, C.text, bg);
          if (sel) put(tx, y, 62, C.cursor, bg); // >
          str(tx + 2, y, r.choiceText(i), sel ? C.choiceSel : C.choice, bg, x1 - 1);
        }
      }
      ui = null;
    },
  };
}
