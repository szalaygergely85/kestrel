// game/js/quest/swimVitals.js (SWIM-05, D-070, architecture.md 38.54 item 9). Wires the pure stamina model
// (stamina.js) to the player's swim/dive state and to vitals (hurt/kill, deathCause 'drown'), plus the stamina ring HUD.
// Hearts live in vitals only: the stamina state's standalone heart counter is set huge so vitals alone decides death.
// 0 alloc per step/draw (state, hooks and config are built once).
import { STAMINA_CONFIG, createStaminaState, stepStamina } from './stamina.js';

export const SWIM_VITALS_CONFIG = {
  hpPerHeart: 10,      // vitals hp units per heart (startHp 30 = 3 hearts); drown damage = drownDamage * hpPerHeart
  fadeSec: 1.0,        // HUD ring fade-out time once full and on land
};

const RING = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2], [0, 1]]; // 12 cells clockwise
const CFG = { ...STAMINA_CONFIG, hearts: 1e9 };

export function createSwimVitals(vitals, cfg = SWIM_VITALS_CONFIG) {
  const st = createStaminaState(CFG);
  const input = { swimming: false, diving: false };
  const hooks = {
    onDamage: (n, cause) => vitals.hurt(n * cfg.hpPerHeart, cause) === true,
    onDeath: null,
  };
  const sv = { state: st, shown: 0 };

  /** Call once per fixed step with the player's body (body.swimming / body.diving). Returns true while drowning. */
  sv.step = function step(body, dt) {
    if (vitals.dead) return false;
    if (st.dead) { // respawned: back to full
      st.stamina = CFG.max; st.dead = false; st.cause = null; st.drowning = false; st.drownTimer = 0;
    }
    input.swimming = !!(body && body.swimming);
    input.diving = !!(body && body.diving);
    stepStamina(st, dt, input, CFG, hooks);
    return st.drowning;
  };

  /** Reset on respawn / world load. */
  sv.reset = function reset() {
    st.stamina = CFG.max; st.dead = false; st.cause = null; st.drowning = false; st.drownTimer = 0; sv.shown = 0;
  };

  /** True while the ring should be visible: in water or not full. */
  sv.visible = function visible(body) {
    return st.stamina < CFG.max || !!(body && (body.swimming || body.diving));
  };

  /** 12-cell ring below the MP bar. `style` = uiStyle.vitals (layout.x / mpRow / textBg). Lit cells clockwise = stamina share. */
  sv.draw = function draw(ui, style, body, simTime) {
    if (!ui || !style || !sv.visible(body)) return;
    const L = style.layout, x0 = L.x, y0 = (L.mpRow != null ? L.mpRow : L.hpRow) + 2;
    const lit = Math.ceil((st.stamina / CFG.max) * RING.length - 1e-6);
    const pulse = st.drowning ? (0.5 + 0.5 * Math.cos(simTime * 12)) : 0;
    const bg = style.textBg || [0, 0, 0];
    for (let i = 0; i < RING.length; i++) {
      const on = i < lit;
      const r = on ? (st.drowning ? 230 : 70) : 40, g = on ? (st.drowning ? 60 + 60 * pulse : 190) : 50, b = on ? (st.drowning ? 60 : 235) : 60;
      ui.setCellRGB(x0 + RING[i][0], y0 + RING[i][1], (on ? 'o' : '.').charCodeAt(0) - 32, r | 0, g | 0, b | 0, bg[0] | 0, bg[1] | 0, bg[2] | 0);
    }
  };
  return sv;
}

// NEEDS B1-main: (1) after createVitals(...): `swimVitals = createSwimVitals(vitals)`; (2) once per fixed step after the physics/vitals step:
//   `swimVitals.step(player.components.body, 1/60)`; (3) where drawVitals(...) is called: `swimVitals.draw(ui, uiStyle.vitals, body, simTime)`;
//   (4) on world load/restart: `swimVitals.reset()` (respawn is handled automatically); (5) death card text may read `vitals.deathCause === 'drown'`.
