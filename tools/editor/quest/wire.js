// tools/editor/quest/wire.js - ED-QUEST-WIRE. Pure helpers behind the quest panel's live lint list and "Play from here".
import { lintQuest } from './lintQuest.js';
import { classify } from './targets.js';

/** lintQuest ctx from the editor's world json. R5/R12 (walkable/support) are skipped: the editor has no walkability grid. */
export function buildLintCtx({ world, itemDefs, names, floorAt, sites = {} }) {
  const ents = new Map(), characters = new Set();
  for (const e of (world && world.entities) || []) { ents.set(e.id, e); if (classify(e) === 'character') characters.add(e.id); }
  for (const k of Object.keys(sites)) { const id = sites[k] && sites[k].entity; if (id && ents.has(id)) { ents.set(k, ents.get(id)); if (characters.has(id)) characters.add(k); } }
  return {
    characters, itemDefs,
    pos: (id) => { const e = ents.get(id); return e && Number.isFinite(e.x) ? { x: e.x, y: e.y, z: typeof e.z === 'number' ? e.z : (floorAt ? floorAt(e.x, e.y) : 0) } : null; },
    groundAt: floorAt, labelOf: names && names.npc ? (id) => names.npc(id) : (id) => id,
  };
}

/** Live lint of one quest -> messages with a panel "Go to" target ({kind,id}); [] when q is null. */
export function liveLint(model, q, ctx) { return q ? lintQuest(model, q.id, ctx) : []; }

/** Dropdown for "Play from here": value is the `?qstate` preset token (parseQstateParam format). */
export function presetOptions(q) {
  const n = q ? q.objectives.length : 0, out = [{ value: 'notStarted', label: 'Not started' }, { value: 'accepted', label: 'Accepted' }];
  for (let i = 2; i <= n; i++) out.push({ value: 'objective' + i, label: 'Objective ' + i });
  out.push({ value: 'readyToReturn', label: 'Ready to return' });
  return out;
}

/** Game URL for the editor camera ground position. base e.g. '../../game/index.html'. */
export function playUrl(base, pos, questId, preset) {
  const f = (v) => (Math.round(v * 100) / 100).toString();
  return `${base}?at=${f(pos.x)},${f(pos.y)},${f(pos.z)},0,0&qstate=${encodeURIComponent(questId + ':' + preset)}`;
}
