// game/js/quest/fireballHints.js (FB-03). Two one-time-per-save hints for the fireball (hints.js FIFO, ids fbCast / fbCost / fbNoMp in
// uiStyle.hints, texts = story.md hint.fireball.*): after the unlock "[Hold <key>] charge fire. Let go: throw." then "Each throw costs MP.";
// on the first MP-short cast "The fire fizzles. No MP left.". <key> is the real binding of the hand holding the spell (useLeft / useRight).
// Host calls stepFireballHints once per fixed step with a reused `s`; no allocation after the hints were asked / shown.
import { request, relabelHint } from './hints.js';
import { keyLabel } from './actionHints.js';

let prevFlash = -1; // last seen vitals.manaFlashTick (-1 = not seeded yet)
export function resetFireballHints() { prevFlash = -1; }

const seen = (world, id) => { const sh = world.state['hints.shown'], dn = world.state['hints.done']; return (sh && sh.includes(id)) || (dn && dn.includes(id)); };

/** '[Hold {fire}] ...' with the live label; no key -> '?'. */
export function fireText(fmt, bindings, hand) {
  const code = bindings.get('keyboard', hand === 'right' ? 'useRight' : 'useLeft')[0];
  const text = fmt.split('{fire}').join(keyLabel(code));
  const keys = [], re = /\[[^\]]+\]/g;
  let m; while ((m = re.exec(text))) keys.push(m[0]);
  return { text, keys };
}

/**
 * @param {*} world @param {Object} uiStyle @param {*} bindings createBindings() table
 * @param {{fbOn:boolean, hand:('left'|'right'|null), casting:boolean, manaFlashTick:number}} s
 *   fbOn = fireball unlocked, hand = hands.handOf('spell.fireball'), casting = hands.downOf('spell.fireball'), manaFlashTick = vitals.manaFlashTick
 */
export function stepFireballHints(world, uiStyle, bindings, s) {
  if (prevFlash < 0) prevFlash = s.manaFlashTick;
  if (!s.fbOn) { prevFlash = s.manaFlashTick; return; }
  if (!seen(world, 'fbCast')) {
    const def = uiStyle.hints.find((h) => h.id === 'fbCast');
    if (def) { const f = fireText(def.fmt, bindings, s.hand); relabelHint(uiStyle, 'fbCast', f.text, f.keys); request(world, uiStyle, 'fbCast'); request(world, uiStyle, 'fbCost'); }
  }
  if (s.manaFlashTick > prevFlash && s.casting && !seen(world, 'fbNoMp')) request(world, uiStyle, 'fbNoMp');
  prevFlash = s.manaFlashTick;
}
