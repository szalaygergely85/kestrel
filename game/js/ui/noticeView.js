// CH1-04a: notice banner (architecture 38.37 item 4). Centred plate near the top: title row (<= 30) + up to 3 body lines (<= 38).
// Fade in 0.3 s, hold 3.5 s, fade out 0.5 s. Non-blocking (no input). Queue of 2 pending: a third push drops the OLDEST pending, never the showing one.
// Strings are formatted at push(); update()/draw() allocate nothing. While `hidden` (menu/dialogue) the timer is paused and nothing is drawn.
import { NOTICE_TEXT } from './noticeText.js';

export const FADE_IN = 0.3, HOLD = 3.5, FADE_OUT = 0.5, MAX_PENDING = 2, MAX_TITLE = 30, MAX_LINE = 38, TOP_ROW = 3;
const TOTAL = FADE_IN + HOLD + FADE_OUT;
const BG = [14, 12, 8], TITLE_FG = [255, 214, 110], BODY_FG = [232, 224, 200];

function make(title, lines) {
  const body = [];
  for (let i = 0; i < lines.length && i < 3; i++) body.push(String(lines[i]).slice(0, MAX_LINE));
  const t = String(title).slice(0, MAX_TITLE);
  let w = t.length; for (const l of body) if (l.length > w) w = l.length;
  return { title: t, body, w: w + 4 };
}

export function createNoticeView() {
  let showing = null, t = 0;
  const pending = [];
  return {
    /** push(textKey) or push(title, lines[]). Returns false for an unknown key. */
    push(a, lines) {
      const n = lines === undefined ? (NOTICE_TEXT[a] && make(NOTICE_TEXT[a].title, NOTICE_TEXT[a].lines)) : make(a, lines);
      if (!n) return false;
      if (!showing) { showing = n; t = 0; return true; }
      if (pending.length >= MAX_PENDING) pending.shift();
      pending.push(n); return true;
    },
    update(dt, hidden) {
      if (!showing || hidden) return;
      t += dt;
      if (t >= TOTAL) { showing = pending.length ? pending.shift() : null; t = 0; }
    },
    /** 0..1 opacity of the showing notice (0 when none). */
    get alpha() { return !showing ? 0 : t < FADE_IN ? t / FADE_IN : t < FADE_IN + HOLD ? 1 : Math.max(0, 1 - (t - FADE_IN - HOLD) / FADE_OUT); },
    get active() { return showing !== null; },
    get pendingCount() { return pending.length; },
    get title() { return showing ? showing.title : ''; },
    draw(ui, hidden) {
      if (!showing || hidden) return;
      const a = this.alpha; if (a <= 0) return;
      const w = showing.w, x0 = ((ui.cols - w) >> 1);
      const rows = 1 + showing.body.length, bgR = BG[0] * a | 0, bgG = BG[1] * a | 0, bgB = BG[2] * a | 0;
      for (let r = -1; r <= rows; r++) {
        const y = TOP_ROW + r; if (y < 0 || y >= ui.rows) continue;
        for (let c = 0; c < w; c++) { const x = x0 + c; if (x >= 0 && x < ui.cols) ui.setCellRGB(x, y, 0, 0, 0, 0, bgR, bgG, bgB); }
      }
      row(ui, showing.title, TOP_ROW, x0, w, TITLE_FG, a, bgR, bgG, bgB);
      for (let i = 0; i < showing.body.length; i++) row(ui, showing.body[i], TOP_ROW + 1 + i, x0, w, BODY_FG, a, bgR, bgG, bgB);
    },
  };
}

function row(ui, s, y, x0, w, fg, a, bgR, bgG, bgB) {
  if (y >= ui.rows) return;
  const sx = x0 + ((w - s.length) >> 1), r = fg[0] * a | 0, g = fg[1] * a | 0, b = fg[2] * a | 0;
  for (let j = 0; j < s.length; j++) { const x = sx + j; if (x >= 0 && x < ui.cols) ui.setCellRGB(x, y, s.charCodeAt(j) - 32, r, g, b, bgR, bgG, bgB); }
}
