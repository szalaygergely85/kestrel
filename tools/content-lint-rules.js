// ED-QUEST-BROWSER: the pure content-lint rules (no node imports) so the editor page can import them over HTTP
// (python's http.server serves .mjs as text/plain, which browsers refuse). tools/content-lint.mjs re-exports this file.

import { validateLogic } from '../engine/index.js';
export const MAX_FLOAT = 0.25, GIVER_MAX_UP = 2.5, GIVER_WALK_R = 3, ENT_MAX_FLOAT = 0.15, BURY_MIN = 0.1, BURY_MAX = 0.9, OBJECT_GIVER_MAX = 0.1, SMOKE_SRC_R = 3, CHIMNEY_R = 6, CHIMNEY_MIN = 3, CHEST_R = 25;
export const LEVELS = { R1: 'error', R2: 'error', R3: 'error', R4: 'error', R5: 'error', R6: 'error', R7: 'error', R8: 'warn', R9: 'warn', R10: 'warn', R11: 'error', R12: 'error', R13: 'error', R14: 'error', R15: 'error', R16: 'warn' };
export const TITLES = {
  R1: 'floating placed prop/tree', R2: 'components.sprite in the world', R3: 'raw id in player text', R4: '"relay" in player text',
  R5: 'giver unreachable', R6: 'smoke without a source', R7: 'chimney outside a building', R8: 'chest with no guard/puzzle/giver nearby',
  R9: 'early quest objective across the river', R10: 'quest given/returned by an object', R11: 'banned mesh placed',
  R12: 'entity not supported by ground/structure (floating or buried)', R13: 'prompt/marker anchor has no visible model', R14: 'quest flow (OB-156): character giver, Accept/Exit, character return',
  R15: 'logic blocks (ED-LOGIC-01d): refs exist, group spawned by one block, no flag loop',
  R16: 'player-facing name looks like an id / placeholder / bare tier tag (OB-135 plain names)',
};
const f1 = (n) => (typeof n === 'number' ? +n.toFixed(1) : n);
const F = (rule, id, x, y, msg) => ({ rule, level: LEVELS[rule], id, x: f1(x), y: f1(y), msg });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---- raw-id detector (R3) ----
export const RAW_DOTTED = /\b[a-z]{2,}(?:\.[a-zA-Z][a-zA-Z0-9]+)+\b/, RAW_CAMEL = /\b[a-z]{2,}[A-Z][a-zA-Z]+\b/;
export const rawIn = (s) => (typeof s === 'string' && s.includes(' ') ? (s.match(RAW_DOTTED) || s.match(RAW_CAMEL) || [null])[0] : null);
const WALL_MOUNTED = /(^|\.)(lantern|keeperLamp|stairLamp|swordLamp)$|^(tower.)?note/i; // wall-mounted on purpose (audit OB-155c)
// R12 owner-verified / coarse-AABB exceptions (id -> reason); the lint samples slab AABB tops and misses these supports
// hung/mounted on purpose (not floor cases); the rule cannot see a floor for them
const R12_OK = new Map([['towerCrown', 'ring hung on the 10-14 m tower walls, no floor'], ['tower.ropeTether', 'rope tied to the hem of a hanging cloth, no floor'], ['relayBend', 'waystone foot seated 0.22 m into its RockPath base slab on purpose (owner-verified); seated vs buried is not decidable from geometry'], ['relayFord', 'same: waystone foot seated into the ford base slab'], ['seaMonster', 'swims at the sea surface, not ground-supported (water, not a floor case)']]);
const R8_OK = new Set(['chestBed']); // lake-bed chest: guarded by the dive itself (SWIM-04d, onBottom)
const NAMES = new Set(['bear', 'rook', 'hesk', 'dorrin']); // main.js giverName table


// ---- plain-name detector (R16) ----
export function badName(s) {
  if (typeof s !== 'string') return null;
  if (/(^|[^A-Za-z0-9])(sq|mq)./i.test(s)) return 'raw quest id';
  if (/_/.test(s)) return 'underscore (raw id)';
  if (/(^|[^A-Za-z0-9])[a-z]{2,}[A-Z][a-zA-Z]*($|[^A-Za-z0-9])/.test(s)) return 'camelCase (raw id)';
  if (/placeholder|todo/i.test(s)) return 'placeholder / TODO';
  if (/(^|[^A-Za-z0-9])T[1-9](?![A-Za-z0-9])/.test(s)) return 'bare tier tag';
  return null;
}

// ---- per-item rule bodies, shared by RULES and tools/editor/quest/lintQuest.js (ED-QUEST-05) ----
/** R5 for one giver/turn-in entity id. */
export function r5One(c, id) {
  const p = c.pos(id); if (!p) return [];
  const up = p.z - c.groundAt(p.x, p.y);
  if (up > GIVER_MAX_UP) return [F('R5', id, p.x, p.y, `giver is ${up.toFixed(1)} m above the ground (> ${GIVER_MAX_UP})`)];
  if (!c.walkable(p.x, p.y, p.z)) return [F('R5', id, p.x, p.y, `no walkable point within ${GIVER_WALK_R} m`)];
  return [];
}
/** R10 for one quest. */
export function r10Quest(c, q) {
  const out = [];
  for (const [role, id] of [['giver', q.giver?.npc], ['turn-in', q.giver?.turnIn]]) {
    if (id && !c.characters.has(id) && !(role === 'giver' && q.objectGiver)) { const p = c.pos?.(id); out.push(F('R10', q.id, p?.x ?? '-', p?.y ?? '-', `${role} "${id}" is an object, not a character`)); }
  }
  return out;
}
/**
 * Highest triangle surface of a placed mesh at world (x,y) with z <= maxZ, or null. Exact (not the coarse AABB top): stairs give the step under the entity.
 * tri = mesh.pos (static soup, 9 floats/tri, or indexed by mesh.idx); s = structure {origin,scale,yawDeg}.
 */
export function meshTopAt(mesh, s, x, y, maxZ) {
  const p = mesh.pos, idx = mesh.idx, sc = s.scale || 1, a = ((s.yawDeg || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), o = s.origin;
  const n = idx ? idx.length : p.length / 3, v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let best = null;
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = (idx ? idx[t + k] : t + k) * 3, lx = p[i] * sc, ly = p[i + 1] * sc;
      v[k * 3] = c * lx - sn * ly + o.x; v[k * 3 + 1] = sn * lx + c * ly + o.y; v[k * 3 + 2] = p[i + 2] * sc + o.z;
    }
    const d = (v[4] - v[7]) * (v[0] - v[6]) + (v[6] - v[3]) * (v[1] - v[7]);
    if (Math.abs(d) < 1e-9) continue; // vertical wall: no top surface
    const l1 = ((v[4] - v[7]) * (x - v[6]) + (v[6] - v[3]) * (y - v[7])) / d, l2 = ((v[7] - v[1]) * (x - v[6]) + (v[0] - v[6]) * (y - v[7])) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const z = l1 * v[2] + l2 * v[5] + l3 * v[8];
    if (z <= maxZ && (best === null || z > best)) best = z;
  }
  return best;
}
/** R12 for one entSupport record (wall-mounted lamps/notes allow-listed). */
export function r12One(e) {
  if (WALL_MOUNTED.test(e.id) || R12_OK.has(e.id)) return [];
  const gap = e.base - e.support, out = [];
  if (gap > ENT_MAX_FLOAT) out.push(F('R12', e.id, e.x, e.y, `base floats ${gap.toFixed(2)} m above its support (> ${ENT_MAX_FLOAT})`));
  if (e.floorAbove != null && e.floorAbove >= BURY_MIN && e.floorAbove <= BURY_MAX) out.push(F('R12', e.id, e.x, e.y, `buried: a floor surface lies ${e.floorAbove.toFixed(2)} m above its base`));
  return out;
}
/** R14 for one quest (opts.skipChar: the "is not a character" line is left to R10). */
export function r14Quest(c, q, opts = {}) {
  const out = [], g = q.giver?.npc, r = q.giver?.turnIn || g;
  if (!g) return [F('R14', q.id, '-', '-', 'quest has no giver: needs a character giver with Accept/Exit')];
  for (const [role, id] of [['giver', g], ['return', r]]) {
    const isChar = c.characters.has(id);
    if (!opts.skipChar && !isChar && !(q.objectGiver && role === 'giver')) out.push(F('R14', q.id, '-', '-', `${role} "${id}" is not a character (set objectGiver: true to allow)`));
    if (!c.pos?.(id)) {
      if (role === 'giver' && q.objectGiver && c.levelIds?.has(id)) continue; // level prop (tower), placed in its own level file
      out.push(F('R14', q.id, '-', '-', `${role} "${id}" does not resolve to a placed entity`));
    }
    // walkable ground / height: R5 checks every giver + turn-in entity (buildContext adds them to giverIds)
  }
  if (!q.accept) out.push(F('R14', q.id, '-', '-', 'no Accept/Exit choice at the giver'));
  if (q.auto) out.push(F('R14', q.id, '-', '-', 'auto hand-in: needs a `?` at the return character'));
  return out;
}

// ---- rules ----
export const RULES = {
  // R1 [OB-131/143] ctx.floating = [{id, kind:'prop'|'tree'|'scatter', x, y, gap}]
  R1: (c) => (c.floating || []).filter((p) => p.gap > MAX_FLOAT).map((p) => F('R1', p.id, p.x, p.y, `${p.kind} floats ${p.gap} m above the ground (> ${MAX_FLOAT})`)),
  // R2 [OB-132] ctx.entities = [{id, x, y, z, components}]; ctx.fxModels = Set of model ids with fx:true (fire/glow/spark/smoke billboards, D-104) are allowed
  R2: (c) => c.entities.filter((e) => e.components?.sprite && !(c.fxModels && c.fxModels.has(e.components.sprite.model))).map((e) => F('R2', e.id, e.x, e.y, 'has components.sprite (' + (e.components.sprite.model || '?') + '): use a voxel model')),
  // R3 [OB-137] ctx.texts = [{where, text}], ctx.quests, ctx.itemDefs, ctx.labelOf
  R3: (c) => {
    const out = [];
    for (const t of c.texts) { if (t.dev) continue; const m = rawIn(t.text); if (m) out.push(F('R3', t.where, '-', '-', `raw id "${m}" in "${t.text.slice(0, 60)}"`)); }
    for (const q of c.quests) {
      const g = q.giver?.npc;
      if (g && !NAMES.has(g) && /[A-Z_.]/.test(g) && c.labelOf(g) === String(g).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase())
        out.push(F('R3', q.id, '-', '-', `journal "Given by" shows the raw id "${g}" (no display name)`));
      for (const it of q.reward?.items || []) {
        const d = c.itemDefs?.[it.id];
        if (!d || !d.name || d.placeholderName) out.push(F('R3', q.id, '-', '-', `journal reward shows the raw id "${it.id}" (item has no display name)`));
      }
    }
    return out;
  },
  // R4 [D-080] ctx.texts + ctx.jsTexts
  R4: (c) => [...c.texts, ...(c.jsTexts || [])].filter((t) => /relay/i.test(t.text)).map((t) => F('R4', t.where, '-', '-', `"relay" in "${t.text.slice(0, 60)}"`)),
  // R5 [OB-147/D-082] ctx.giverIds = Set of ids, ctx.pos(id)->{x,y,z}|null, ctx.groundAt, ctx.walkable(x,y,z)
  R5: (c) => [...c.giverIds].flatMap((id) => r5One(c, id)),
  // R6 [OB-148] smoke emitter needs a fire/chimney/brazier source (entity id/model/light or structure mesh) within 3 m
  R6: (c) => {
    const SRC = /fire|chimney|brazier|campfire|torch|hearth|forge|kiln|stove/i, out = [];
    const srcOf = (e) => SRC.test(e.id) || SRC.test(e.components?.voxel?.model || '') || SRC.test(e.components?.light?.preset || '');
    for (const e of c.entities) {
      if (!(e.components?.emitters || []).some((m) => /smoke/i.test(m.preset || ''))) continue;
      const hit = c.entities.some((o) => o !== e && srcOf(o) && dist(o, e) <= SMOKE_SRC_R) || (c.structures || []).some((s) => SRC.test(s.mesh || '') && dist(s.origin, e) <= SMOKE_SRC_R);
      if (!hit) out.push(F('R6', e.id, e.x, e.y, `smoke emitter with no fire/chimney/brazier within ${SMOKE_SRC_R} m`));
    }
    return out;
  },
  // R7 [OB-129] chimney needs >= 3 building pieces within 6 m
  R7: (c) => {
    const all = c.structures || [], out = [];
    for (const ch of all.filter((s) => /Prop_Chimney/.test(s.mesh))) {
      const n = all.filter((s) => s !== ch && /\/(Wall_|Floor_|Roof_|Corner_|Door|Window)/.test(s.mesh) && dist(s.origin, ch.origin) <= CHIMNEY_R).length;
      if (n < CHIMNEY_MIN) out.push(F('R7', ch.id, ch.origin.x, ch.origin.y, `chimney with only ${n} building pieces within ${CHIMNEY_R} m (< ${CHIMNEY_MIN})`));
    }
    return out;
  },
  // R8 [OB-152] ctx.chests = [{id,x,y}], ctx.guards = [{x,y,kind}] (beast homes, camps, puzzles, givers)
  R8: (c) => c.chests.filter((ch) => !R8_OK.has(ch.id) && !c.guards.some((g) => dist(g, ch) < CHEST_R)).map((ch) => F('R8', ch.id, ch.x, ch.y, `no enemy/camp/puzzle/giver within ${CHEST_R} m (open-field chest)`)),
  // R9 [OB-136] ctx.quests with .targets=[{id,x,y}], .early (opens before the level-5 flag), ctx.riverX(y) + half width
  R9: (c) => {
    const out = [];
    for (const q of c.quests) if (q.early) for (const t of q.targets || []) {
      if (t.x < c.riverX(t.y) - (c.riverHalf ?? 10)) out.push(F('R9', q.id, t.x, t.y, `early quest target "${t.id}" is west of the river (x < ${f1(c.riverX(t.y))})`));
    }
    return out;
  },
  // R10 [D-082] quests given/returned by an object (no dialogue)
  R10: (c) => c.quests.flatMap((q) => r10Quest(c, q)),
  // R11 [OB-130/143]
  R11: (c) => (c.structures || []).filter((s) => /Mushroom_Laetiporus/.test(s.mesh) || (/Prop_Support/.test(s.mesh) && !/^strand/.test(s.id)))
    .map((s) => F('R11', s.id, s.origin.x, s.origin.y, `banned mesh ${s.mesh}`)),
  // R12 [OB-155a-c] ctx.entSupport = [{id,x,y,base,support,floorAbove}]: base = z + model bottom x scale, support = max(ground, structure top)
  // floorAbove = height of a floor surface above base within 0.1..0.9 m (buried) or null. Wall-mounted lamps/notes are allow-listed.
  R12: (c) => (c.entSupport || []).flatMap(r12One),
  // R13 [OB-155d] ctx.anchors = [{id,x,y,hasModel,nearVisual}]: a prompt/marker anchor needs a model or a visible mesh/voxel within 1 m
  R13: (c) => (c.anchors || []).filter((a) => !a.hasModel && !a.nearVisual).map((a) => F('R13', a.id, a.x, a.y, 'prompt/marker anchor with no model and no visible mesh/voxel within 1 m')),
  // R14 [OB-156/OB-155r, D-082, D-087, QPIPE-LINT-01] ctx.quests (packs + legacy) with .giver {npc, turnIn}, .accept (Accept/Exit dialogue exists),
  // .auto (handed in without a line), .objectGiver; ctx.characters, ctx.pos, ctx.groundAt, ctx.walkable
  R15: (c) => r15(c),
  // R16 [OB-135, NAME-LINT] ctx.names = [{where, kind, name}]: resolved display names (item, quest, NPC, region, prop); warn level until the writer has cleaned the real list
  R16: (c) => (c.names || []).flatMap((n) => { const why = badName(n.name); return why ? [F('R16', n.where, '-', '-', `${n.kind} name "${n.name}": ${why}`)] : []; }),
  R14: (c) => {
    const out = [];
    let givers = 0, objGivers = 0;
    for (const q of c.quests) {
      if (q.umbrella) continue; // spine umbrella (sections of silent sub-quests, no giver of its own)
      if (q.giver?.npc) givers++;
      if (q.giver?.npc && q.objectGiver) objGivers++;
      out.push(...r14Quest(c, q));
    }
    if (givers && objGivers / givers > OBJECT_GIVER_MAX) out.push(F('R14', '*', '-', '-', `${objGivers}/${givers} givers are objects (> ${OBJECT_GIVER_MAX * 100} %)`));
    return out;
  },
};

// R15 [ED-LOGIC-01d, arch 38.70] ctx.logic = { blocks: [{...block, file}], vocab, refs: {area,quest,prop,group,item: Set}, propStates: {propId: Set(states)} }
const unlimited = (b) => !b.once && !(b.max > 0);
export function r15(c) {
  const L = c.logic; if (!L || !L.blocks.length) return [];
  const out = [], at = (b) => b.id;
  for (const msg of validateLogic(L.blocks.map(({ file, ...b }) => b), L.vocab, L.refs)) out.push(F('R15', msg.split(/[ :]/)[0] || '*', '-', '-', msg));
  const by = new Map(L.blocks.map((b) => [b.id, b]));
  for (const b of L.blocks) for (const a of b.do || []) {
    if (a.act === 'prop.state' && L.propStates && L.propStates[a.prop] && !L.propStates[a.prop].has(a.state)) out.push(F('R15', at(b), '-', '-', `prop "${a.prop}" has no state "${a.state}"`));
  }
  const spawners = {}; // group -> blocks that spawn it
  for (const b of L.blocks) for (const a of b.do || []) if (a.act === 'beasts.spawn') (spawners[a.group] ||= new Set()).add(b);
  for (const [g, set] of Object.entries(spawners)) if (set.size > 1 && [...set].some(unlimited)) out.push(F('R15', [...set].map(at).join('+'), '-', '-', `group "${g}" is spawned by ${set.size} blocks without once/max`));
  // flag loops: block A sets flag F, block B reacts to flag.set F ... back to A, all without once/max
  const next = (b) => L.blocks.filter((o) => o.when && o.when.on === 'flag.set' && (b.do || []).some((a) => a.act === 'flag.set' && a.flag === o.when.flag));
  const state = new Map();
  const dfs = (b, path) => {
    if (!unlimited(b)) return;
    if (state.get(b.id) === 1) { out.push(F('R15', b.id, '-', '-', `flag loop: ${[...path.slice(path.indexOf(b.id)), b.id].join(' -> ')} (add once/max)`)); return; }
    if (state.get(b.id) === 2) return;
    state.set(b.id, 1); for (const n of next(b)) dfs(n, [...path, b.id]); state.set(b.id, 2);
  };
  for (const b of L.blocks) dfs(b, []);
  return out;
}

/** Runs the rules (all, or opts.only = ['R1',..]); returns findings sorted by rule order. */
export function lint(ctx, opts = {}) {
  const out = [];
  for (const [r, fn] of Object.entries(RULES)) if (!opts.only || opts.only.includes(r)) out.push(...fn(ctx));
  return out;
}
export const line = (f) => `${f.rule} ${f.id} (${f.x},${f.y}): ${f.msg}${f.level === 'warn' ? ' [warn]' : ''}`;
