// game/js/quest/questWindow.js (QFIX-S4, D-098 rule 4). WoW-style quest windows built as ordinary dialogues, so the existing
// dialogue box (typing, choices, keys, lock) is the UI. OFFER = title + text + objectives + rewards, [Accept] [Decline];
// HAND-IN = text + rewards, [Complete]. Accept / Complete are `q.<id>.accept|handin` flags (questBook.actKey). Pure data here.
import { giverOf } from './sim/giverResolve.js';
const MAXL = 54;
const ascii = (t) => String(t == null ? '' : t).replace(/[^\x20-\x7e]/g, '?');
function wrap(text, out) {
  let cur = '';
  for (const w of ascii(text).split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > MAXL) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
}
/** Plain reward names: 'Arrow x20, Iron Sword'. A loot table shows as 'a piece of gear'. */
export function rewardText(def, nameOf) {
  const r = def.reward; if (!r) return '';
  const p = (r.items || []).map(it => nameOf(it.id) + (it.n > 1 ? ' x' + it.n : ''));
  if (r.table) p.push('a piece of gear');
  return p.join(', ');
}
function lines(def, parts) {
  const out = [];
  for (const t of parts) if (t) wrap(t, out);
  return out.slice(0, 12);
}
/** Raw dialogue JSON (engine compileDialogue input) for the window of `plan.action` ('offer' | 'handin') of quest `def`. */
export function questWindowDialogue(def, action, nameOf) {
  const rw = rewardText(def, nameOf), L = def.lines || {};
  const txt = action === 'offer' ? (L.offer || (def.giver && def.giver.text ? [def.giver.text] : [])) : (L.ready || (def.giver && def.giver.turnInText ? [def.giver.turnInText] : []));
  const body = [String(def.title || def.id)].concat(txt);
  if (action === 'offer') { const ob = (def.objectives || []).map(o => o.text).filter(Boolean); if (ob.length) body.push('Objective: ' + ob.join('; ')); }
  if (rw) body.push('Reward: ' + rw);
  const key = 'q.' + def.id + '.' + (action === 'offer' ? 'accept' : 'handin');
  const choices = action === 'offer'
    ? [{ next: 'w.yes', setFlag: key, text: '[E] Accept' }, { next: 'w.no', text: '[Q] Decline' }]
    : [{ next: 'w.yes', setFlag: key, text: '[E] Complete' }, { next: 'w.no', text: '[Q] Not yet' }]; // the runner needs 2..3 choices
  return {
    kind: 'dialogue', schema: 1, id: 'qwin.' + def.id + '.' + action,
    speakers: { npc: { label: ascii(def.title || 'Quest').slice(0, 24).toUpperCase() } },
    entry: [{ node: 'w.0' }],
    nodes: {
      'w.0': { lines: lines(def, body), choices, speaker: 'npc' },
      'w.yes': { end: true, lines: [action === 'offer' ? 'Quest accepted.' : 'Quest complete.'], speaker: 'npc' },
      'w.no': { end: true, lines: ['Maybe later.'], speaker: 'npc' },
    },
  };
}
/**
 * E on quest entity `objectId`: opens the offer or hand-in window (hand-in first), and when a hand-in closes and the same entity has the
 * next quest of a chain, its offer window opens right away. Returns the plan ({action,id}) or null. `ctl.openComp(comp, anchorId, onEnd)`.
 */
export function openQuestWindow({ book, ctl, compile, nameOf, objectId, anchorId, chain = true, after }) {
  const pl = book.plan(objectId);
  if (!pl || pl.action === 'refuse') return pl;
  const def = book.def(book.index(pl.id));
  const comp = compile(questWindowDialogue(def, pl.action, nameOf));
  const ok = ctl.openComp(comp, anchorId || objectId, () => {
    if (after) return after(pl);
    if (chain && pl.action === 'handin' && book.statusOf(pl.id) === 4) { const nx = book.plan(objectId); if (nx && nx.action === 'offer') openQuestWindow({ book, ctl, compile, nameOf, objectId, anchorId }); }
  });
  return ok ? pl : null;
}
/**
 * QFIX-S4b / D-098 rule 4 for NPC talk (ctl.questGate). READY hand-in of this NPC -> hand-in window first; on Complete the NPC's story talk
 * follows (its entry list starts with `<npc>.after.<questId>`, a dlg flag set only for that one open), then the next offer. An OFFER ->
 * the story talk first (no accept inside it), then the offer window (Accept / Decline). Returns true when it took over, false = plain talk.
 */
export function npcQuestTalk({ book, ctl, compile, nameOf, npcId, state }) {
  const pl = book.plan(npcId);
  if (!pl || pl.action === 'refuse') return false;
  const win = { book, ctl, compile, nameOf, objectId: npcId, anchorId: npcId, chain: false };
  const offerNext = () => { const p = book.plan(npcId); if (p && p.action === 'offer') openQuestWindow(win); };
  if (pl.action === 'offer') return ctl.openFor(npcId, true, offerNext) || !!openQuestWindow(win);
  const key = 'dlg.' + npcId + '.after.' + pl.id;
  return !!openQuestWindow(Object.assign({ after: (p) => {
    if (book.statusOf(p.id) !== 4) return; // "Not yet": nothing follows
    state[key] = true; const ok = ctl.openFor(npcId, true, offerNext); delete state[key];
    if (!ok) offerNext();
  } }, win));
}
/**
 * D-098 / OB-155 "This item begins a quest": on `quest:accepted` of a `takeGiverOnAccept` quest the giver item (already in the pack through
 * giveOnAccept) leaves the world for good (world.remove is content-aware: stays gone across save/load) and its [E] prompt goes with it.
 * Boards / notes never set the flag. Returns true when it took the entity.
 */
export function takeGiverOnAccept(book, world, id) {
  const def = book.def(book.index(id)); if (!def || !def.takeGiverOnAccept || !giverOf(def)) return false;
  const ent = book.entityFor(giverOf(def));
  if (!world.get || !world.get(ent)) return false;
  world.remove(ent); if (world.removeInteractable) world.removeInteractable('qi.' + ent);
  return true;
}
