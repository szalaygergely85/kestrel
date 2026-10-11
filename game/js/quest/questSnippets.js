// QL-T4 (architecture 38.44 item 5): game-side dialogue snippet generator. For every non-main quest a giver NPC gets
//   entry rows  q.<id>.ready | q.<id>.available | q.<id>.active  +  nodes qs.<id>.{offer.1..,accepted,active,ready}
// inserted BEFORE the NPC's hand-written scene entries (after any leading hand-written q.* overrides).
// Text = def.lines.<offer|active|ready|done> (writer) else content/dialogue/quest-snippets.json filled with
// {title} {objective} {giver} {reward} {count} {target}. Overrides: main quests and any quest the dialogue already routes by hand
// (an entry requiring q.<id>.<state>) are left alone. Order: ready, available, active (an offer never hides behind an
// active errand; one state per quest, so no quest competes with itself). Offers end in accept / "not yet": never a forced choice.
// talk / escort quests: the flags talk.<site> / escort.<npc>.<area> are set by errands.js (any talk with the site NPC; the
// escort tick); the generated nodes only speak. Pure, no engine/DOM. Input untouched.

const cap = (s, n = 200) => String(s).slice(0, n);

/** Which snippet group a def uses, from its first objective. */
export function kindOf(def) {
  const w = def && def.objectives && def.objectives[0] && def.objectives[0].when;
  if (!w) return 'generic';
  switch (w.type) {
    case 'pickups': return 'collect';
    case 'beasts': return 'kill';
    case 'deliver': return 'deliver';
    case 'item': return 'fetch';
    case 'area': return 'explore';
    case 'flag': return /^talk\./.test(w.id) ? 'talk' : /^escort\./.test(w.id) ? 'escort' : 'generic';
    default: return 'generic';
  }
}

function slotValues(def, giver) {
  const ob = def.objectives && def.objectives[0], w = (ob && ob.when) || {};
  const rw = def.reward && Array.isArray(def.reward.items) ? def.reward.items.map((i) => (i.n > 1 ? i.n + ' ' : '') + i.id).join(', ') : 'my thanks';
  const target = w.to || (Array.isArray(w.ids) ? w.ids[0] : w.id) || '';
  const count = w.count || (Array.isArray(w.ids) ? w.ids.length : 1);
  return { title: def.title || def.id, objective: ob ? ob.text : def.title || def.id, giver, reward: rw, count: String(count), target: String(target) };
}
const fill = (line, v) => line.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

/** Lines for one state (ready | available | active): writer lines win, else the snippet of the quest's kind, then the generic one. */
export function linesFor(def, state, snippets, giver) {
  const L = def.lines || {};
  const set = state === 'ready' ? (L.ready && L.ready.length ? [...L.ready, ...(L.done || [])] : null) : L[state === 'available' ? 'offer' : state];
  if (Array.isArray(set) && set.length) return set.map((l) => cap(l));
  if (state === 'active' && L.offer && L.offer.length) return [cap(L.offer[L.offer.length - 1])]; // writer wrote an offer only: repeat its ask
  const sn = snippets || {}, key = state === 'available' ? 'offer' : state, kind = sn.byKind && sn.byKind[kindOf(def)];
  const grp = (kind && kind[key]) || (sn.generic && sn.generic[key]) || (key === 'ready' ? ['Well done.'] : [def.title || def.id]);
  const v = slotValues(def, giver);
  return grp.map((l) => cap(fill(l, v)));
}

/**
 * Returns a NEW raw dialogue for NPC entity `npcId` with generated routes for `defs` (input untouched; same object when nothing to add).
 * A def is offered/active at def.giver.npc and handed in at def.giver.turnIn (also routed at the giver).
 * opts: {before: node id to insert in front of, speaker}.
 */
export function generateForNpc(raw, npcId, defs, snippets, opts = {}) {
  const speaker = opts.speaker || Object.keys(raw.speakers || {}).find((k) => !(raw.speakers[k] && raw.speakers[k].player)) || 'npc';
  const label = raw.speakers && raw.speakers[speaker] ? String(raw.speakers[speaker].label || speaker) : speaker;
  const giverName = label.charAt(0) + label.slice(1).toLowerCase();
  const hand = new Set((raw.entry || []).map((e) => e.requires).filter(Boolean));
  const sn = snippets || {}, ch = sn.choices || {};
  const out = { ...raw, nodes: { ...raw.nodes } }, nodes = out.nodes;
  const rows = { ready: [], available: [], active: [] };
  const mk = (lines, extra) => ({ lines, speaker, ...extra });
  const laterId = 'qs.later';
  let usedLater = false;
  for (const d of defs) {
    if (!d || d.main || !d.giver) continue;
    const here = d.giver.npc === npcId, turn = (d.giver.turnIn || d.giver.npc) === npcId;
    if (!here && !turn) continue;
    const k = 'qs.' + d.id;
    const add = (state) => {
      if (hand.has('q.' + d.id + '.' + state)) return; // hand-written route wins
      if (state === 'ready') {
        nodes[k + '.ready'] = mk(linesFor(d, 'ready', sn, giverName), { end: true, setFlag: 'q.' + d.id + '.handin' });
        rows.ready.push({ node: k + '.ready', requires: 'q.' + d.id + '.ready' });
      } else if (state === 'available') {
        const off = linesFor(d, 'available', sn, giverName), last = off[off.length - 1];
        const choices = [{ next: k + '.accepted', setFlag: 'q.' + d.id + '.accept', text: cap(ch.accept || "I'll do it.", 40) }, { next: laterId, text: cap(ch.later || 'Not yet.', 40) }];
        if (off.length > 1) { nodes[k + '.offer.1'] = mk(off.slice(0, -1), { next: k + '.offer.2' }); nodes[k + '.offer.2'] = mk([last], { choices }); } else nodes[k + '.offer.1'] = mk([last], { choices });
        nodes[k + '.accepted'] = mk(linesFor(d, 'active', sn, giverName), { end: true });
        usedLater = true;
        rows.available.push({ node: k + '.offer.1', requires: 'q.' + d.id + '.available' });
      } else {
        nodes[k + '.active'] = mk(linesFor(d, 'active', sn, giverName), { end: true });
        rows.active.push({ node: k + '.active', requires: 'q.' + d.id + '.active' });
      }
    };
    if (turn || here) add('ready'); // the giver always owns all three states; a different hand-in NPC with a dialogue gets `ready` too
    if (here) { add('available'); add('active'); }
  }
  const gen = [...rows.ready, ...rows.available, ...rows.active];
  if (!gen.length) return raw;
  if (usedLater) nodes[laterId] = mk([cap(sn.later || 'Another time, then.')], { end: true });
  const entry = (raw.entry || []).slice();
  let at = opts.before ? entry.findIndex((e) => e.node === opts.before) : -1;
  if (at < 0) { at = 0; while (at < entry.length && /^q\./.test(entry[at].requires || '')) at++; }
  entry.splice(at, 0, ...gen);
  out.entry = entry;
  return out;
}

/** Where generated routes go when a dialogue needs a fixed anchor: Burl's errands sit before his home greeting. */
export const ANCHORS = { bear: 'bear.home.again' };

/** raws = {npcId: rawDialogue} -> same keys with generated routes. */
export function generateAll(raws, defs, snippets) {
  const out = {};
  for (const id of Object.keys(raws)) out[id] = generateForNpc(raws[id], id, defs, snippets, { before: ANCHORS[id] });
  return out;
}
