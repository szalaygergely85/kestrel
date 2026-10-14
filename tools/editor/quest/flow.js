// tools/editor/quest/flow.js - ED-QUEST-02. Pure (no DOM, no fs): the list rows, text filter and the flow
// nodes of one quest (giver -> offer Accept/Exit -> objectives -> return -> reward), all in plain names.
// `names` = { npc(id), item(id) } resolvers; defaults humanize the id ("bear" -> "Bear", never a raw id with dots).

const human = (id) => {
  const h = String(id ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._]+/g, ' ').trim().toLowerCase();
  return h.charAt(0).toUpperCase() + h.slice(1);
};

/** Resolvers from the game's item defs ({id:{name}}) plus optional npc/site name overrides. */
export function makeNames({ itemDefs = {}, npcNames = {}, sites = {} } = {}) {
  return {
    item: (id) => (itemDefs[id] && itemDefs[id].name) || human(id),
    npc: (id) => { const e = (sites[id] && sites[id].entity) || id; return npcNames[e] || npcNames[id] || human(e); },
  };
}
const DEF = makeNames();

export const objText = (o) => o.text ?? o.objText ?? '';
export const objJournal = (o) => o.journal ?? '';
export const objField = (q) => (q.raw.objectives ? 'objectives' : 'steps');
export const objTextKey = (q) => (objField(q) === 'objectives' ? 'text' : 'objText');
export const isSide = (q) => /^sq\./.test(q.id);
export const regionOf = (q) => (q.kind === 'pack' ? q.file.split('/')[0] : 'main');

/** One row per quest for the list: title, id (shown small), chip colour, region. */
export function questRows(quests, names = DEF) {
  return quests.map((q) => ({
    id: q.id, title: q.title, chip: isSide(q) ? 'blue' : 'gold', side: isSide(q), region: regionOf(q),
    giver: q.giver ? names.npc(q.giver) : '',
  }));
}

/** Case-insensitive filter over title, id and giver (plain name or raw id). */
export function filterRows(rows, text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return rows;
  return rows.filter((r) => r.title.toLowerCase().includes(t) || r.id.toLowerCase().includes(t) || r.giver.toLowerCase().includes(t));
}

/** Items to pick a reward from, by plain name: [{id, name}] sorted by name. */
export function itemChoices(itemDefs) {
  return Object.keys(itemDefs || {}).map((id) => ({ id, name: itemDefs[id].name || human(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Flow nodes in order: giver, offer, objective 1..n, return, reward. Each { kind, label, detail, index? }. */
export function buildFlow(q, names = DEF) {
  const nodes = [];
  const giver = q.giver ? names.npc(q.giver) : 'nobody yet';
  nodes.push({ kind: 'giver', label: `Giver: ${giver}`, detail: q.requires.length ? `Needs ${q.requires.length} earlier step${q.requires.length > 1 ? 's' : ''}` : '' });
  const offer = q.lines && Array.isArray(q.lines.offer) ? q.lines.offer : [];
  nodes.push({ kind: 'offer', label: 'Offer: Accept / Exit', detail: offer.join(' ') });
  q.objectives.forEach((o, i) => nodes.push({ kind: 'objective', index: i, label: `${i + 1}. ${objText(o) || '(no text)'}`, detail: objJournal(o) }));
  nodes.push({ kind: 'return', label: `Return: ${q.returnText || 'Go back to ' + giver}`, detail: '' });
  const items = (q.reward && q.reward.items) || [];
  nodes.push({
    kind: 'reward', detail: '',
    label: 'Reward: ' + (items.length ? items.map((r) => names.item(r.id) + (r.n > 1 ? ' x' + r.n : '')).join(', ') : 'none'),
  });
  return nodes;
}

/** The flow as plain text lines (what the panel shows and the verify script asserts). */
export const flowText = (q, names = DEF) => buildFlow(q, names).map((n) => n.label).join('\n');
