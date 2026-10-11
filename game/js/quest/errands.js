// QL-WIRE + QL-13 (game side of the 21 Ch1-2 errands, content/quests/ch12): everything main.js needs that is not in the quest book itself.
//  - gateOnMeet: errands only open after the first talk with Burl at home (else they pre-empt his `bear.home` greeting).
//  - patchBearDialogue: writer `def.lines` (offer/active/ready) of Burl's errands -> dialogue nodes + entry routes (ready, offer, active).
//  - isWorn: book.packOps.equipped(id) from components.equipment.
//  - createErrands: inspect hook for object givers (post / notePost; relays via their relay.wake touch), talk.<site> flags,
//    target1..3.hit (sword + arrow both emit combat:hit {target}), escort.bear.relayBend.
// No render / engine code; pure functions + a small stateful object, tested in errands.test.js.

const BURL_ENTITY = 'bear';
/** Quest-site name for an entity id (flag `talk.<site>`): Burl's entity is `bear`, every other site is its entity id. */
export const siteOf = (entityId) => (entityId === BURL_ENTITY ? 'burl' : entityId);
const cap = (s, n) => String(s).slice(0, n);

/** Returns defs where every {flag:'burl.home'} requirement is joined by {flag:'burl.home.met'} (defs may be frozen: copies, input untouched). */
export function gateOnMeet(defs) {
  return defs.map((d) => {
    if (!Array.isArray(d.requires) || !d.requires.some((r) => r && r.flag === 'burl.home') || d.requires.some((r) => r && r.flag === 'burl.home.met')) return d;
    return { ...d, requires: [...d.requires, { flag: 'burl.home.met' }] };
  });
}

const isBurlErrand = (d) => d && !d.main && d.giver && d.giver.npc === BURL_ENTITY && d.lines && Array.isArray(d.lines.offer) && d.lines.offer.length > 0;

/**
 * Burl's errands as dialogue: returns a NEW raw dialogue (input untouched). Routes go in front of `bear.home.again`:
 * all ready, then all offers, then all actives (an offer never hides behind an active errand). Node ids `bear.err.<n>.*`.
 */
export function patchBearDialogue(raw, defs) {
  const errs = defs.filter(isBurlErrand);
  if (!errs.length) return raw;
  const out = { ...raw, nodes: { ...raw.nodes } };
  const ready = [], offer = [], active = [];
  errs.forEach((d, i) => {
    const k = 'bear.err.' + i, L = d.lines, nodes = out.nodes;
    const mk = (lines, extra) => ({ lines: lines.map((l) => cap(l, 200)), speaker: 'burl', ...extra });
    const off = L.offer, last = off[off.length - 1];
    const acceptChoices = [{ next: k + '.accepted', setFlag: 'q.' + d.id + '.accept', text: "I'll do it." }, { next: 'bear.q.later', text: 'Not yet.' }];
    if (off.length > 1) {
      nodes[k + '.offer.1'] = mk(off.slice(0, -1), { next: k + '.offer.2' });
      nodes[k + '.offer.2'] = mk([last], { choices: acceptChoices });
    } else nodes[k + '.offer.1'] = mk([last], { choices: acceptChoices });
    const act = L.active && L.active.length ? L.active : [last];
    nodes[k + '.accepted'] = mk(act, { end: true });
    nodes[k + '.active'] = mk(act, { end: true });
    nodes[k + '.ready'] = mk([...(L.ready && L.ready.length ? L.ready : ['Well done.']), ...(L.done || [])], { end: true, setFlag: 'q.' + d.id + '.handin' });
    ready.push({ node: k + '.ready', requires: 'q.' + d.id + '.ready' });
    offer.push({ node: k + '.offer.1', requires: 'q.' + d.id + '.available' });
    active.push({ node: k + '.active', requires: 'q.' + d.id + '.active' });
  });
  const entry = raw.entry.slice(), at = entry.findIndex((e) => e.node === 'bear.home.again');
  entry.splice(at < 0 ? 0 : at, 0, ...ready, ...offer, ...active);
  out.entry = entry;
  return out;
}

/** True when item `id` is worn in any slot of components.equipment `eq` (slot value = item id, or {id}). */
export function isWorn(eq, id) {
  if (!eq) return false;
  for (const k of Object.keys(eq)) { const v = eq[k]; if (v === id || (v && typeof v === 'object' && v.id === id)) return true; }
  return false;
}

/** Banner rows for an object inspect result: the writer's lines for the action, else null (caller keeps def.giver text). */
export function bannerLines(def, action, wrap, maxRows = 10) {
  const L = def && def.lines; if (!L) return null;
  const set = action === 'accept' ? L.offer : action === 'handin' ? (L.ready || L.done ? [...(L.ready || []), ...(L.done || [])] : null) : action === 'refuse' ? L.active : null;
  if (!Array.isArray(set) || !set.length) return null;
  const rows = []; for (const l of set) for (const r of wrap(l)) rows.push(r);
  return rows.slice(0, maxRows);
}

const TARGET_RE = /^target([123])$/;
const ESCORT_R = 14;
const ACTIVE = 2; // questBook statusOf: 0 unavailable, 1 available, 2 active, 3 ready, 4 done
/**
 * @param {{getBook:()=>any, questFlag:(k:string,v?:any)=>any, inspect:(id:string)=>void}} o
 *   inspect(objectId) = main's QL-04 sink (book.inspect + banner). questFlag = world.state + book.feed.
 */
export function createErrands({ getBook, questFlag, inspect }) {
  let world = null, relayEnt = new Map();
  const status = (id) => { const b = getBook(); return b ? b.statusOf(id) : -1; };

  /** An ACTIVE quest has a flag objective `key`. */
  function wants(key) {
    const b = getBook(); if (!b) return false;
    for (let i = 1; i < b.count; i++) {
      if (b.status(i) !== ACTIVE) continue;
      for (const o of b.def(i).objectives) if (o.when && o.when.type === 'flag' && o.when.id === key) return true;
    }
    return false;
  }
  const api = {
    /** world:loaded: [E] Inspect on the object givers that have no dialogue and no relay touch of their own. */
    load(w) {
      world = w; relayEnt = new Map();
      const b = getBook(); if (!b) return 0;
      let added = 0;
      for (let i = 1; i < b.count; i++) {
        const g = b.def(i).giver; if (!g) continue;
        for (const id of [g.npc, g.turnIn]) {
          if (!id) continue;
          const h = w.get(id), d = h && h.data, c = d && d.components;
          if (!c || !d.transform) continue;
          if (c.waystone && c.waystone.kind === 'relay') { relayEnt.set(c.waystone.id, id); continue; } // relay: its own relay.wake touch -> onEvent
          if (c.dialogue) continue;
          const key = 'qi.' + id;
          if (w.interactables.some((r) => r.key === key)) continue;
          w.addInteractable({ key, name: 'quest.inspect', x: d.transform.x, y: d.transform.y, z: d.transform.z + 0.6, radius: 2.4, prompt: '[E] Inspect', def: { objectId: id } });
          added++;
        }
      }
      return added;
    },
    /** gameHooks event: touching an awake relay inspects its errands. */
    onEvent(name, d) {
      if (name === 'prop:touched' && d && d.kind === 'relay') { const id = relayEnt.get(d.id); if (id) api.inspected(id); }
    },
    /** Any inspect of entity `id`: sets talk.<site> while an errand wants it, then lets the book act. */
    inspected(id) {
      const f = 'talk.' + siteOf(id);
      if (wants(f)) questFlag(f, true);
      inspect(id);
    },
    /** dialogueCtl.onTalk(npcId): talk flag only (the dialogue itself drives accept / hand-in). */
    talked(id) { const f = 'talk.' + siteOf(id); if (wants(f)) questFlag(f, true); },
    /** combat:hit {target}: straw men (sword or arrow) while sq.straw is active. */
    hit(p) {
      const m = p && typeof p.target === 'string' ? TARGET_RE.exec(p.target) : null;
      if (m && status('sq.straw') === ACTIVE) questFlag('target' + m[1] + '.hit', true);
    },
    /** ~1 Hz: Burl within ESCORT_R of the Bend relay while sq.burl.walk is active (he needs a walk path to get there: content). */
    escortTick() {
      if (!world || status('sq.burl.walk') !== ACTIVE) return false;
      const b = world.get('bear'), r = world.get('relayBend'), bt = b && b.data && b.data.transform, rt = r && r.data && r.data.transform;
      if (!bt || !rt) return false;
      if (b.data.components && b.data.components.walks && b.data.components.walks.toBend) return false; // M4: burlEscort leads him there and fires the flag on arrival
      const dx = bt.x - rt.x, dy = bt.y - rt.y;
      if (dx * dx + dy * dy > ESCORT_R * ESCORT_R) return false;
      questFlag('escort.bear.relayBend', true); return true;
    },
  };
  return api;
}
