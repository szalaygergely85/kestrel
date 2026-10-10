// COMPASS-01/02 (D-061): golden pocket compass HUD, bottom-right. Pure module: no DOM/clock/world mutation, zero allocation per frame.
// target(book, world) picks what to point at, step(x, y, yawDeg, z) turns it into a needle direction + metres, draw(ui, cols, rows, timeSec) paints it.
// World resolver (host-supplied): world.resolve(kind, id, out) -> bool, fills out.x/out.y (ground plane) and optionally out.z (NaN/unset = unknown).
//   kind = 'giver' (npc id) | 'area' | 'item' | 'beast' | 'flag' (flag objective: host maps the flag id to the entity that sets it).
// Style, two shapes:
//   (a) ASSETS.uiStyle.compass (designer, COMPASS-D1, design/models/compass_ui.js): { faces:{small,large}, dirs:16, hex, bgRgb, fgKeys, bgKeys, needleStyle, nMark,
//       distance, anchor, fadeIn/fadeOut, newTarget, swing, near } - needle states are relative to the VIEW (up = ahead, clockwise), N mark rides round the glass.
//   (b) FALLBACK_COMPASS_STYLE (tests / no design pack): { sectors, face: string[], faceFg, faceBg, needle:{glyphs,pos,fg}, text:{fg,gap}, margin:{right,bottom} }.
import { yawFromDelta } from '../../../engine/index.js';
import { ACTIVE } from '../quest/sim/questBook.js';

export const FALLBACK_COMPASS_STYLE = Object.freeze({
  sectors: 8,
  face: Object.freeze([' .-. ', '(   )', " '-' "]),
  faceFg: Object.freeze([214, 170, 60]),
  faceBg: Object.freeze([20, 14, 6]),
  needle: Object.freeze({
    glyphs: Object.freeze(['|', '/', '-', '\\', '|', '/', '-', '\\']),
    pos: Object.freeze([[2, 0], [3, 0], [3, 1], [3, 2], [2, 2], [1, 2], [1, 1], [1, 0]].map(p => Object.freeze(p))),
    fg: Object.freeze([255, 235, 150]),
  }),
  text: Object.freeze({ fg: Object.freeze([230, 200, 110]), gap: 0 }),
  margin: Object.freeze({ right: 2, bottom: 1 }),
});

const wrap360 = a => ((a % 360) + 360) % 360;
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Designer style -> flat draw tables (built once; draw only reads them). */
function compileDesigner(style) {
  const f = style.faces[style.face || 'small'];
  const col = k => hexRgb(style.hex[k] || style.hex.brass);
  const bgc = k => style.bgRgb[k];
  const cells = [], bgAt = new Array(f.w * f.h).fill(null);
  for (let r = 0; r < f.h; r++) for (let c = 0; c < f.w; c++) {
    const bk = f.bg[r][c]; if (bk === ' ') continue;
    const bg = bgc(style.bgKeys[bk]); bgAt[r * f.w + c] = bg;
    let ch = f.glyphs[r].charCodeAt(c), fk = f.fg[r][c];
    if (f.glint && f.glint.x === c && f.glint.y === r) { ch = f.glint.glyph.charCodeAt(0); fk = f.glint.fg; }
    const key = style.fgKeys[fk] || 'uiDim';
    cells.push({ x: c, y: r, ch, fg: col(key), bg, rim: fk === 'L' || fk === 'B' });
  }
  const needle = f.needle.map(list => list.map(([dx, dy, g, role]) => ({ x: f.hub.x + dx, y: f.hub.y + dy, ch: g.charCodeAt(0), role: role === 'x' ? 0 : role === 'b' ? 1 : 2 })));
  const ns = style.needleStyle;
  return {
    w: f.w, h: f.h, hub: f.hub, cells, bgAt, needle, nPos: f.nMark ? f.nMark.positions8 : null, dirs: style.dirs | 0 || 16,
    tail: col(ns.tail.fg), body: col(ns.body.fg), tipA: col(ns.tip.fg), tipB: col(ns.tip.pulseTo), tipPeriod: ns.tip.periodSec, nearPeriod: style.near.tipPeriodSec, nearM: style.near.withinM,
    hub0: col(ns.hub.fg), hubN: col(ns.hub.near.fg), hubCh: ns.hub.glyph.charCodeAt(0), hubNearCh: ns.hub.near.glyph.charCodeAt(0),
    nMarkCh: style.nMark && style.nMark.enabled ? style.nMark.glyph.charCodeAt(0) : 0, nMarkFg: style.nMark ? col(style.nMark.fg) : null,
    flashRim: col(style.newTarget.rimTo), flashSec: style.newTarget.ms / 1000,
    swingMin: style.swing.minSteps, swingOver: style.swing.overshootSteps, swingSec: style.swing.overshootMs / 1000,
    fadeIn: style.fadeIn, fadeOut: style.fadeOut, hyst: style.meaning.hysteresis.steps,
    plate: bgc(style.distance.bg), numFg: col(style.distance.number.fg), unitFg: col(style.distance.unit.fg), markFg: col(style.distance.kindMark.fg),
    hereFg: col(style.distance.here.fg), hereText: style.distance.here.text, heightFg: col(style.distance.height.fg), heightFromM: style.distance.height.fromM,
    anchor: style.anchor,
  };
}

export function createCompassHud({ style = FALLBACK_COMPASS_STYLE } = {}) {
  const D = style.faces ? compileDesigner(style) : null;
  const N = D ? D.dirs : (style.sectors | 0 || 8);
  const face = D ? null : style.face, faceW = D ? D.w : Math.max(...face.map(r => r.length)), faceH = D ? D.h : face.length;
  const tmp = { x: 0, y: 0, z: NaN }, tgt = { x: 0, y: 0, z: NaN, kind: 0 };   // kind: 0 none, 1 ready giver, 2 step, 3 available giver
  const npcA = [], npcR = [];
  let hasTarget = false, hidden = false;
  let sector = 0, sectorOk = false, metres = 0, label = '', labelKey = '', labelCols = [], northIdx = 0, dz = 0;
  let lastKind = 0, lastX = 0, lastY = 0, flashPending = false, flashEnd = -1;   // new-target flash
  let alpha = 0, lastT = -1;                                                       // fade
  let shownDir = -1, swingDir = -1, swingEnd = -1;                                 // swing follow-through

  const resolveGiver = (world, ids) => { for (let i = 0; i < ids.length; i++) if (world.resolve('giver', ids[i], tmp)) return true; return false; };

  /** Chooses the target; returns the shared {x,y,kind} (kind 1 ready '?', 2 step, 3 available '!') or null. Call on book change / ~2 Hz. */
  function target(book, world) {
    hasTarget = false;
    if (!book || !world) return null;
    tmp.z = NaN;
    book.giverMarks(npcA, npcR);
    let kind = 0;
    if (resolveGiver(world, npcR)) kind = 1;
    else {
      const ti = book.tracked();
      const qi = ti >= 0 ? ti : 0;                       // tracked giver quest, else the main quest
      const def = book.def(qi), st = book.questState(qi);
      if (book.status(qi) === ACTIVE) {
        const idx = st.completed.length;
        if (idx < def.objectives.length && stepPos(def.objectives[idx].when, st, world)) kind = 2;
      }
      if (!kind && resolveGiver(world, npcA)) kind = 3;
    }
    if (!kind) return null;
    tgt.x = tmp.x; tgt.y = tmp.y; tgt.z = tmp.z; tgt.kind = kind; hasTarget = true;
    if (kind !== lastKind || Math.abs(tgt.x - lastX) > 0.5 || Math.abs(tgt.y - lastY) > 0.5) { flashPending = true; sectorOk = false; }   // moving beast = small drift, no re-flash
    lastKind = kind; lastX = tgt.x; lastY = tgt.y;
    return tgt;
  }

  function stepPos(when, st, world) {
    if (when.type === 'beasts') {
      // first beast (list order) still alive and placed; the host resolver decides what "placed" means
      for (let i = 0; i < when.ids.length; i++) if (!st.deadBeasts.includes(when.ids[i]) && world.resolve('beast', when.ids[i], tmp)) return true;
      return false;
    }
    return world.resolve(when.type, when.id, tmp);
  }

  /** Player ground position + yaw (engine convention forwardOf(yaw) = (sin, -cos)) [+ eye/feet z] -> needle direction, N mark and rounded metres. */
  function step(px, py, yawDeg, pz) {
    if (!hasTarget) return;
    const dx = tgt.x - px, dy = tgt.y - py;
    metres = Math.round(Math.sqrt(dx * dx + dy * dy));
    const stepDeg = 360 / N, rel = wrap360(yawFromDelta(dx, dy) - yawDeg);
    if (D && sectorOk) {   // hysteresis: keep the shown dir until rel is > 0.5 + hyst steps from its centre
      let d = Math.abs(rel - sector * stepDeg); if (d > 180) d = 360 - d;
      if (d > (0.5 + D.hyst) * stepDeg) sector = Math.round(rel / stepDeg) % N;
    } else sector = Math.round(rel / stepDeg) % N;
    sectorOk = true;
    northIdx = Math.round(wrap360(-yawDeg) / 45) % 8;
    dz = D && pz === pz && tgt.z === tgt.z && pz !== undefined ? tgt.z - pz : 0;
    if (D) buildLabel();
  }

  // text under the face: "[! |? ]42 m[ ^|v]" / "1.2 km" / "here"; rebuilt only when the key changes (strings allocate then, not per frame)
  function buildLabel() {
    const hm = Math.abs(dz) >= D.heightFromM ? (dz > 0 ? 1 : 2) : 0;
    const key = (metres <= D.nearM ? 'h' : metres) + '|' + tgt.kind + '|' + hm;
    if (key === labelKey) return;
    labelKey = key;
    const cols = [];
    let s = '';
    if (metres <= D.nearM) { s = D.hereText; for (let i = 0; i < s.length; i++) cols.push(4); }
    else {
      if (tgt.kind === 1 || tgt.kind === 3) { s = (tgt.kind === 1 ? '?' : '!') + ' '; cols.push(0, 0); }
      const num = metres >= 1000 ? (metres / 1000).toFixed(1) : String(metres), unit = metres >= 1000 ? ' km' : ' m';
      for (let i = 0; i < num.length; i++) cols.push(1);
      for (let i = 0; i < unit.length; i++) cols.push(2);
      s += num + unit;
      if (hm) { s += ' ' + (hm === 1 ? '^' : 'v'); cols.push(3, 3); }
    }
    label = s; labelCols = cols;
  }

  function putRGB(ui, x, y, ch, fr, fg, fb, br, bg, bb) {
    if (x < 0 || y < 0 || x >= ui.cols) return;
    ui.setCellRGB(x, y, ch - 32, fr | 0, fg | 0, fb | 0, br | 0, bg | 0, bb | 0);
  }
  function put(ui, x, y, ch, fg, bg) { putRGB(ui, x, y, ch, fg[0], fg[1], fg[2], bg[0], bg[1], bg[2]); }

  function drawFallback(ui, cols, rows) {
    if (labelKey !== String(metres)) { label = metres + ' m'; labelKey = String(metres); }
    const m = style.margin, x0 = cols - m.right - faceW, y0 = rows - m.bottom - faceH - 1;
    for (let r = 0; r < faceH; r++) {
      const row = face[r];
      for (let c = 0; c < row.length; c++) { const ch = row.charCodeAt(c); if (ch !== 32) put(ui, x0 + c, y0 + r, ch, style.faceFg, style.faceBg); }
    }
    const p = style.needle.pos[sector];
    put(ui, x0 + p[0], y0 + p[1], style.needle.glyphs[sector].charCodeAt(0), style.needle.fg, style.faceBg);
    const tx = x0 + ((faceW - label.length) >> 1), ty = y0 + faceH + (style.text.gap | 0);
    for (let i = 0; i < label.length; i++) put(ui, tx + i, ty, label.charCodeAt(i), style.text.fg, style.faceBg);
  }

  // dimmed put: a = fade 0..1 (ramp-step dim, no alpha)
  function putA(ui, x, y, ch, fg, bg, a) {
    putRGB(ui, x, y, ch, fg[0] * a, fg[1] * a, fg[2] * a, bg[0] * a, bg[1] * a, bg[2] * a);
  }

  function drawDesigner(ui, cols, rows, t) {
    const x0 = cols - 1 - D.anchor.marginRight - (D.w - 1), yRow = rows - 1 - D.anchor.marginBottom, y0 = yRow - D.h, a = alpha;
    const near = metres <= D.nearM, flash = t < flashEnd;
    for (let i = 0; i < D.cells.length; i++) {
      const c = D.cells[i];
      putA(ui, x0 + c.x, y0 + c.y, c.ch, flash && c.rim ? D.flashRim : c.fg, c.bg, a);
    }
    if (D.nMarkCh && D.nPos) {
      const p = D.nPos[northIdx], bg = D.bgAt[(D.hub.y + p[1]) * D.w + D.hub.x + p[0]];
      if (bg) putA(ui, x0 + D.hub.x + p[0], y0 + D.hub.y + p[1], D.nMarkCh, D.nMarkFg, bg, a);
    }
    // swing: show dir + overshoot for 90 ms after a big jump, then settle
    const dir = t < swingEnd ? swingDir : sector, list = D.needle[((dir % N) + N) % N];
    const k = 0.5 - 0.5 * Math.cos(6.283185307 * t / (near ? D.nearPeriod : D.tipPeriod));
    const tr = D.tipA[0] + (D.tipB[0] - D.tipA[0]) * k, tg = D.tipA[1] + (D.tipB[1] - D.tipA[1]) * k, tb = D.tipA[2] + (D.tipB[2] - D.tipA[2]) * k;
    for (let role = 0; role < 3; role++) for (let i = 0; i < list.length; i++) {
      const n = list[i]; if (n.role !== role) continue;
      const bg = D.bgAt[n.y * D.w + n.x]; if (!bg) continue;
      if (role === 0) putA(ui, x0 + n.x, y0 + n.y, n.ch, D.tail, bg, a);
      else if (role === 1) putA(ui, x0 + n.x, y0 + n.y, n.ch, D.body, bg, a);
      else putRGB(ui, x0 + n.x, y0 + n.y, n.ch, tr * a, tg * a, tb * a, bg[0] * a, bg[1] * a, bg[2] * a);
    }
    putA(ui, x0 + D.hub.x, y0 + D.hub.y, near ? D.hubNearCh : D.hubCh, near ? D.hubN : D.hub0, D.bgAt[D.hub.y * D.w + D.hub.x], a);
    // distance line: text centred on the hub column, plate = text + 1 cell each side
    const len = label.length, tx = x0 + D.hub.x - (len >> 1);
    putA(ui, tx - 1, yRow, 32, D.plate, D.plate, a); putA(ui, tx + len, yRow, 32, D.plate, D.plate, a);
    for (let i = 0; i < len; i++) {
      const c = labelCols[i];
      putA(ui, tx + i, yRow, label.charCodeAt(i), c === 0 || c === 4 ? (c === 0 ? D.markFg : D.hereFg) : c === 1 ? D.numFg : c === 2 ? D.unitFg : D.heightFg, D.plate, a);
    }
  }

  /** Paints into the fixed UI layer. timeSec (optional) drives fade, pulse, flash and swing; omitted = no fade, no animation. */
  function draw(ui, cols, rows, timeSec) {
    if (!D) { if (!hidden && hasTarget) drawFallback(ui, cols, rows); return; }
    const t = timeSec === undefined ? 0 : timeSec, want = !hidden && hasTarget;
    if (timeSec === undefined) alpha = want ? 1 : 0;
    else {
      const dt = lastT < 0 ? 0 : Math.min(0.25, Math.max(0, t - lastT));
      if (want) alpha = Math.min(1, alpha + dt / D.fadeIn); else alpha = Math.max(0, alpha - dt / D.fadeOut);
      lastT = t;
    }
    if (!hasTarget || alpha <= 0) return;   // keeps drawing the last target while it fades out only if hasTarget; a lost target cuts
    if (flashPending) { flashPending = false; flashEnd = t + D.flashSec; }
    if (shownDir >= 0 && shownDir !== sector) {   // dir changed: big jump (>= swingMin steps) -> overshoot one step past the new value, same turning sense
      let d = sector - shownDir; if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
      if (Math.abs(d) >= D.swingMin) { swingDir = sector + (d > 0 ? D.swingOver : -D.swingOver); swingEnd = t + D.swingSec; }
    }
    shownDir = sector;
    drawDesigner(ui, cols, rows, t);
  }

  return {
    target, step, draw,
    setHidden(h) { hidden = !!h; },
    get hidden() { return hidden; },
    get visible() { return hasTarget && !hidden; },
    get sector() { return sector; },
    get metres() { return metres; },
    get label() { return D ? label : metres + ' m'; },
    get sectors() { return N; },
    get northIndex() { return northIdx; },
    get alpha() { return alpha; },
  };
}
