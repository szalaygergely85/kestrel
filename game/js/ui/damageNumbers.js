// DMGNUM-01 (D-086 / D-084 Q5): floating damage numbers. Fixed pool of 24 (no growth, oldest recycled), SoA arrays, 0 allocation per step/draw
// after the string table is built. Player-dealt hits (`combat:hit`, source 'player') rise 1.2 m over 0.8 s and fade at the hit point;
// normal = white, crit = gold with a "!" suffix and wide glyph spacing (stand-in for 1.3x size on the cell grid).
// Damage taken by the player (`combat:hit`, target 'player', not blocked) is NOT floated over the world: it is one red number near the hero's HP bar.
// Crit: `payload.crit` (ITEM-01 sets it; until then the field is simply absent = no crit). Value = max(1, round(damage)) - the payload damage is after weapon mods.
// Host contract: project(x, y, z, out) -> bool, fills out.c / out.r (UI cells).
import { damageNumbersOn } from './combatHudFlags.js';

export const POOL = 24;
export const RISE_M = 1.2;
export const LIFE_SEC = 0.8;
export const STAGGER_SEC = 0.1;
export const STAGGER_X_M = 0.3;
const STAGGER_WINDOW = 0.02; // spawns closer than this (sim time) count as one multi-hit volley
const NORMAL_KEY = 'white', CRIT_KEY = 'gold', HURT_KEY = 'danger';

export function createDamageNumbers({ rgb, project, enabled = damageNumbersOn, hurtAnchor = { col: 6, row: 2 } } = {}) {
  const act = new Uint8Array(POOL), crit = new Uint8Array(POOL);
  const x = new Float64Array(POOL), y = new Float64Array(POOL), z = new Float64Array(POOL), ox = new Float64Array(POOL), oy = new Float64Array(POOL);
  const age = new Float64Array(POOL), delay = new Float64Array(POOL), born = new Float64Array(POOL);
  const val = new Int32Array(POOL);
  const texts = [], critTexts = [];
  const textOf = (v) => texts[v] || (texts[v] = String(v));
  const critOf = (v) => {
    if (critTexts[v]) return critTexts[v];
    const s = String(v) + '!'; let w = '';
    for (let i = 0; i < s.length; i++) w += (i ? ' ' : '') + s[i];
    return (critTexts[v] = w);
  };
  const c = (k) => rgb[k] || rgb.white || rgb.uiText || [255, 255, 255];
  const pt = { c: 0, r: 0 };
  let seq = 0, lastSpawnT = -1e9, volley = 0, simT = 0;
  const hurt = { v: 0, age: 1e9 };
  let spawned = 0;

  function slot() {
    let oldest = 0;
    for (let i = 0; i < POOL; i++) {
      if (!act[i]) return i;
      if (born[i] < born[oldest]) oldest = i;
    }
    return oldest; // pool full -> recycle the oldest
  }

  /** Feed every `combat:hit` payload here. */
  function onHit(p) {
    if (!p || !enabled()) return;
    if (p.source === 'player') {
      if (!(p.damage > 0)) return;
      const i = slot();
      volley = simT - lastSpawnT <= STAGGER_WINDOW ? volley + 1 : 0; lastSpawnT = simT;
      const dx = p.dirX || 0, dy = p.dirY || 0;
      act[i] = 1; crit[i] = p.crit ? 1 : 0; val[i] = Math.max(1, Math.round(p.damage));
      x[i] = p.px; y[i] = p.py; z[i] = p.pz; age[i] = 0; delay[i] = volley * STAGGER_SEC; born[i] = ++seq;
      const side = (volley & 1 ? 1 : -1) * STAGGER_X_M * (volley ? 1 : 0), len = Math.hypot(dx, dy);
      if (len > 1e-6) { ox[i] = (-dy / len) * side; oy[i] = (dx / len) * side; } else { ox[i] = side; oy[i] = 0; }
      spawned++;
    } else if (p.target === 'player' && !p.blocked && p.damage > 0) {
      hurt.v = Math.max(1, Math.round(p.damage)); hurt.age = 0;
    }
  }

  function step(dt) {
    simT += dt; hurt.age += dt;
    for (let i = 0; i < POOL; i++) {
      if (!act[i]) continue;
      if (delay[i] > 0) { delay[i] -= dt; continue; }
      age[i] += dt;
      if (age[i] >= LIFE_SEC) act[i] = 0;
    }
  }

  function put(ui, cx, cy, ch, col, a) {
    if (cx < 0 || cy < 0 || cx >= ui.cols || cy >= ui.rows) return;
    ui.setCellRGB(cx, cy, ch - 32, (col[0] * a) | 0, (col[1] * a) | 0, (col[2] * a) | 0, 0, 0, 0);
  }

  /** Cells with bg 0,0,0 would paint black boxes; callers that want the scene to show through use ui.setCell when it exists (host decides). */
  function draw(ui, hidden) {
    if (hidden || !enabled()) return;
    for (let i = 0; i < POOL; i++) {
      if (!act[i] || delay[i] > 0) continue;
      const t = age[i] / LIFE_SEC;
      if (!project(x[i] + ox[i], y[i] + oy[i], z[i] + RISE_M * t, pt)) continue;
      const s = crit[i] ? critOf(val[i]) : textOf(val[i]);
      const col = crit[i] ? c(CRIT_KEY) : c(NORMAL_KEY), a = 1 - t * t;
      const x0 = (pt.c | 0) - (s.length >> 1);
      for (let j = 0; j < s.length; j++) { const ch = s.charCodeAt(j); if (ch !== 32) put(ui, x0 + j, pt.r | 0, ch, col, a); }
    }
    if (hurt.age < LIFE_SEC) { // red number beside the hero's hearts, drifts up 2 rows
      const t = hurt.age / LIFE_SEC, s = '-' + textOf(hurt.v), row = hurtAnchor.row - ((2 * t) | 0);
      for (let j = 0; j < s.length; j++) put(ui, hurtAnchor.col + j, row, s.charCodeAt(j), c(HURT_KEY), 1 - t * t);
    }
  }

  function reset() { act.fill(0); hurt.age = 1e9; }
  return { onHit, step, draw, reset, act, val, crit, get spawned() { return spawned; }, get hurt() { return hurt; }, get active() { let n = 0; for (let i = 0; i < POOL; i++) n += act[i]; return n; } };
}
