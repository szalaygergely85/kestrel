// tools/editor/quest/lintQuest.js - ED-QUEST-05 core. Pure live lint of ONE quest of the
// ED-QUEST-01 model; the rule bodies are content-lint's own (r10Quest, r14Quest, r5One, r12One).
// lintQuest(model, questId, ctx) -> [{rule, severity:'error'|'warn', text, target:{kind,id}}]
//   target.kind: 'giver' | 'return' | 'objective' | 'field' | 'requires' | 'reward' (the panel's "Go to").
// ctx (all optional, a check is skipped when its input is missing):
//   characters:Set<id>, pos(id)->{x,y,z}|null, groundAt(x,y), walkable(x,y,z), support(id)->R12 record|null,
//   labelOf(id)->plain name, itemDefs:{id:{name}}, hasFlag(name)->bool,
//   flowOf(quest)->{accept, exit, markLeft, pickupsKept, earlyReturn} (OB-156 data from dialogue/errand files).
import { resolveGiver } from '../../../game/js/quest/sim/templates.js';
import { r5One, r10Quest, r12One, r14Quest, rawIn } from '../../content-lint.mjs';

const ID_LIKE = /\b(?:sq|mq|heart)\.[A-Za-z][\w.]*/, PLACEHOLDER = /\{[^}]*\}/;

/** Every id an objective stands the player at (area / hand-in target / listed ids). */
function objectiveSpots(o) {
  const w = o.when || {}, ids = [];
  if (w.type === 'area' && w.id) ids.push(w.id);
  if (w.type === 'deliver' && w.to) ids.push(w.to);
  for (const b of w.ids || []) ids.push(b);
  return ids;
}

/** Giver {npc, turnIn?}: legacy `giver`, or a pack row's `site` resolved through ctx.sites exactly like templates.js (unknown site -> none). */
function giverOf(q, ctx) {
  if (q.raw.giver) return q.raw.giver;
  if (q.raw.site === undefined || !ctx.sites) return {};
  const step = (q.raw.steps || []).find((st) => st.template === 'deliver') || (q.raw.template === 'deliver' ? q.raw : null);
  try { return resolveGiver(q.raw, ctx, step ? (step.params || step).to : undefined); } catch { return {}; }
}

export function lintQuest(model, questId, ctx = {}) {
  const q = model.quests.find((x) => x.id === questId);
  if (!q) return [{ rule: 'R0', severity: 'error', text: 'Quest not found', target: { kind: 'field', id: 'id' } }];
  const name = (id) => (ctx.labelOf ? ctx.labelOf(id) : id), out = [];
  const add = (rule, severity, text, kind, id) => out.push({ rule, severity, text, target: { kind, id } });
  const lvl = (f) => (f.level === 'warn' ? 'warn' : 'error');
  const g = giverOf(q, ctx), giver = g.npc || null, ret = g.turnIn || giver;
  const flow = ctx.flowOf ? ctx.flowOf(q) || {} : {};
  const rq = { id: q.id, giver: g, objectGiver: !!q.raw.objectGiver, accept: flow.accept ?? true, auto: !!flow.auto };
  const c = { characters: ctx.characters || new Set(), pos: ctx.pos, groundAt: ctx.groundAt, walkable: ctx.walkable, levelIds: ctx.levelIds };

  // R10 / D-082 / D-087: giver and return are characters, not objects
  if (ctx.characters) {
    for (const f of r10Quest(c, rq)) {
      const isGiver = /^giver/.test(f.msg), id = isGiver ? giver : ret;
      add('R10', lvl(f), `${isGiver ? 'The quest giver' : 'The return spot'} "${name(id)}" is an object, not a character. Pick a character to talk to.`, isGiver ? 'giver' : 'return', id);
    }
  }
  // R14 / OB-156 flow (the "not a character" line is R10's)
  if (!giver) add('R14', 'error', 'This quest has no giver. Pick a character who offers it.', 'giver', null);
  else {
    for (const f of r14Quest(c, rq, { skipChar: true })) {
      if (/does not resolve/.test(f.msg)) { const isGiver = /^giver/.test(f.msg); if (ctx.pos) add('R14', 'error', `${name(isGiver ? giver : ret)} is not placed in the world.`, isGiver ? 'giver' : 'return', isGiver ? giver : ret); }
      else if (/Accept\/Exit/.test(f.msg)) add('R14', 'error', `${name(giver)} has no Accept / Not yet choice for this quest.`, 'giver', giver);
      else if (/auto hand-in/.test(f.msg)) add('R14', 'error', `The quest is handed in without a conversation: ${name(ret)} needs a "?" mark.`, 'return', ret);
    }
    if (flow.exit === false) add('R14', 'error', `${name(giver)}'s offer has no Exit line (a way to say "Not yet").`, 'giver', giver);
    if (flow.markLeft) add('R14', 'error', 'A quest mark stays over a character after the quest was accepted or handed in.', 'giver', giver);
    if (flow.pickupsKept) add('R14', 'error', 'Picked-up quest objects stay in the world after pickup.', 'objective', q.objectives[0]?.id ?? null);
    if (flow.earlyReturn) add('R14', 'error', `The "?" at ${name(ret)} shows before ALL objectives are done.`, 'return', ret);
    for (const o of q.objectives) {
      const w = o.when || {};
      if (w.type === 'deliver' && w.to && ret && w.to !== ret) add('R14', 'warn', `"${o.text || o.id}" hands in to ${name(w.to)}, but the quest returns to ${name(ret)}.`, 'objective', o.id);
    }
  }
  // R5 + R12: giver, return and objective spots stand on reachable ground, not on a roof or floating
  if (ctx.pos && ctx.groundAt && ctx.walkable) {
    const seen = new Set(), spots = [[giver, 'giver', 'giver', null], [ret, 'return', 'return', null], ...q.objectives.flatMap((o) => objectiveSpots(o).map((id) => [id, 'objective', 'stop', o.id]))];
    for (const [id, kind, noun, oid] of spots) {
      if (!id || seen.has(id) || !ctx.pos(id)) continue; seen.add(id);
      const tid = kind === 'objective' ? oid : id, label = noun === 'stop' ? `The stop "${name(id)}"` : `The ${noun} ${name(id)}`;
      for (const f of r5One(c, id)) add('R5', lvl(f), /above the ground/.test(f.msg) ? `${label} stands too high above the ground (on a roof?). Move it to the ground.` : `${label} has no walkable ground nearby. Move it to a reachable spot.`, kind, tid);
      const sup = ctx.support?.(id);
      if (sup) for (const f of r12One(sup)) add('R12', lvl(f), /floats/.test(f.msg) ? `${label} floats above the ground.` : `${label} is buried in a floor.`, kind, tid);
    }
  }
  // no raw id / placeholder / empty text in anything the player reads
  const check = (what, s, kind, id, mustHave) => {
    if (s == null || String(s).trim() === '') { if (mustHave) add('R3', 'error', `${what} is empty.`, kind, id); return; }
    const m = rawIn(s) || (s.match(ID_LIKE) || [null])[0];
    if (m) add('R3', 'error', `${what} shows an internal id ("${m}"). Write a plain name instead.`, kind, id);
    if (PLACEHOLDER.test(s)) add('R3', 'error', `${what} has an unfilled {placeholder}.`, kind, id);
  };
  check('The title', q.title, 'field', 'title', true);
  check('The return text', q.returnText, 'field', 'returnText', false);
  if (Array.isArray(q.lines)) q.lines.forEach((l) => check('A dialogue line', typeof l === 'string' ? l : l?.text, 'field', 'lines', false));
  for (const o of q.objectives) {
    check(`Objective "${o.id}" text`, o.text, 'objective', o.id, true);
    check(`Objective "${o.id}" journal`, o.journal, 'objective', o.id, true);
  }
  // requires: existing quest / flag
  const ids = new Set(model.quests.map((x) => x.id));
  q.requires.forEach((r, i) => {
    if (r.quest && !ids.has(r.quest)) add('R15', 'error', `Needs a quest that does not exist ("${r.quest}").`, 'requires', String(i));
    if (r.flag && ctx.hasFlag && !ctx.hasFlag(r.flag)) add('R15', 'error', `Needs a flag nothing sets ("${r.flag}").`, 'requires', String(i));
    if (r.quest === q.id) add('R15', 'error', 'The quest needs itself.', 'requires', String(i));
  });
  // reward items exist and have a display name
  for (const it of q.reward?.items || []) {
    const d = ctx.itemDefs?.[it.id];
    if (ctx.itemDefs && !d) add('R16', 'error', `Reward item "${it.id}" does not exist.`, 'reward', it.id);
    else if (d && (!d.name || d.placeholderName)) add('R3', 'error', `Reward item "${it.id}" has no display name.`, 'reward', it.id);
  }
  return out;
}
