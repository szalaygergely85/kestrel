// INTRO-PLAYER-01 (D-111/D-112): the opening slideshow shown after "New game" (never on Continue).
// Nine ASCII stills from content/intro/*.ascii.json (tools/img2ascii.py), read-time hold (holdSeconds) with 0.8 s fades through black, caption under each.
// Three parts: a pure sequence state machine (createIntroSequence, Node-tested), a slide decoder + loader that skips
// missing files silently, and a drawer onto the UI cell layer (ui.setCellRGB). titleMenuHost keeps the menu "active"
// (sim frozen) while the player runs and calls onNewGame when it finishes.

/** File order + captions (docs/story.md "Opening sequence v2"; <= 60 chars per line, ASCII only). */
export const INTRO_SLIDES = [
  { file: '01-ferrum', lines: ['Ferrum. Rings of stone and brass, lamps that never gutter.', 'Inside, everyone knows: nobody lives beyond the Wall.'] },
  { file: '01b-before', lines: ['My sister trimmed the skyworks lamps. I carried her oil.', 'She said the old stones under the Wards could sing.'] },
  { file: '02-lamp', lines: ['Seven winters ago my sister went up to the skyworks.', 'Her lamp came back trimmed and shuttered. She did not.'] },
  { file: '03-light', lines: ['One night, far beyond the Wall, a light.', 'Short and long. A word. Again. Again.'] },
  { file: '04-memory', lines: ['Morse. She taught me with a shuttered lamp.', 'In the shut Factory, where merchants once signalled.'] },
  { file: '05-alive', lines: ['It is one word: ALIVE.', 'The Crown says marsh-fire. Thirty nights, I map it.'] },
  { file: '06-rope', lines: ['Midnight. A knife, a mooring rope, a Crown ship that', 'was never mine. The rope gives.'] },
  { file: '07-wall', lines: ['The Wall slides under me. Its lamps wake one by one.', 'Then the ballistae. A bolt through the envelope.'] },
  { file: '08-fall', lines: ['The burner roars. A broken tower opens like a mouth.', 'Stone, moss, brass. The map in my fist. Then nothing.'] },
];

/** Keys that advance to the next slide (Escape skips everything). */
export const INTRO_NEXT_KEYS = ['Space', 'Enter', 'ArrowRight', 'ArrowDown', 'KeyE', 'KeyF'];

/**
 * Pure slide sequence. update(dt) advances time; next()/skip() are the player's inputs.
 * @param {{count:number, slideSec?:number, fadeSec?:number, onSlide?:(i:number)=>void, onDone?:()=>void}} o
 */
export function createIntroSequence({ count, slideSec = 4, fadeSec = 0.8, onSlide = null, onDone = null }) {
  const s = { index: 0, t: 0, done: count <= 0 };
  const dur = (i) => (typeof slideSec === 'function' ? slideSec(i) : slideSec); // total slide time incl. both fades
  const fire = (f, ...a) => { try { if (f) f(...a); } catch { /* hooks must never break the intro */ } };
  if (s.done) fire(onDone); else fire(onSlide, 0); // music hook: slide 0 starts at construction
  const finish = () => { if (s.done) return; s.done = true; fire(onDone); };
  const seq = {
    get index() { return s.index; },
    get t() { return s.t; },
    get done() { return s.done; },
    /** 0..1 brightness: fade in at the start, fade out at the end of a slide. */
    get alpha() {
      if (s.done) return 0;
      const a = Math.min(1, s.t / fadeSec, (dur(s.index) - s.t) / fadeSec);
      return a < 0 ? 0 : a;
    },
    update(dt) {
      if (s.done) return;
      s.t += dt;
      if (s.t >= dur(s.index)) advance();
    },
    /** Player input: mid-fade-in finishes the fade first, otherwise go to the next slide. */
    next() {
      if (s.done) return;
      if (s.t < fadeSec) { s.t = fadeSec; return; }
      advance();
    },
    skip() { finish(); },
  };
  function advance() {
    {
      s.index++; s.t = 0;
      if (s.index >= count) { s.index = count - 1; finish(); } else fire(onSlide, s.index);
    }
  }
  return seq;
}

/** Decode one *.ascii.json into typed arrays (palette index per cell, fg/bg as rgb triples). Returns null when malformed. */
export function decodeSlide(json) {
  try {
    const { cols, rows, ramp, palette, glyphs } = json;
    const n = cols * rows;
    if (!(n > 0) || typeof glyphs !== 'string' || glyphs.length !== n || !Array.isArray(palette)) return null;
    const unb64 = (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const fg = unb64(json.fg), bg = unb64(json.bg);
    if (fg.length !== n || bg.length !== n) return null;
    const rgb = new Uint8Array(palette.length * 3);
    palette.forEach((h, i) => { const v = parseInt(h.slice(1), 16); rgb[i * 3] = v >> 16 & 255; rgb[i * 3 + 1] = v >> 8 & 255; rgb[i * 3 + 2] = v & 255; });
    const gi = new Uint8Array(n);
    for (let i = 0; i < n; i++) gi[i] = glyphs.charCodeAt(i) - 32;
    return { cols, rows, glyph: gi, fg, bg, rgb, ramp };
  } catch { return null; }
}

/**
 * Fetch + decode the slides. A missing/failed/bad file is dropped silently (its caption goes with it);
 * returns [] when nothing loaded (caller then skips the intro).
 * @param {(url:string)=>Promise<any>} getJson
 */
export async function loadIntroSlides(getJson, base = '../content/intro/') {
  const out = [];
  const loaded = await Promise.all(INTRO_SLIDES.map(async (d) => {
    try { return decodeSlide(await getJson(base + d.file + '.ascii.json')); } catch { return null; }
  }));
  loaded.forEach((slide, i) => { if (slide) out.push({ slide, lines: INTRO_SLIDES[i].lines }); });
  return out;
}

/** Owner OB-216: reading time from the caption length. Total slide time = hold + fade in + fade out. */
export function holdSeconds(lines) {
  const chars = (lines || []).reduce((n, l) => n + l.length, 0);
  return Math.max(7, 2.5 + 0.07 * chars);
}

const CAPTION_RGB = [232, 220, 190];
const HINT_RGB = [110, 104, 90];
const HINT = 'any key: next';

export const SLIDE_BRIGHT = 1.15; // OB-219: owner found the slides dark
// OB-219 ratio fix: tools/img2ascii.py crops the still to 16:9 and resizes it to cols x rows, so one cell is 2:3 (w:h).
// 4 x 6 px per cell -> 400x150 slide = 1600x900 canvas = 16:9, drawn letterboxed (never stretched).
const CELL_W = 4, CELL_H = 6;

/** OB-219: paint a slide cell-for-cell (native grid, no downsample) with a 2D-context-like `ctx`. Returns cells painted. */
export function paintSlideNative(ctx, slide, cellW = CELL_W, cellH = CELL_H, bright = SLIDE_BRIGHT) {
  const { cols, rows, glyph, fg, bg, rgb } = slide;
  const c = (k) => Math.min(255, Math.round(rgb[k] * bright));
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cols * cellW, rows * cellH);
  ctx.font = `${cellH}px monospace`; ctx.textBaseline = 'top';
  let n = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, f = fg[i] * 3, b = bg[i] * 3;
    ctx.fillStyle = `rgb(${c(b)},${c(b + 1)},${c(b + 2)})`; ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    if (glyph[i] > 0) { ctx.fillStyle = `rgb(${c(f)},${c(f + 1)},${c(f + 2)})`; ctx.fillText(String.fromCharCode(glyph[i] + 32), x * cellW, y * cellH); }
    n++;
  }
  return n;
}

/**
 * OB-219: DOM overlay canvas that shows the slide at its native 400x150 grid over the top part of the game canvas
 * (the caption band stays on the UI layer). Slides are painted once and cached; fades use CSS opacity.
 */
export function createSlideOverlay(gameCanvas, doc = document) {
  const el = doc.createElement('canvas');
  el.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:50;background:#000;object-fit:contain';
  doc.body.appendChild(el);
  const cache = new Map(); // slide -> ImageBitmap-ish canvas
  return {
    show(slide, alpha, capRows, uiRows) {
      if (alpha <= 0) { el.style.display = 'none'; return; }
      let src = cache.get(slide);
      if (!src) {
        src = doc.createElement('canvas'); src.width = slide.cols * CELL_W; src.height = slide.rows * CELL_H;
        paintSlideNative(src.getContext('2d'), slide); cache.set(slide, src);
      }
      if (el.width !== src.width) { el.width = src.width; el.height = src.height; }
      el.getContext('2d').drawImage(src, 0, 0);
      const r = gameCanvas.getBoundingClientRect(), h = r.height * (uiRows - capRows) / uiRows, ar = src.width / src.height;
      const w = Math.min(r.width, h * ar), hh = w / ar; // keep the slide's own aspect inside the area above the caption
      el.style.left = (r.left + (r.width - w) / 2) + 'px'; el.style.top = (r.top + (h - hh) / 2) + 'px'; el.style.width = w + 'px'; el.style.height = hh + 'px';
      el.style.opacity = String(Math.min(1, alpha)); el.style.display = 'block';
    },
    hide() { el.style.display = 'none'; },
  };
}

/** Draw one slide (fit + centred, brightness `alpha`) and its caption onto the UI cell layer. With `nativeOverlay` the slide itself is drawn by the overlay canvas, the UI layer only paints black + caption. */
export function drawIntroFrame(ui, slide, lines, alpha, nativeOverlay = false) {
  const W = ui.cols, H = ui.rows;
  ui.clear('#000000');
  // OB-216: ui.clear() is TRANSPARENT, so the title-menu world showed through between slides. Paint every cell opaque black.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ui.setCellRGB(x, y, 0, 0, 0, 0, 0, 0, 0);
  if (alpha <= 0) return;
  if (nativeOverlay) nativeOverlay.show(slide, alpha, lines.length + 3, H);
  const k = Math.max(slide.cols / W, slide.rows / H);
  const dw = nativeOverlay ? 0 : Math.min(W, Math.floor(slide.cols / k)), dh = Math.min(H, Math.floor(slide.rows / k));
  const ox = (W - dw) >> 1, oy = (H - dh) >> 1;
  const { glyph, fg, bg, rgb } = slide;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(slide.rows - 1, Math.floor(y * k)) * slide.cols;
    for (let x = 0; x < dw; x++) {
      const i = sy + Math.min(slide.cols - 1, Math.floor(x * k));
      const f = fg[i] * 3, b = bg[i] * 3;
      ui.setCellRGB(ox + x, oy + y, glyph[i], rgb[f] * alpha, rgb[f + 1] * alpha, rgb[f + 2] * alpha, rgb[b] * alpha, rgb[b + 1] * alpha, rgb[b + 2] * alpha);
    }
  }
  // caption: two lines on a dark band at the bottom
  const top = H - 2 - lines.length;
  for (let y = top - 1; y <= H - 1; y++) for (let x = 0; x < W; x++) ui.setCellRGB(x, y, 0, 0, 0, 0, 0, 0, 0);
  lines.forEach((text, li) => {
    const x0 = (W - text.length) >> 1;
    for (let c = 0; c < text.length; c++) {
      const g = text.charCodeAt(c) - 32;
      if (g > 0) ui.setCellRGB(x0 + c, top + li, g, CAPTION_RGB[0] * alpha, CAPTION_RGB[1] * alpha, CAPTION_RGB[2] * alpha, 0, 0, 0);
    }
  });
  const hx = (W - HINT.length) >> 1; // small dim hint on the last row (no Esc wording; Esc still skips silently)
  for (let c = 0; c < HINT.length; c++) {
    const g = HINT.charCodeAt(c) - 32;
    if (g > 0) ui.setCellRGB(hx + c, H - 1, g, HINT_RGB[0] * alpha, HINT_RGB[1] * alpha, HINT_RGB[2] * alpha, 0, 0, 0);
  }
}

/**
 * Host-facing player. `entries` = loadIntroSlides() result. Returns null when there is nothing to play.
 * @param {{entries:Array<{slide:object,lines:string[]}>, onSlide?:(i:number)=>void, onDone:()=>void, slideSec?:number|((i:number)=>number), fadeSec?:number}} o
 */
export function createIntroPlayer({ entries, onSlide = null, onDone: onDone0, slideSec = null, fadeSec = 0.8, overlay = null }) {
  const onDone = () => { if (overlay) overlay.hide(); onDone0(); };
  if (!entries || !entries.length) return null;
  const perSlide = slideSec != null ? slideSec : (i) => holdSeconds(entries[i].lines) + 2 * fadeSec;
  const seq = createIntroSequence({ count: entries.length, slideSec: perSlide, fadeSec, onSlide, onDone });
  return {
    get done() { return seq.done; },
    seq,
    /** One fixed step: `pressed(code)` edges + dt seconds. */
    step(pressed, dt = 1 / 60) {
      if (seq.done) return;
      if (pressed('Escape')) { seq.skip(); return; }
      if (typeof pressed.any === 'function' ? pressed.any() : INTRO_NEXT_KEYS.some((k) => pressed(k))) seq.next(); // any key (main passes pressed.any)
      seq.update(dt);
    },
    click() { seq.next(); },
    draw(ui) {
      const e = entries[seq.index];
      if (e && !seq.done) drawIntroFrame(ui, e.slide, e.lines, seq.alpha, overlay); else if (overlay) overlay.hide();
    },
  };
}
