// game/js/quest/toastView.js (US-091a2, docs/architecture.md 37.16.3). The loot toast: "% +1 Boar Meat" lines at
// the top-centre of the UI layer, max 3, newest at the bottom, 1.5 s each. Style = the designer's
// `ASSETS.items.toast` (design/items.js: anchor row, plate, gold "+n", white pop for the first steps, a dim fade
// over the last steps, same item again restarts its line with the new total).
//
// Listens to `inventory:added {id, n}` / `inventory:full` (emitted by sim/loot.js). Line text is built on the event
// (rare), never per frame; drawing walks the prebuilt strings with charCodeAt and writes setCellRGB (no allocation).
// Time is render time: a line's birth is stamped at the first draw after its event (the event fires inside a sim
// step, which has no clock), and its age in 60 Hz steps is `(timeSec - born) * 60`.

const STEP_HZ = 60;

/**
 * @param {{on: Function}} events
 * @param {any} style `ASSETS.items.toast`
 * @param {Record<string, any>} defs item defs (`ASSETS.items.defs`) - name + glyph per id
 * @param {Record<string, number[]>} rgb palette key -> [r, g, b] (`assets.palette.rgb`) for the item glyph colours
 */
export function createToastView(events, style, defs, rgb) {
  const max = style.maxLines;
  /** Fixed line records, index 0 = oldest (top). `kind` 0 = empty, 1 = item, 2 = message. */
  const lines = [];
  for (let i = 0; i < max; i++) {
    lines.push({ kind: 0, id: '', n: 0, born: -1, glyph: 0, glyphRgb: null, plus: '', text: '', fg: null });
  }
  let used = 0;

  /** Frees the bottom slot: drop the oldest (top) line and shift the rest up when all are in use. */
  function nextLine() {
    if (used < max) return lines[used++];
    const top = lines[0];
    for (let i = 1; i < max; i++) lines[i - 1] = lines[i];
    lines[max - 1] = top;
    return top;
  }

  function findLine(kind, id) {
    for (let i = 0; i < used; i++) if (lines[i].kind === kind && lines[i].id === id) return lines[i];
    return null;
  }

  function onAdded(p) {
    const def = defs[p.id];
    if (!def) return;
    let L = findLine(1, p.id);
    if (L) {
      L.n += p.n; // style.stack: same item while visible -> "+{total}", life restarts
    } else {
      L = nextLine();
      L.kind = 1; L.id = p.id; L.n = p.n;
      L.text = def.name;
      L.glyph = def.glyph ? def.glyph.ch.charCodeAt(0) : 0;
      L.glyphRgb = def.glyph && rgb[def.glyph.c] ? rgb[def.glyph.c] : style.colors.name;
    }
    L.plus = '+' + L.n;
    L.born = -1;
  }

  function onFull() {
    const msg = style.messages.packFull;
    let L = findLine(2, 'packFull');
    if (!L) {
      L = nextLine();
      L.kind = 2; L.id = 'packFull'; L.n = 0; L.plus = ''; L.glyph = 0; L.glyphRgb = null;
      L.text = msg.text; L.fg = msg.fg;
    }
    L.born = -1;
  }

  /** US-091b: a one-line message toast (same plate, 1.5 s); the same text again restarts its line. Allocates on the event only. */
  function say(text, fg) {
    let L = findLine(2, text);
    if (!L) {
      L = nextLine();
      L.kind = 2; L.id = text; L.n = 0; L.plus = ''; L.glyph = 0; L.glyphRgb = null;
      L.text = text; L.fg = fg;
    }
    L.born = -1;
  }

  const offs = [events.on('inventory:added', onAdded), events.on('inventory:full', onFull)];

  const view = {
    lines,
    get used() { return used; },
    say,
    /** Clears every line (world load / restart: a toast never carries over). */
    reset() {
      for (let i = 0; i < max; i++) lines[i].kind = 0;
      used = 0;
    },
    dispose() { for (const off of offs) off(); },
    /**
     * Expires old lines, then draws the rest at `style.anchor.row` (oldest) downwards, each centred on its own width.
     * @param {any} ui UiLayer (setCellRGB, cols)
     * @param {number} timeSec render clock
     */
    draw(ui, timeSec) {
      const life = style.lifeSteps;
      // expire, compacting in place (order kept: oldest first)
      let w = 0;
      for (let i = 0; i < used; i++) {
        const L = lines[i];
        if (L.born < 0) L.born = timeSec;
        if ((timeSec - L.born) * STEP_HZ >= life) { L.kind = 0; continue; }
        if (w !== i) { const t = lines[w]; lines[w] = L; lines[i] = t; }
        w++;
      }
      used = w;
      for (let i = 0; i < used; i++) drawLine(ui, style, lines[i], style.anchor.row + i, (timeSec - lines[i].born) * STEP_HZ);
    },
  };
  return view;
}

/** Linear blend of two RGB triples into the shared scratch `out` (no allocation). */
const mixOut = [0, 0, 0];
function mix(a, b, k) {
  mixOut[0] = a[0] + (b[0] - a[0]) * k;
  mixOut[1] = a[1] + (b[1] - a[1]) * k;
  mixOut[2] = a[2] + (b[2] - a[2]) * k;
  return mixOut;
}

function put(ui, x, y, code, fg, bg) {
  if (x < 0 || x >= ui.cols) return;
  ui.setCellRGB(x, y, code - 32, fg[0] | 0, fg[1] | 0, fg[2] | 0, bg[0], bg[1], bg[2]);
}

function putText(ui, x, y, s, fg, bg) {
  for (let j = 0; j < s.length; j++) put(ui, x + j, y, s.charCodeAt(j), fg, bg);
  return x + s.length;
}

/** Width in cells of a line without its plate: "G +n Name" (item) or "Text" (message). */
export function lineWidth(L) {
  return L.kind === 1 ? (L.glyph ? 2 : 0) + L.plus.length + 1 + L.text.length : L.text.length;
}

function drawLine(ui, style, L, y, age) {
  const c = style.colors, pad = style.plate.pad, plate = c.plate;
  const w = lineWidth(L);
  let x = (ui.cols - w) >> 1;
  for (let j = x - pad; j < x + w + pad; j++) put(ui, j, y, 32, plate, plate);
  const fadeAt = style.lifeSteps - style.fade.lastSteps;
  const k = age > fadeAt ? (age - fadeAt) / style.fade.lastSteps : 0;
  if (L.kind === 2) { putText(ui, x, y, L.text, k > 0 ? mix(L.fg, style.fade.nameTo, k) : L.fg, plate); return; }
  if (L.glyph) { put(ui, x, y, L.glyph, L.glyphRgb, plate); x += 2; }
  x = putText(ui, x, y, L.plus, k > 0 ? mix(c.plus, style.fade.plusTo, k) : c.plus, plate);
  const nameFg = age < style.popSteps ? style.pop.name : (k > 0 ? mix(c.name, style.fade.nameTo, k) : c.name);
  putText(ui, x + 1, y, L.text, nameFg, plate);
}
