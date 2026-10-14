// QG-01 (38.35): giver quests on top of quest.js (unchanged). Pure sim: no world/DOM/clock/random.
// Status is derived from facts + two booleans; facts count before accept (boars stay dead).
import { createQuest, applyQuestEvent, questObjectives, stringifyQuest, questHash, validateQuestDefinition, applyKindKill, kindOf } from './quest.js';

export const UNAVAILABLE = 0, AVAILABLE = 1, ACTIVE = 2, READY = 3, DONE = 4;
export const STATUS_NAMES = Object.freeze(['unavailable', 'available', 'active', 'ready', 'done']);
const QUEST_ID = /^[a-z][a-zA-Z0-9_.]*$/;
const HAS_OPS = { available: AVAILABLE, active: ACTIVE, ready: READY, done: DONE };
const ACT_OPS = ['accept', 'handin'];
const NO_REWARD = Object.freeze({ items: Object.freeze([]) });
// Old saves (pre-book): the boar fight lived in m1 step `beasts`, entered after step `sword`.
const LEGACY = { 'burl.boars': { afterStep: 'sword', doneStep: 'beasts' } };
const BLADE = 'tower.blade'; // chain quest given by the wake-spot note, turned in at Burl; saves from before it get it derived from m1 facts

/** tower.blade entry for an old save: facts (items/areas) copied from m1; accepted once the sword was taken; handed in once the boar quest was begun. */
function bladeFromMain(def, main, boars) {
  if (!def || !Array.isArray(main?.items) || !main.items.includes('sword')) return null;
  const q = createQuest(def, { questVersion: 1, questId: def.id, flags: {}, items: [...main.items], deadBeasts: [], areas: [...new Set([...(main.areas || []), ...(Array.isArray(main.completed) && main.completed.some(c => c === 'leave' || c === 'beasts') ? ['towerDoor'] : [])])], completed: [] }); // PO-CH1-09: a save past m1 'leave' has left the tower even if its area list lacks the door
  return { quest: JSON.parse(stringifyQuest(q, def)), accepted: true, handedIn: !!(boars && (boars.accepted || boars.handedIn)) };
}

export function validateGiverQuest(def) {
  validateQuestDefinition(def);
  if (!QUEST_ID.test(def.id)) throw new Error('quest: invalid giver quest id');
  if (def.giver === undefined) { // QL-T1: giverless area quest (objects/areas as objectives): starts when `requires` is met, ends with its last objective
    if (def.objectives.some(o => o.when.type === 'deliver') || def.giveOnAccept !== undefined || def.reward !== undefined) throw new Error('quest: giverless quest cannot deliver, give or reward');
  } else if (typeof def.giver.npc !== 'string' || !def.giver.npc) throw new Error('quest: giver.npc required');
  if (def.giver && def.giver.turnIn !== undefined && (typeof def.giver.turnIn !== 'string' || !def.giver.turnIn)) throw new Error('quest: invalid giver.turnIn');
  if (def.requires !== undefined) {
    if (!Array.isArray(def.requires)) throw new Error('quest: requires must be an array');
    for (const r of def.requires) if (!r || (typeof r.flag === 'string' ? !r.flag : typeof r.quest !== 'string' || (r.done !== true && typeof r.step !== 'string'))) throw new Error('quest: invalid requires entry'); // QL-05: {flag} = main quest flag set (Burl home)
  }
  for (const o of def.objectives) if (def.giver && o.when.type === 'deliver' && o.when.to !== (def.giver.turnIn || def.giver.npc)) throw new Error('quest: deliver.to must be the hand-in npc (giver.turnIn or giver.npc)');
  if (def.abandonable !== undefined && typeof def.abandonable !== 'boolean') throw new Error('quest: invalid abandonable');
  if (def.returnText !== undefined && typeof def.returnText !== 'string') throw new Error('quest: invalid returnText');
  if (def.giver) for (const k of ['entity', 'turnInEntity', 'text', 'turnInText', 'refuseText']) if (def.giver[k] !== undefined && (typeof def.giver[k] !== 'string' || !def.giver[k])) throw new Error('quest: invalid giver.' + k); // QL-04: object givers (inspect props)
  if (def.giveOnAccept !== undefined) {
    if (!Array.isArray(def.giveOnAccept)) throw new Error('quest: invalid giveOnAccept');
    for (const it of def.giveOnAccept) if (!it || typeof it.id !== 'string' || !Number.isInteger(it.n) || it.n < 1) throw new Error('quest: invalid giveOnAccept item');
  }
  if (def.giveOnTalk !== undefined) { // EQ-13: same shape as giveOnAccept (given when the quest is accepted by talking to the giver)
    if (!Array.isArray(def.giveOnTalk)) throw new Error('quest: invalid giveOnTalk');
    for (const it of def.giveOnTalk) if (!it || typeof it.id !== 'string' || !Number.isInteger(it.n) || it.n < 1) throw new Error('quest: invalid giveOnTalk item');
  }
  if (def.requireItem !== undefined && (typeof def.requireItem !== 'string' || !def.requireItem)) throw new Error('quest: invalid requireItem');
  if (def.requireEquipped !== undefined && (!Array.isArray(def.requireEquipped) || !def.requireEquipped.length || !def.requireEquipped.every(x => typeof x === 'string' && x))) throw new Error('quest: invalid requireEquipped');
  if (def.reward !== undefined) {
    if (!def.reward || !Array.isArray(def.reward.items)) throw new Error('quest: invalid reward');
    for (const it of def.reward.items) if (!it || typeof it.id !== 'string' || !Number.isInteger(it.n) || it.n < 1) throw new Error('quest: invalid reward item');
    if (def.reward.unlock !== undefined && (!Array.isArray(def.reward.unlock) || def.reward.unlock.some(u => typeof u !== 'string'))) throw new Error('quest: invalid reward unlock'); // FB-02
  }
  return def;
}

function deepFreeze(o) { if (o && typeof o === 'object') { for (const k of Object.keys(o)) deepFreeze(o[k]); Object.freeze(o); } return o; }

/** saved = {quest: m1 state|null, quests: {id:{quest,accepted,handedIn}}|null}; toSave() returns the same shape. */
/** OB-155: static part of the main/side rule: `main: true`, `kind: 'main'` or an `mq.*` id (the chain-waits-on flag is checked by book.isMain). */
export const isMainDef = (d) => !!d && (d.main === true || d.kind === 'main' || (typeof d.id === 'string' && d.id.startsWith('mq.')));
export function createQuestBook(mainDef, giverDefs = [], saved = null) {
  validateQuestDefinition(mainDef);
  const entries = [{ def: mainDef, giver: null, state: createQuest(mainDef, saved?.quest || null), accepted: true, handedIn: false, seq: 0, prev: ACTIVE }];
  const ids = new Set([mainDef.id]);
  let seqCounter = 0;
  for (let i = 0; i < giverDefs.length; i++) {
    const def = validateGiverQuest(giverDefs[i]);
    if (ids.has(def.id)) throw new Error('quest: duplicate quest id ' + def.id);
    ids.add(def.id);
    const s = saved?.quests?.[def.id];
    const auto = !def.giver; // QL-T1: giverless
    const e = { def, auto, giver: auto ? null : def.giver.npc, turnIn: auto ? null : def.giver.turnIn || def.giver.npc, state: createQuest(def, s ? s.quest : null), accepted: !!(s && s.accepted === true), handedIn: !!(s && s.handedIn === true), seq: 0, prev: 0, given: Array.isArray(s && s.given) ? s.given.filter(g => g && typeof g.id === 'string' && Number.isInteger(g.n) && g.n > 0) : [] };
    // OB-087: the saved accept order wins (the unpinned HUD track = most recently accepted must survive Continue); old saves: array order
    if (e.accepted) e.seq = (s && Number.isInteger(s.seq) && s.seq > 0) ? s.seq : ++seqCounter;
    if (e.seq > seqCounter) seqCounter = e.seq;
    entries.push(e);
  }
  const byId = new Map(); entries.forEach((e, i) => byId.set(e.def.id, i));
  const n = entries.length;
  const requireSteps = entries.map(e => (e.def.requires || []).map(r => {
    if (typeof r.flag === 'string') return { qi: 0, si: -2, flag: r.flag };
    const qi = byId.get(r.quest); if (qi === undefined) throw new Error('quest: requires unknown quest ' + r.quest);
    if (r.done === true) return { qi, si: -1 }; // giver quest handed in (turned in at its giver)
    const si = entries[qi].def.objectives.findIndex(o => o.id === r.step);
    if (si < 0) throw new Error('quest: requires unknown step ' + r.step);
    return { qi, si };
  }));
  const keys = new Map();
  for (let i = 1; i < n; i++) {
    const id = entries[i].def.id;
    for (const op of Object.keys(HAS_OPS)) keys.set('q.' + id + '.' + op, { qi: i, op: HAS_OPS[op], act: false });
    for (const op of ACT_OPS) keys.set('q.' + id + '.' + op, { qi: i, op, act: true });
  }

  // QL-T3 (38.44 item 9): fact -> listening quests (type -> id -> Int16Array) and quest -> dependents (opensAfter edges).
  const listen = new Map(), deps = [], kindListen = new Map(); // kindListen: kind -> quest indices (OB-115)
  for (let i = 0; i < n; i++) deps.push([]);
  {
    const tmp = new Map();
    const add = (type, id, qi) => { let m = tmp.get(type); if (!m) tmp.set(type, m = new Map()); let l = m.get(id); if (!l) m.set(id, l = []); if (!l.includes(qi)) l.push(qi); };
    for (let i = 1; i < n; i++) for (const o of entries[i].def.objectives) {
      const w = o.when;
      if (w.type === 'flag') add('flag:set', w.id, i);
      else if (w.type === 'item') add('item:got', w.id, i);
      else if (w.type === 'area') add('area:entered', w.id, i);
      else if (w.type === 'beasts' && w.kind !== undefined) { let l = kindListen.get(w.kind); if (!l) kindListen.set(w.kind, l = []); if (!l.includes(i)) l.push(i); } // OB-115
      else if (w.type === 'beasts') for (const b of w.ids) add('beast:died', b, i);
      else add('item:count', w.id, i); // collect / deliver
    }
    for (const [type, m] of tmp) { const out = new Map(); for (const [id, l] of m) out.set(id, Int16Array.from(l)); listen.set(type, out); }
    requireSteps.forEach((r, j) => { for (const x of r) { const d = x.si === -2 ? deps[0] : deps[x.qi]; if (!d.includes(j)) d.push(j); } });
  }
  const mark = new Uint8Array(n), touched = new Int16Array(n);
  let touchedN = 0;
  const touch = i => { if (!mark[i]) { mark[i] = 1; touched[touchedN++] = i; } };
  const touchWithDeps = i => { touch(i); const d = deps[i]; for (let k = 0; k < d.length; k++) touch(d[k]); };

  const book = { main: entries[0].state, version: 0, onChange: null, lastReward: null, count: n, packOps: null /* QUESTS-01: {count(id), remove(id, n), add?(id, n) -> n added} set by the game; deliver needs it */ };
  const packCounts = new Map(); // last absolute pack count per item id (runtime mirror of item:count, re-applied on abandon)

  function met(i) {
    const r = requireSteps[i];
    for (let k = 0; k < r.length; k++) {
      const q = entries[r[k].qi];
      if (r[k].si === -2) { if (q.state.flags[r[k].flag] !== true) return false; continue; }
      if (r[k].si < 0 ? !q.handedIn : q.state.completed.length <= r[k].si) return false;
    }
    return true;
  }
  function statusOf(i) {
    const e = entries[i];
    if (i === 0) return e.state.completed.length >= e.def.objectives.length ? DONE : ACTIVE;
    if (e.auto) return !met(i) ? UNAVAILABLE : e.state.completed.length < e.def.objectives.length ? ACTIVE : DONE; // QL-T1: no accept / hand-in step
    if (e.handedIn) return DONE;
    if (!e.accepted) return met(i) ? AVAILABLE : UNAVAILABLE; // an accepted quest never goes back to unavailable (old saves)
    return e.state.completed.length < e.def.objectives.length ? ACTIVE : READY;
  }
  function emit(name, id) { if (book.onChange) book.onChange(name, id); }
  // Fire quest:ready on a transition into READY (after progress or accept).
  function settleOne(i) {
    if (i === 0) return;
    const s = statusOf(i), e = entries[i];
    if (s === READY && e.prev !== READY) emit('quest:ready', e.def.id);
    if (e.auto && s === DONE && e.prev !== DONE) { book.lastReward = NO_REWARD; emit('quest:done', e.def.id); }
    e.prev = s;
  }
  function settle() { for (let i = 1; i < n; i++) settleOne(i); }
  /** Settle only the touched quests (+ dependents), in index order (same emit order as the brute-force pass), then clear the list. */
  function settleTouched() {
    for (let a = 1; a < touchedN; a++) { const v = touched[a]; let b = a - 1; while (b >= 0 && touched[b] > v) { touched[b + 1] = touched[b]; b--; } touched[b + 1] = v; }
    for (let k = 0; k < touchedN; k++) mark[touched[k]] = 0;
    const cnt = touchedN; touchedN = 0;
    for (let k = 0; k < cnt; k++) settleOne(touched[k]);
  }
  function settleQuest(i) { touchWithDeps(i); settleTouched(); }
  for (let i = 0; i < n; i++) entries[i].prev = statusOf(i);

  book.STATUS_NAMES = STATUS_NAMES;
  book.index = id => byId.has(id) ? byId.get(id) : -1;
  book.def = i => entries[i].def;
  book.giverOf = i => entries[i].giver; // QL-03: npc id that offers quest i
  book.questState = i => entries[i].state;
  book.status = i => statusOf(i);
  book.statusOf = id => byId.has(id) ? statusOf(byId.get(id)) : -1;
  book.feed = function feed(event) {
    let changed = false;
    if (event && event.type === 'item:count' && typeof event.id === 'string' && Number.isInteger(event.n)) { if (event.n > 0) packCounts.set(event.id, event.n); else packCounts.delete(event.id); }
    if (applyQuestEvent(entries[0].state, event, entries[0].def)) { changed = true; touchWithDeps(0); } // main always takes every fact (flags, ui.tracked)
    const byType = event ? listen.get(event.type) : undefined;
    if (byType !== undefined) {
      const l = byType.get(event.type === 'flag:set' ? event.key : event.id);
      if (l !== undefined) for (let k = 0; k < l.length; k++) {
        const i = l[k];
        if (applyQuestEvent(entries[i].state, event, entries[i].def)) { changed = true; touchWithDeps(i); }
      }
    }
    if (kindListen.size && event && event.type === 'beast:died' && typeof event.id === 'string') { // OB-115: kind kill objectives count from accept
      const l = kindListen.get(kindOf(event.id));
      if (l !== undefined) for (let k = 0; k < l.length; k++) {
        const i = l[k];
        if ((entries[i].accepted || (entries[i].auto && met(i))) && !entries[i].handedIn && applyKindKill(entries[i].state, kindOf(event.id), entries[i].def)) { changed = true; touchWithDeps(i); }
      }
    }
    if (changed) { book.version++; settleTouched(); }
    return changed;
  };
  /** Reference implementation (tests): every quest sees every event, all statuses recomputed. */
  book.feedBrute = function feedBrute(event) {
    let changed = false;
    if (event && event.type === 'item:count' && typeof event.id === 'string' && Number.isInteger(event.n)) { if (event.n > 0) packCounts.set(event.id, event.n); else packCounts.delete(event.id); }
    for (let i = 0; i < n; i++) if (applyQuestEvent(entries[i].state, event, entries[i].def)) changed = true;
    if (event && event.type === 'beast:died' && typeof event.id === 'string') for (let i = 1; i < n; i++) if ((entries[i].accepted || (entries[i].auto && met(i))) && !entries[i].handedIn && kindListen.has(kindOf(event.id)) && kindListen.get(kindOf(event.id)).includes(i) && applyKindKill(entries[i].state, kindOf(event.id), entries[i].def)) changed = true;
    if (changed) { book.version++; settle(); }
    return changed;
  };
  book.accept = function accept(id) {
    const i = byId.get(id);
    if (i === undefined || i === 0 || statusOf(i) !== AVAILABLE) return false;
    const e = entries[i];
    e.accepted = true; e.seq = ++seqCounter; book.version++;
    if (kindListen.size) for (const o of e.def.objectives) if (o.when.type === 'beasts' && o.when.kind !== undefined) e.state.flags.kk = true; // OB-115: marks the count-from-accept rule (old saves lack it and seed from the dead set)
    e.given = []; // QL-04: items handed over on accept (taken back on abandon)
    if (book.packOps && book.packOps.add) for (const list of [e.def.giveOnAccept, e.def.giveOnTalk]) if (list) for (const it of list) { const k = book.packOps.add(it.id, it.n); if (k > 0) e.given.push({ id: it.id, n: k }); }
    emit('quest:accepted', id);
    settleQuest(i);
    return true;
  };
  /** Returns the frozen reward ({items:[]} when none) or null unless the quest is ready. The game grants it. */
  book.handIn = function handIn(id) {
    const i = byId.get(id);
    if (i === undefined || i === 0 || statusOf(i) !== READY) return null;
    const e = entries[i];
    // EQ-13: hand-in needs the item in the pack (requireItem, kept) and the gear worn (requireEquipped; packOps.equipped(id) is set by the game)
    if (e.def.requireItem && (!book.packOps || book.packOps.count(e.def.requireItem) < 1)) return null;
    if (e.def.requireEquipped && (!book.packOps || !book.packOps.equipped || !e.def.requireEquipped.every(id => book.packOps.equipped(id)))) return null;
    const dl = e.def.objectives.filter(o => o.when.type === 'deliver').map(o => o.when);
    if (dl.length) { // QUESTS-01: items must still be in the pack; they leave it at hand-in
      if (!book.packOps) return null;
      for (const w of dl) if (book.packOps.count(w.id) < w.count) return null;
      for (const w of dl) { book.packOps.remove(w.id, w.count); book.feed({ type: 'item:count', id: w.id, n: Math.max(0, book.packOps.count(w.id)) }); }
    }
    e.handedIn = true; book.version++;
    const reward = e.def.reward ? deepFreeze(structuredClone(e.def.reward)) : NO_REWARD;
    book.lastReward = reward;
    book.feed({ type: 'flag:set', key: 'quest.' + id + '.done', value: true });
    e.prev = DONE;
    settleQuest(i); // dependents of this hand-in (requires {quest, done})
    emit('quest:done', id);
    return reward;
  };
  /** QUESTS-01: J quest log "start stop". Only `abandonable: true` quests; progress resets, taken pickups stay taken, pack items stay (counts re-applied). */
  book.canAbandon = function canAbandon(id) {
    const i = byId.get(id);
    if (i === undefined || i === 0) return false;
    const s = statusOf(i);
    return entries[i].def.abandonable === true && (s === ACTIVE || s === READY);
  };
  book.abandon = function abandon(id) {
    if (!book.canAbandon(id)) return false;
    const e = entries[byId.get(id)];
    e.state = createQuest(e.def, null); e.accepted = false; e.seq = 0; e.prev = 0;
    if (e.given.length && book.packOps) for (const g of e.given) book.packOps.remove(g.id, Math.min(g.n, book.packOps.count(g.id))); // QL-03/04: given items go back
    e.given = [];
    for (const [item, c] of packCounts) if (listen.get('item:count')?.has(item)) applyQuestEvent(e.state, { type: 'item:count', id: item, n: c }, e.def);
    book.version++;
    if (entries[0].state.flags['ui.tracked'] === id) book.feed({ type: 'flag:set', key: 'ui.tracked', value: '' });
    emit('quest:abandoned', id);
    settleQuest(byId.get(id));
    return true;
  };
  /** Item ids the quests count in the pack (collect/deliver), for the game's pack poll. */
  book.countedItems = function countedItems() {
    const out = new Set();
    for (let i = 1; i < n; i++) for (const o of entries[i].def.objectives) if (o.when.type === 'collect' || o.when.type === 'deliver') out.add(o.when.id);
    return [...out];
  };
  book.hasKey = function hasKey(key) {
    const k = keys.get(key);
    return k !== undefined && !k.act && statusOf(k.qi) === k.op;
  };
  book.actKey = function actKey(key) {
    const k = keys.get(key);
    if (k === undefined || !k.act) return false;
    const id = entries[k.qi].def.id;
    return k.op === 'accept' ? book.accept(id) : book.handIn(id) !== null;
  };
  /** QL-04: world entity id for a giver / hand-in object id (def.giver.entity / turnInEntity), or the id itself. */
  book.entityFor = function entityFor(id) {
    for (let i = 1; i < n; i++) {
      const g = entries[i].def.giver;
      if (!g) continue;
      if (g.npc === id && g.entity) return g.entity;
      if (entries[i].turnIn === id && g.turnInEntity) return g.turnInEntity;
    }
    return id;
  };
  /**
   * QL-04: the player inspects object `objectId` (no dialogue). Accepts the first AVAILABLE quest it gives, else hands in the
   * first READY quest whose hand-in is this object. Returns {action:'accept'|'handin'|'refuse', id, text, reward?} or null
   * (nothing to do here). 'refuse' = a quest of this object is active but its items are not in the pack.
   */
  book.inspect = function inspect(objectId) {
    for (let i = 1; i < n; i++) {
      const e = entries[i];
      if (e.giver === objectId && statusOf(i) === AVAILABLE && book.accept(e.def.id)) return { action: 'accept', id: e.def.id, text: e.def.giver.text || '' };
    }
    for (let i = 1; i < n; i++) {
      const e = entries[i], s = statusOf(i);
      if (e.turnIn !== objectId) continue;
      if (s === READY) {
        const reward = book.handIn(e.def.id);
        if (reward) return { action: 'handin', id: e.def.id, text: e.def.giver.turnInText || '', reward };
        return { action: 'refuse', id: e.def.id, text: e.def.giver.refuseText || '' }; // items left the pack since
      }
      if (s === ACTIVE) return { action: 'refuse', id: e.def.id, text: e.def.giver.refuseText || '' };
    }
    return null;
  };
  // OB-125: a quest is MAIN when its def says `main: true` or the main chain (entries[0], m1) waits on its done flag
  // (`quest.<id>.done` as a flag objective, e.g. burl.boars / tower.blade); everything else is a side quest.
  const mainDone = new Set();
  for (const o of entries[0].def.objectives) if (o.when && o.when.type === 'flag' && typeof o.when.id === 'string') mainDone.add(o.when.id);
  // OB-155k: transitive - a quest a main quest requires ({quest, done|step}) is main too (tower.blade, mq.river.road, mq.ford.stones)
  const mainSet = new Set();
  for (let i = 0; i < n; i++) if (i === 0 || isMainDef(entries[i].def) || mainDone.has('quest.' + entries[i].def.id + '.done')) mainSet.add(i);
  for (let grew = true; grew;) { grew = false; for (const i of [...mainSet]) for (const r of entries[i].def.requires || []) { const q = r.quest ? byId.get(r.quest) : undefined; if (q !== undefined && !mainSet.has(q)) { mainSet.add(q); grew = true; } } }
  book.isMain = (i) => mainSet.has(i); // OB-155: ONE rule (questLog uses it too)
  /** Giver marks: `outAvail` ('!') / `outReady` ('?') get the main-chain quests; with the optional `sideAvail` / `sideReady` the side
   *  quests go there instead (OB-125: a different colour), else everything goes to the first two (old behaviour). */
  book.giverMarks = function giverMarks(outAvail, outReady, sideAvail, sideReady) {
    let a = 0, r = 0, sa = 0, sr = 0;
    for (let i = 1; i < n; i++) {
      const s = statusOf(i), side = sideAvail && !book.isMain(i);
      if (s === AVAILABLE) { if (side) sideAvail[sa++] = entries[i].giver; else outAvail[a++] = entries[i].giver; }
      else if (s === READY) { if (side) sideReady[sr++] = entries[i].turnIn; else outReady[r++] = entries[i].turnIn; } // '?' hangs where the quest is handed in (default: the giver)
    }
    outAvail.length = a; outReady.length = r;
    if (sideAvail) { sideAvail.length = sa; sideReady.length = sr; }
  };
  /** OB-124b: main-chain step marks (data: objective.mark = {start?, end?}). The CURRENT m1 step shows a gold '!' at `start` while it
   *  has one (step available), else a gold '?' at `end` (step active / where it completes). Appends to the main lists; none when done. */
  book.chainMarks = function chainMarks(outAvail, outReady) {
    const st = entries[0].state, o = entries[0].def.objectives[st.completed.length];
    const m = o && o.mark; if (!m) return;
    // OB-157: optional mark.taken = flag set when the start giver handed the step over -> the '!' is gone, the '?' at `end` shows
    const taken = m.taken && entries[0].state.flags[m.taken];
    if (m.start && !taken) outAvail[outAvail.length] = m.start;
    else if (m.end && outReady) outReady[outReady.length] = m.end; // D-098: go/wake/use X -> X itself shows the gold '?' while the step is active
  };
  /** D-098: grey '?' = where each ACTIVE (accepted, not yet ready) giver quest is finished (its hand-in place; default the giver). */
  book.activeMarks = function activeMarks(outGrey) {
    let g = 0;
    for (let i = 1; i < n; i++) if (statusOf(i) === ACTIVE && entries[i].turnIn) outGrey[g++] = entries[i].turnIn;
    outGrey.length = g;
  };
  /** OB-155j: ONE marker per world entity. Priority: '?' ready (gold before blue) > gold '!' > blue '!'. Lists are filtered in place;
   *  keyOf maps a marker id to its entity (default book.entityFor). */
  book.dedupeMarks = function dedupeMarks(gA, gR, sA, sR, keyOf = book.entityFor, grey) {
    const seen = new Set();
    for (const l of [gR, sR, gA, sA, grey]) {
      if (!l) continue; let k = 0;
      for (let j = 0; j < l.length; j++) { const e = keyOf(l[j]); if (seen.has(e)) continue; seen.add(e); l[k++] = l[j]; }
      l.length = k;
    }
  };
  /** QL-03: index of the tracked giver quest: the player's pick (main flag `ui.tracked`, saved with the main quest) while it is active/ready, else the most recently accepted one, else -1. */
  book.tracked = function tracked() {
    const pin = entries[0].state.flags['ui.tracked'];
    if (typeof pin === 'string' && pin && byId.has(pin) && byId.get(pin) > 0) { const s = statusOf(byId.get(pin)); if (s === ACTIVE || s === READY) return byId.get(pin); }
    let best = -1, seq = 0;
    for (let i = 1; i < n; i++) {
      const s = statusOf(i);
      if ((s === ACTIVE || s === READY) && entries[i].seq >= seq) { best = i; seq = entries[i].seq; }
    }
    return best;
  };
  /** QL-03: pin a giver quest as THE tracked one (HUD objective + compass); `null`/'' clears the pin. Returns true if the pin changed. */
  book.track = function track(id) {
    const i = id ? byId.get(id) : 0;
    if (id && (i === undefined || i === 0)) return false;
    if (id) { const s = statusOf(i); if (s !== ACTIVE && s !== READY) return false; }
    return book.feed({ type: 'flag:set', key: 'ui.tracked', value: id || '' });
  };
  book.objectives = (i, out) => questObjectives(entries[i].state, entries[i].def, out);
  book.toSave = function toSave() {
    const quests = {};
    for (let i = 1; i < n; i++) {
      const e = entries[i];
      quests[e.def.id] = { quest: JSON.parse(stringifyQuest(e.state, e.def)), accepted: e.accepted, handedIn: e.handedIn };
      if (e.given.length) quests[e.def.id].given = e.given.map(g => ({ id: g.id, n: g.n })); // QL-04
      if (e.accepted && e.seq > 0) quests[e.def.id].seq = e.seq; // OB-087: accept order
    }
    return { quest: JSON.parse(stringifyQuest(entries[0].state, entries[0].def)), quests };
  };
  book.hashInto = function hashInto(h) {
    for (let i = 0; i < n; i++) { h.u32(statusOf(i)); h.u32(questHash(entries[i].state, entries[i].def)); }
  };
  return book;
}

/** Old save (no game.quests) -> quests map for the giver quests, or null. Pure; no retroactive reward. */
export function migrateQuestSave(game, defs) {
  const main = game?.quest;
  if (game?.quests) {
    const bd = (defs.givers || []).find(d => d.id === BLADE);
    if (!bd || game.quests[BLADE]) return game.quests;
    const b = bladeFromMain(bd, main, game.quests['burl.boars']);
    return b ? { ...game.quests, [BLADE]: b } : game.quests;
  }
  if (!main || !Array.isArray(main.completed)) return null;
  const out = {};
  let any = false;
  const dead = [...new Set([...(main.deadBeasts || []), ...(game.deadBeasts || [])])].sort();
  for (const def of defs.givers || []) {
    const legacy = LEGACY[def.id]; if (!legacy) continue;
    const afterIdx = defs.main.objectives.findIndex(o => o.id === legacy.afterStep);
    const done = main.completed.includes(legacy.doneStep);
    const atFight = !done && afterIdx >= 0 && main.completed.length === afterIdx + 1;
    if (!done && !atFight) continue;
    const q = createQuest(def);
    for (const id of dead) { applyQuestEvent(q, { type: 'beast:died', id }, def); for (const o of def.objectives) if (o.when.type === 'beasts' && o.when.kind !== undefined && kindOf(id) === o.when.kind) applyKindKill(q, o.when.kind, def); } // OB-115: legacy m1 saves seed kind counts from the dead set
    if (done) for (const o of def.objectives) if (o.when.type === 'beasts' && o.when.ids) for (const id of o.when.ids) applyQuestEvent(q, { type: 'beast:died', id }, def);
    out[def.id] = { quest: JSON.parse(stringifyQuest(q, def)), accepted: true, handedIn: done };
    any = true;
  }
  const bd = (defs.givers || []).find(d => d.id === BLADE), b = bladeFromMain(bd, main, out['burl.boars']);
  if (b) { out[BLADE] = b; any = true; }
  return any ? out : null;
}

/** CH1-01 (38.37 item 1): every objective `section` names a declared section and each section is one contiguous run. */
export function validateSections(def) {
  const secs = def?.sections;
  const used = def.objectives.some(o => o.section !== undefined);
  if (secs === undefined && !used) return def;
  if (!Array.isArray(secs)) throw new Error('quest: sections must be an array');
  const declared = new Set();
  for (const s of secs) {
    if (!s || typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' || !s.title || declared.has(s.id)) throw new Error('quest: invalid section');
    declared.add(s.id);
  }
  const closed = new Set();
  let cur = null;
  for (const o of def.objectives) {
    const s = o.section;
    if (s === undefined) { if (cur !== null) { closed.add(cur); cur = null; } continue; }
    if (!declared.has(s)) throw new Error('quest: unknown section ' + s);
    if (s !== cur) {
      if (closed.has(s)) throw new Error('quest: section not contiguous ' + s);
      if (cur !== null) closed.add(cur);
      cur = s;
    }
  }
  return def;
}

// Old (pre-CH1) m1 order -> the new step ids each old step implies. `lantern` is dropped.
const CH1_IMPLIES = { wake: ['wake'], breach: ['breach'], sword: ['sword'], beasts: ['leave', 'beasts'], waystone: ['follow', 'waystone'] };
const CH1_ORDER = ['wake', 'breach', 'sword', 'leave', 'beasts', 'follow', 'waystone'];
const CH1_ALL = [...CH1_ORDER, 'road', 'relayFound', 'relay1']; // 'fen' removed (FEN-OFF-01)

/**
 * CH1-01 (38.37 item 8). Pure: game = save-like {quest, world?:{state}}; returns game itself when nothing to do,
 * else a copy with the m1 `completed` rewritten to the longest new prefix implied by the old one (facts kept).
 * An old 'waystone' also sets flags waystone.waystone.woken, burl.phase 4, aether.attuned in world.state.
 * Runs when `completed` has the old `lantern` or is otherwise not a prefix of the new chain.
 */
export function migrateM1Ch1(game, newIds = null) {
  const q = game?.quest;
  if (!q || !Array.isArray(q.completed) || q.questId !== 'm1') return game;
  const ids = newIds || CH1_ALL;
  // FEN-OFF-01: the retired `fen` step is dropped; the rest of the chain is kept as-is.
  const hadFen = q.completed.includes('fen');
  const done = hadFen ? q.completed.filter((id) => id !== 'fen') : q.completed;
  if (hadFen && done.every((id, i) => id === ids[i]) && !done.includes('lantern')) return { ...game, quest: { ...q, completed: done } };
  const isPrefix = done.every((id, i) => id === ids[i]);
  if (isPrefix && !done.includes('lantern')) return game;
  const implied = new Set();
  for (const id of done) for (const n of CH1_IMPLIES[id] || []) implied.add(n);
  const completed = [];
  for (const id of CH1_ORDER) { if (!implied.has(id)) break; completed.push(id); }
  const out = { ...game, quest: { ...q, completed } };
  if (implied.has('waystone')) {
    out.world = { ...(game.world || {}), state: { ...(game.world?.state || {}), 'waystone.waystone.woken': true, 'burl.phase': 4, 'aether.attuned': true } };
  }
  return out;
}
