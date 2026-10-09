// DEMO-MODE-01 (US-112 B1 part): `?demo=1` public demo build. Pure helpers, no window/DOM access (runs in Node).
// main.js parses once, then reads the FILTERED params everywhere, so every dev flag outside the allow-list is ignored.
export const DEMO_ALLOW = Object.freeze(['quality', 'res', 'fx']);
export const DEMO_STORAGE_SUFFIX = ':demo'; // the "demo" save slot name: every save key is namespaced, slots 1-3 stay untouched
export const DEMO_BUILD_LINE = 'demo build';
export const END_CARD_TEXT = 'NEEDS WRITER: demo.endcard'; // docs/story.md has no end-card key yet (<= 38 chars)
export const END_CARD_CHOICES = ['Restart', 'Keep exploring'];

/** @param {string|URLSearchParams|null|undefined} search @returns {{on:boolean, allow:string[]}} garbage -> off. */
export function parseDemo(search) {
  let p;
  try { p = search instanceof URLSearchParams ? search : new URLSearchParams(typeof search === 'string' ? search : ''); } catch { return { on: false, allow: [] }; }
  if (p.get('demo') !== '1') return { on: false, allow: [] };
  return { on: true, allow: DEMO_ALLOW.slice() };
}

/** Params main.js reads: unchanged object when demo is off; otherwise only the allow-listed keys (demo itself is dropped). */
export function filterDemoParams(params, demo) {
  if (!demo.on) return params;
  const out = new URLSearchParams();
  for (const k of demo.allow) if (params.has(k)) out.set(k, params.get(k));
  return out;
}

/** localStorage-compatible wrapper that namespaces every key into the demo slot. */
export function demoStorage(storage) {
  if (!storage) return storage;
  return {
    getItem: (k) => storage.getItem(k + DEMO_STORAGE_SUFFIX),
    setItem: (k, v) => storage.setItem(k + DEMO_STORAGE_SUFFIX, v),
    removeItem: (k) => storage.removeItem(k + DEMO_STORAGE_SUFFIX),
  };
}

/** Wraps `input` so F-keys (dev overlays, god mode, sun keys) never fire in the demo. */
export function blockFKeys(input) {
  const pressed = input.pressed.bind(input);
  input.pressed = (c) => (/^F\d+$/.test(c) ? false : pressed(c));
  return input;
}

const FG = [232, 226, 208], DIM = [150, 146, 130], SEL = [255, 214, 120], BG = [10, 11, 16];
function put(ui, x, y, ch, fg) { if (x >= 0 && x < ui.cols && y >= 0 && y < ui.rows) ui.setCellRGB(x, y, ch.charCodeAt(0) - 32, fg[0], fg[1], fg[2], BG[0], BG[1], BG[2]); }
function text(ui, x, y, s, fg) { for (let i = 0; i < s.length; i++) put(ui, x + i, y, s[i], fg); }

/**
 * End card shown once per run on the waystone done event. `onRestart` / `onKeep` are injected callbacks.
 * Keys: ArrowLeft/ArrowRight/KeyA/KeyD select, Enter/Space choose.
 */
export function createEndCard({ onRestart, onKeep, text: msg = END_CARD_TEXT } = {}) {
  let shown = false, open = false, sel = 0;
  const card = {
    get open() { return open; },
    get shown() { return shown; },
    get selected() { return sel; },
    /** Call from the waystone done event; only the first call opens the card. Returns true when it opened. */
    trigger() { if (shown) return false; shown = true; open = true; sel = 0; return true; },
    step(pressed) {
      if (!open) return;
      if (pressed('ArrowLeft') || pressed('KeyA')) sel = 0;
      if (pressed('ArrowRight') || pressed('KeyD')) sel = 1;
      if (pressed('Enter') || pressed('Space')) { open = false; (sel === 0 ? onRestart : onKeep)?.(); }
    },
    draw(ui) {
      if (!open) return;
      const w = Math.max(msg.length, END_CARD_CHOICES.join('    ').length) + 6, h = 7;
      const x0 = Math.floor((ui.cols - w) / 2), y0 = Math.floor(ui.rows / 2) - 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(ui, x0 + x, y0 + y, ' ', FG);
      text(ui, x0 + Math.floor((w - msg.length) / 2), y0 + 2, msg, FG);
      let x = x0 + Math.floor((w - (END_CARD_CHOICES[0].length + END_CARD_CHOICES[1].length + 8)) / 2);
      for (let i = 0; i < 2; i++) { const s = (sel === i ? '> ' : '  ') + END_CARD_CHOICES[i]; text(ui, x, y0 + 4, s, sel === i ? SEL : DIM); x += s.length + 4; }
    },
  };
  return card;
}

/** Title-menu one-liner (drawn by main.js over the menu card; the lane C menu view has no slot for it, no NEEDS C needed). */
export function drawDemoBuildLine(ui) { text(ui, Math.max(0, Math.floor((ui.cols - DEMO_BUILD_LINE.length) / 2)), 1, DEMO_BUILD_LINE, DIM); }
