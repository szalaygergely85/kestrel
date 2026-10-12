// QL-T1 (architecture 38.44 items 2-4, 6, 7): quest templates expand at load to the plain version:1 defs quest.js / questBook.js
// already run. Pure (no world/DOM/clock/random), deterministic and idempotent. quest.js semantics are unchanged.
import { validateGiverQuest } from './questBook.js';

export const TEMPLATES = Object.freeze(['collect', 'deliver', 'fetch', 'kill', 'talk', 'escort', 'explore']);
const ID = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const OBJ_MAX = 38;
const TIER_NUM = { worn: 1, sturdy: 2, fine: 3 };

/** FNV-1a 32 bit (same family as questHash); the gear pick is `slots[fnv1a(questId) % len]`. */
export function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function fail(src, msg) { throw new Error('template ' + (src && src.id) + ': ' + msg); }
function needId(src, v, what) { if (typeof v !== 'string' || !ID.test(v)) fail(src, 'invalid ' + what); return v; }
function needIds(src, v, what) { if (!Array.isArray(v) || !v.length || !v.every(x => typeof x === 'string' && ID.test(x))) fail(src, 'invalid ' + what); return v; }
function needCount(src, v, max) { if (!Number.isInteger(v) || v < 1 || (max && v > max)) fail(src, 'invalid count'); return v; }

function site(src, ctx, name) {
  const s = ctx && ctx.sites && ctx.sites[name];
  if (!s || typeof s.entity !== 'string' || !s.entity) fail(src, 'unknown site ' + name);
  return s;
}

/** One step -> {objs:[...], extra:{...}} where extra is merged onto the def (giveOnAccept, requireItem). */
function expandStep(src, step, ctx, key, extra) {
  const p = step.params || step, t = step.template;
  const text = (def) => (typeof step.objText === 'string' && step.objText ? step.objText : def).slice(0, 200);
  const o = (suffix, txt, when) => (typeof step.journal === 'string' && step.journal ? { id: key + suffix, text: txt, journal: step.journal.slice(0, 240), when } : { id: key + suffix, text: txt, when }); // OB-097: optional journal summary
  switch (t) {
    case 'collect': { // ids = ONE pack-counted item id (QL-01 counts it via item:count); count = how many
      const ids = p.ids || (p.item ? [p.item] : null); needIds(src, ids, 'collect.ids');
      if (ids.length !== 1) fail(src, 'collect needs exactly one item id (pack-counted)');
      const n = needCount(src, p.count);
      return [o('', text('Collect ' + n + ' ' + ids[0]), { type: 'collect', id: ids[0], count: n })];
    }
    case 'deliver': { // accept gives the item; hand-in at `to` consumes it (questBook deliver)
      needId(src, p.item, 'deliver.item'); needId(src, p.to, 'deliver.to');
      const n = p.count === undefined ? 1 : needCount(src, p.count);
      extra.giveOnAccept = [...(extra.giveOnAccept || []), { id: p.item, n }];
      extra.turnInSite = p.to;
      return [o('', text('Bring the ' + p.item + ' to ' + p.to), { type: 'deliver', id: p.item, count: n, to: '@turnIn' })];
    }
    case 'fetch': // item must be in the pack; hand-in at the giver (extra.requireItem is data for the game's hand-in)
      needId(src, p.item, 'fetch.item'); extra.requireItem = p.item;
      return [o('', text('Find the ' + p.item), { type: 'item', id: p.item })];
    case 'kill': {
      needIds(src, p.ids, 'kill.ids'); const n = needCount(src, p.count, p.ids.length);
      return [o('', text('Defeat ' + n + ' of ' + p.ids.length), { type: 'beasts', ids: [...p.ids], count: n })];
    }
    case 'talk':
      needId(src, p.to, 'talk.to'); site(src, ctx, p.to);
      return [o('', text('Talk to ' + p.to), { type: 'flag', id: 'talk.' + p.to, equals: true })];
    case 'escort': // the follow path is burlEscort generalised by npc id; the flag is set when the npc arrives (p.flag overrides it: the Burl walk uses burl.arrived)
      needId(src, p.npc, 'escort.npc'); needId(src, p.to, 'escort.to');
      return [o('', text('Take ' + p.npc + ' to ' + p.to), { type: 'flag', id: p.flag ? needId(src, p.flag, 'escort.flag') : 'escort.' + p.npc + '.' + p.to, equals: true })];
    case 'explore': {
      needIds(src, p.areas, 'explore.areas');
      return p.areas.map((a, i) => o(p.areas.length === 1 ? '' : String(i + 1), text('Reach ' + a), { type: 'area', id: a }));
    }
    default: return fail(src, 'unknown template ' + t);
  }
}

/** Reward from a table + optional gear pick (deterministic: fnv1a(questId) % slots). */
function expandReward(src, ctx, band) {
  const r = src.reward; if (!r) return undefined;
  let spec = r;
  if (typeof r.table === 'string') { spec = ctx.rewards && ctx.rewards[r.table]; if (!spec) fail(src, 'unknown reward table ' + r.table); }
  const items = [];
  for (const it of spec.items || []) { if (!it || typeof it.id !== 'string' || !Number.isInteger(it.n) || it.n < 1) fail(src, 'invalid reward item'); items.push({ id: it.id, n: it.n }); }
  // EQ-13: gear = fixed item id (string), {slot,tier} or {slots:[...],tier} (hash pick), or an array of those. tier = 1..3 or worn|sturdy|fine.
  if (spec.gear) {
    for (const g of Array.isArray(spec.gear) ? spec.gear : [spec.gear]) {
      if (typeof g === 'string') { needId(src, g, 'reward.gear'); items.push({ id: g, n: 1 }); continue; }
      const slots = g && (g.slots || (g.slot ? [g.slot] : null));
      if (!Array.isArray(slots) || !slots.length || !(Number.isInteger(g.tier) || TIER_NUM[g.tier])) fail(src, 'invalid gear reward');
      const want = Number.isInteger(g.tier) ? g.tier : TIER_NUM[g.tier];
      const slot = slots[fnv1a(src.id) % slots.length];
      let best = null;
      for (const it of ctx.items || []) {
        const iTier = it.tier !== undefined ? it.tier : it.equip && it.equip.tier, iSlot = it.slot !== undefined ? it.slot : it.equip && it.equip.slot;
        if (iSlot === slot && (iTier === want || TIER_NUM[iTier] === want) && (best === null || it.id < best)) best = it.id;
      }
      if (best === null) fail(src, 'no tier ' + g.tier + ' item for slot ' + slot);
      items.push({ id: best, n: 1 });
    }
  }
  const out = { items };
  if (Array.isArray(spec.unlock) && spec.unlock.length) out.unlock = spec.unlock.map(u => (typeof u === 'string' && u ? u : fail(src, 'invalid unlock reward'))); // FB-02: spell unlocks (only 'fireball' is dispatched by the game)
  return out;
}

function deepFreeze(o) { if (o && typeof o === 'object') { for (const k of Object.keys(o)) deepFreeze(o[k]); Object.freeze(o); } return o; }

/**
 * Pure: one pack row -> frozen plain def (validated by validateGiverQuest). `ctx = {sites, rewards, snippets, items, pack?}`.
 * A row with `objectives` and no `template`/`steps` passes through unchanged (escape hatch).
 */
export function expandQuest(src, ctx = {}) {
  if (!src || typeof src !== 'object') throw new Error('template: row must be an object');
  needId(src, src.id, 'id');
  const pack = ctx.pack || {};
  const def = { version: 1, id: src.id };
  if (typeof src.title === 'string') def.title = src.title; else fail(src, 'title required');
  let objectives, extra = {};
  if (src.template === undefined && src.steps === undefined) {
    if (!Array.isArray(src.objectives)) fail(src, 'template or objectives required');
    objectives = structuredClone(src.objectives);
  } else {
    const steps = src.steps !== undefined ? src.steps : [{ template: src.template, params: src.params, objText: src.objText, journal: src.journal }];
    if (!Array.isArray(steps) || !steps.length) fail(src, 'invalid steps');
    objectives = [];
    steps.forEach((st, i) => {
      if (!TEMPLATES.includes(st.template)) fail(src, 'unknown template ' + st.template);
      const key = steps.length === 1 ? st.template : st.template + (i + 1);
      for (const ob of expandStep(src, st, ctx, key, extra)) objectives.push(ob);
    });
    for (const ob of objectives) if (ob.text.length > OBJ_MAX && ctx.strictText) fail(src, 'objText over ' + OBJ_MAX);
  }
  // giver / hand-in sites
  if (src.site !== undefined) {
    const s = site(src, ctx, src.site);
    def.giver = { npc: s.entity };
    const turn = src.turnIn !== undefined ? src.turnIn : extra.turnInSite;
    if (turn !== undefined) { const t = site(src, ctx, turn); if (t.entity !== s.entity) def.giver.turnIn = t.entity; }
    def.site = src.site;
  }
  const turnNpc = def.giver ? (def.giver.turnIn || def.giver.npc) : null;
  for (const ob of objectives) if (ob.when.to === '@turnIn') ob.when.to = turnNpc;
  def.objectives = objectives;
  if (extra.giveOnAccept) def.giveOnAccept = extra.giveOnAccept;
  if (extra.requireItem) def.requireItem = extra.requireItem;
  if (Array.isArray(src.giveOnTalk) && src.giveOnTalk.length) def.giveOnTalk = structuredClone(src.giveOnTalk); // EQ-13: handed over when the quest is accepted at the giver
  if (src.requireEquipped !== undefined) def.requireEquipped = Array.isArray(src.requireEquipped) ? [...src.requireEquipped] : [src.requireEquipped];
  if (Array.isArray(src.opensAfter) && src.opensAfter.length) def.requires = src.opensAfter.map(q => ({ quest: needId(src, q, 'opensAfter'), done: true }));
  else if (Array.isArray(src.requires)) def.requires = structuredClone(src.requires);
  const reward = expandReward(src, ctx, src.band ?? pack.band);
  if (reward) def.reward = reward;
  def.main = src.main === true;
  def.abandonable = !def.main && !!def.giver && src.abandonable !== false;
  const band = src.band !== undefined ? src.band : pack.band;
  if (band !== undefined) def.band = band;
  if (pack.region !== undefined) def.region = pack.region;
  if (src.lines) def.lines = structuredClone(src.lines);
  if (typeof src.returnText === 'string') def.returnText = src.returnText;
  validateGiverQuest(def);
  return deepFreeze(def);
}

/** packs = [{region, band, quests:[src...]}]. Collects per-row errors instead of throwing. */
export function expandAll(packs, ctx = {}) {
  const defs = [], errors = [], seen = new Set();
  for (const pack of packs) {
    for (const src of pack.quests || []) {
      try {
        const def = expandQuest(src, { ...ctx, pack });
        if (seen.has(def.id)) throw new Error('duplicate quest id ' + def.id);
        seen.add(def.id); defs.push(def);
      } catch (e) { errors.push({ id: src && src.id, region: pack.region, message: String((e && e.message) || e) }); }
    }
  }
  return { defs, errors };
}
