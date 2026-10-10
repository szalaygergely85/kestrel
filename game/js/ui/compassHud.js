// COMPASS-01 (D-061): golden pocket compass HUD, bottom-right. Pure module: no DOM/clock/world mutation, zero allocation per frame.
// target(book, world) picks what to point at, step(x, y, yawDeg) turns it into a needle sector + metres, draw(ui, cols, rows) paints it.
// World resolver (host-supplied): world.resolve(kind, id, out) -> bool, fills out.x/out.y (ground plane). kind =
//   'giver' (npc id) | 'area' | 'item' | 'beast' | 'flag' (flag objective: host maps the flag id to the entity that sets it, e.g. the giver).
// Style = ASSETS.uiStyle.compass (designer) or FALLBACK_COMPASS_STYLE:
//   { sectors: 8|16, face: string[] (rows; ' ' = transparent), faceFg, faceBg, needle: { glyphs: string[sectors], pos: [dx,dy][sectors], fg },
//     text: { fg, gap }, margin: { right, bottom } }   needle sector 0 = straight ahead (up), clockwise.
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

export function createCompassHud({ style = FALLBACK_COMPASS_STYLE } = {}) {
  const N = style.sectors | 0 || 8;
  const face = style.face, faceW = Math.max(...face.map(r => r.length)), faceH = face.length;
  const tmp = { x: 0, y: 0 }, tgt = { x: 0, y: 0, kind: 0 };   // kind: 0 none, 1 ready giver, 2 step, 3 available giver
  const npcA = [], npcR = [];
  let hasTarget = false, hidden = false;
  let sector = 0, metres = 0, label = '', labelFor = -1;

  const resolveGiver = (world, ids) => { for (let i = 0; i < ids.length; i++) if (world.resolve('giver', ids[i], tmp)) return true; return false; };

  /** Chooses the target; returns the shared {x,y,kind} (kind 1 ready '?', 2 step, 3 available '!') or null. Call on book change / ~2 Hz. */
  function target(book, world) {
    hasTarget = false;
    if (!book || !world) return null;
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
    tgt.x = tmp.x; tgt.y = tmp.y; tgt.kind = kind; hasTarget = true;
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

  /** Player ground position + yaw (engine convention forwardOf(yaw) = (sin, -cos)) -> needle sector and rounded metres. */
  function step(px, py, yawDeg) {
    if (!hasTarget) return;
    const dx = tgt.x - px, dy = tgt.y - py;
    metres = Math.round(Math.sqrt(dx * dx + dy * dy));
    const rel = wrap360(yawFromDelta(dx, dy) - yawDeg);
    sector = Math.round(rel / (360 / N)) % N;
  }

  function put(ui, x, y, ch, fg, bg) {
    if (x < 0 || y < 0 || x >= ui.cols) return;
    ui.setCellRGB(x, y, ch - 32, fg[0] | 0, fg[1] | 0, fg[2] | 0, bg[0], bg[1], bg[2]);
  }

  function draw(ui, cols, rows) {
    if (hidden || !hasTarget) return;
    if (labelFor !== metres) { label = metres + ' m'; labelFor = metres; }
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

  return {
    target, step, draw,
    setHidden(h) { hidden = !!h; },
    get hidden() { return hidden; },
    get visible() { return hasTarget && !hidden; },
    get sector() { return sector; },
    get metres() { return metres; },
    get label() { return metres + ' m'; },
    get sectors() { return N; },
  };
}
