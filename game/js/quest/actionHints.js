// game/js/quest/actionHints.js (FS-01, GDD 7.4). Hints for the M4 controls, requested through hints.js (same FIFO,
// one at a time, once per save in hints.shown/hints.done). Rows live in uiStyle.hints (design/models/title.js, `fmt`
// holds the {action} key slots). Key labels come from the live bindings table, so a rebind changes the text.
// Host calls stepActionHints once per fixed step with a reused `sig` object; no allocation unless a hint is requested.
import { request, markDone, relabelHint } from './hints.js';

const NEED = ['inventory', 'questLog', 'useLeft', 'useRight', 'swapSet'];
let seeded = false, prevItems = 0, prevPotions = 0;
const asked = new Set(); // ids already requested this session: no per-step formatting while a hint waits in the FIFO

/** Rebuild runtime-only baselines (call with resetHints() on 'world:loaded'). */
export function resetActionHints() { seeded = false; prevItems = 0; prevPotions = 0; asked.clear(); }

/** 'KeyI' -> 'I', 'Mouse0' -> 'LMB', 'ShiftLeft' -> 'Shift'; no key -> '?'. */
export function keyLabel(code) {
  if (!code) return '?';
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code) || /^(Shift|Control|Alt)(?:Left|Right)$/.exec(code);
  return m ? m[1] : code;
}

/** Fills a row's `fmt` from the bindings table: text + keys (the [label] pieces, for the gold highlight). */
export function formatHint(def, bindings) {
  let text = def.fmt;
  for (let i = 0; i < NEED.length; i++) {
    const a = NEED[i], tag = '{' + a + '}';
    if (text.includes(tag)) text = text.split(tag).join(keyLabel(bindings.get('keyboard', a)[0]));
  }
  const keys = [], re = /\[[^\]]+\]/g;
  let m; while ((m = re.exec(text))) keys.push(m[0]);
  return { text, keys };
}

function countPack(inv, defs, kind) {
  let n = 0;
  const slots = inv && inv.slots;
  if (!slots) return 0;
  for (let i = 0; i < slots.length; i++) {
    const id = slots[i].id;
    if (id !== null && (kind === null || (defs[id] && defs[id].kind === kind))) n++;
  }
  return n;
}

function countGear(eq) {
  if (!eq) return 0;
  let n = 0;
  for (const k in eq) if (k !== 'set' && eq[k] !== null && eq[k] !== undefined) n++;
  return n;
}

function ask(world, uiStyle, bindings, id) {
  if (asked.has(id)) return;
  const shown = world.state['hints.shown'], done = world.state['hints.done'];
  if ((shown && shown.includes(id)) || (done && done.includes(id))) return; // cheap early-out, no formatting
  const def = uiStyle.hints.find((h) => h.id === id);
  if (!def) return;
  const f = formatHint(def, bindings);
  relabelHint(uiStyle, id, f.text, f.keys);
  request(world, uiStyle, id);
  asked.add(id);
}

/**
 * @param {*} world @param {Object} uiStyle @param {*} bindings createBindings() table
 * @param {*} player player entity data ({components}) @param {Object} defs item defs (kind)
 * @param {{invOpen:boolean, journalOpen:boolean, swing:boolean, block:boolean, shot:boolean, swap:boolean,
 *   slotKey:boolean, questAccepted:boolean}} sig done-actions (level/edge, this step) + quest pulse
 */
export function stepActionHints(world, uiStyle, bindings, player, defs, sig) {
  const comp = player && player.components, eq = comp && comp.equipment, inv = comp && comp.inventory;
  // done actions first (an action that came before its hint also closes it)
  if (sig.invOpen) markDone(world, 'actItems');
  if (sig.journalOpen) markDone(world, 'actJournal');
  if (sig.swing) markDone(world, 'actSwing');
  if (sig.block) markDone(world, 'actBlock');
  if (sig.shot) markDone(world, 'actDraw');
  if (sig.swap) markDone(world, 'actSwap');
  if (sig.slotKey) markDone(world, 'actQuickbar');

  const items = countPack(inv, defs, null) + countGear(eq), potions = countPack(inv, defs, 'potion');
  if (!seeded) { seeded = true; prevItems = items; prevPotions = potions; } // the starting kit is not a pickup
  if (items > prevItems) ask(world, uiStyle, bindings, 'actItems');
  if (potions > prevPotions) ask(world, uiStyle, bindings, 'actQuickbar');
  prevItems = items; prevPotions = potions;
  if (sig.questAccepted) ask(world, uiStyle, bindings, 'actJournal');
  if (world.state['tower.sword.taken']) ask(world, uiStyle, bindings, 'actSwing');
  if (eq) {
    if (eq.off !== null && eq.off !== undefined) ask(world, uiStyle, bindings, 'actBlock');
    if (eq.ranged !== null && eq.ranged !== undefined) ask(world, uiStyle, bindings, 'actDraw');
    if (eq.main !== null && eq.main !== undefined && eq.ranged !== null && eq.ranged !== undefined) ask(world, uiStyle, bindings, 'actSwap');
  }
}
