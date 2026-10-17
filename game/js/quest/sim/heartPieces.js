// QL-08: heart pieces. Pure sim (rule 15: no random/trig/clock). The item `heart.piece` never stays in the pack:
// `collect()` takes every piece out of the pack, counts it in world.state['hearts.pieces'] (saved with the world) and
// every 4th piece makes +1 heart (HEART_HP max HP, filled). Max HP itself lives in components.health (saved too).
import { countOf, removeItem } from './inventory.js';

export const PIECE_ID = 'heart.piece', PIECES_PER_HEART = 4, HEART_HP = 10;
export const KEY_PIECES = 'hearts.pieces', KEY_BONUS = 'hearts.bonus';

/** 0..3 quarter marks for the HUD. */
export const quarters = (state) => ((state && state[KEY_PIECES]) | 0) % PIECES_PER_HEART;

/**
 * @param {{slots:any[]}} inv pack  @param {{hp:number,max:number}} health  @param {Record<string,any>} state world.state
 * @returns {null | {n:number, total:number, count:number, hearts:number}} null = nothing to collect.
 *   count = the "n of 4" shown on the item-get card (4 on the piece that completes a heart); hearts = hearts gained now.
 */
export function collect(inv, health, state) {
  const n = inv ? countOf(inv, PIECE_ID) : 0;
  if (n < 1 || !health || !state) return null;
  removeItem(inv, PIECE_ID, n);
  const total = ((state[KEY_PIECES] | 0)) + n;
  state[KEY_PIECES] = total;
  const hearts = Math.floor(total / PIECES_PER_HEART) - (state[KEY_BONUS] | 0);
  if (hearts > 0) {
    state[KEY_BONUS] = (state[KEY_BONUS] | 0) + hearts;
    health.max += hearts * HEART_HP;
    health.hp = health.max; // the new heart comes filled (and heals fully, like the Zelda vessel)
  }
  const rem = total % PIECES_PER_HEART;
  return { n, total, count: hearts > 0 && rem === 0 ? PIECES_PER_HEART : rem, hearts };
}

/** After a load: max HP never below base + bonus hearts (older/odd saves). */
export function reconcile(health, state, baseMax) {
  if (!health || !state) return;
  const want = baseMax + (state[KEY_BONUS] | 0) * HEART_HP;
  if (health.max < want) health.max = want;
}
