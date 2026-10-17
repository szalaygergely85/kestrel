// game/js/quest/regionBanner.js (REGION-01): region-entry banner. On entering a world_geo region its approved place name
// fades in top-centre on the UI layer (2x glyphs, OB-051 path): fadeIn / hold / fadeOut seconds from design/ui-region-banner.js.
// Fires on the first entry per save (seen-set `region.seen` in world.state, saved with it) and on re-entry after >= awaySec away
// (PO default 600 s). Border jitter never re-fires (seen + away rule). While `blocked` (dialogue, menu, note, travel fade) the
// banner is queued / paused, never drawn. A region without a name (names[id] null/missing) shows nothing. 0 alloc per step.
import { drawTextScaled } from '../../../engine/index.js';

const QUEUE_MAX = 4, LEVELS = 8;
export const SEEN_KEY = 'region.seen';

/** world_geo region id at (x, y): first rect match, else the last region (as design/levels/world_geo.js regionAt). */
export function regionIdAt(regions, x, y) {
  for (let i = 0; i < regions.length; i++) { const r = regions[i].r; if (x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) return regions[i].id; }
  return regions[regions.length - 1].id;
}

const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/**
 * @param {{style:Object, names:Object, regions:Array<{id:string,r:number[]}>, state:Object, colors:Object}} o
 *   state = world.state (the seen-set lives in it); colors = palette hex map (style.fg is a key into it).
 */
export function createRegionBanner({ style, names, regions, state, colors }) {
  const fgRGB = hexRGB(colors[style.fg] || style.fg), bgRGB = hexRGB(style.plate);
  const levelFg = []; // fg faded toward the plate colour, LEVELS+1 steps (precomputed: no string building per frame)
  for (let i = 0; i <= LEVELS; i++) { const k = i / LEVELS; levelFg.push(toHex(bgRGB.map((b, j) => b + (fgRGB[j] - b) * k))); }
  const total = style.fadeIn + style.hold + style.fadeOut;
  const ids = regions.map((r) => r.id), lastIn = new Float64Array(ids.length).fill(-1);
  const queue = new Int16Array(QUEUE_MAX); let qn = 0;
  let clock = 0, cur = -1, active = -1, t = 0;

  const seen = () => Array.isArray(state[SEEN_KEY]) ? state[SEEN_KEY] : (state[SEEN_KEY] = []);
  const idxAt = (x, y) => { const id = regionIdAt(regions, x, y); for (let i = 0; i < ids.length; i++) if (ids[i] === id) return i; return -1; };
  function enqueue(i) { for (let k = 0; k < qn; k++) if (queue[k] === i) return; if (i === active) return; if (qn < QUEUE_MAX) queue[qn++] = i; }

  /** One fixed step with the player's world x/y (metres); blocked = a panel / dialogue / note / travel fade is up. */
  function step(dt, x, y, blocked) {
    clock += dt;
    const i = idxAt(x, y);
    if (i !== cur) { // entry into region i
      const away = lastIn[i] < 0 ? Infinity : clock - lastIn[i];
      if (names[ids[i]]) {
        const s = seen();
        if (s.indexOf(ids[i]) < 0) enqueue(i);          // first entry per save
        else if (lastIn[i] >= 0 && away >= style.awaySec) enqueue(i); // returned after >= awaySec (unknown = loaded save: quiet)
      }
      cur = i;
    }
    lastIn[cur] = clock;
    if (blocked) return;
    if (active < 0) { // start the next still-relevant queued banner (drop ones the player already left)
      while (qn > 0) {
        const n = queue[0]; for (let k = 1; k < qn; k++) queue[k - 1] = queue[k]; qn--;
        if (n !== cur) continue;
        active = n; t = 0; const s = seen(); if (s.indexOf(ids[n]) < 0) s.push(ids[n]); break;
      }
    }
    if (active >= 0) { t += dt; if (t >= total) active = -1; }
  }

  /** 0..1 opacity now (0 when nothing shows). */
  function alpha() {
    if (active < 0) return 0;
    if (t < style.fadeIn) return t / style.fadeIn;
    if (t < style.fadeIn + style.hold) return 1;
    return Math.max(0, 1 - (t - style.fadeIn - style.hold) / style.fadeOut);
  }
  /** Text on screen now or ''. */
  function text() { return active >= 0 ? names[ids[active]] : ''; }

  /** Draw top-centre; call only when not blocked. Hidden banner (blocked) is simply not drawn. */
  function draw(ui) {
    const a = alpha(); if (a <= 0) return;
    const s = text(), scaled = style.scale === 2 && typeof ui.setCellScaled === 'function', w = scaled ? s.length * 2 : s.length;
    const lv = Math.max(1, Math.round(a * LEVELS)), fg = levelFg[lv], bg = style.plate;
    const px = scaled ? ((ui.cols - w) >> 1) & ~1 : (ui.cols - w) >> 1, py = scaled ? style.y & ~1 : style.y;
    if (scaled) drawTextScaled(ui, px, py, s, fg, bg);
    else for (let i = 0; i < s.length; i++) ui.setCell(px + i, py, s[i], fg, bg);
  }

  function reset() { clock = 0; cur = -1; active = -1; t = 0; qn = 0; lastIn.fill(-1); }
  return { step, draw, alpha, text, reset, get queued() { return qn; }, get active() { return active >= 0; }, get region() { return cur >= 0 ? ids[cur] : null; }, width: (s) => s.length * (style.scale === 2 ? 2 : 1) };
}
