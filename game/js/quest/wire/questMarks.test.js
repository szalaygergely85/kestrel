// QUEST-MARK-01w: fake seam + fake entity factory. Marker follows the objective, hides when done, culls at 40 m, stable over save/load.
import assert from 'node:assert/strict';
import { createGameHooks } from '../../gameHooks.js';
import { createQuest, applyQuestEvent } from '../sim/quest.js';
import { createQuestMarkers } from '../sim/questMarkers.js';
import { collectSave, applySave, stringifyGameSave, parseGameSave } from '../save/saveState.js';
import { World, AssetRegistry } from '../../../../engine/index.js';
import '../../../../design/models/quest_mark.js';
import { createQuestMarks, registerQuestMarks } from './questMarks.js';

const fx = globalThis.ASSETS.questMarkFx;
const def = { version: 1, id: 'markFix', objectives: [
  { id: 'note1', text: 'n1', when: { type: 'flag', id: 'note1.read', equals: true } },
  { id: 'sword', text: 'sw', when: { type: 'item', id: 'sword' } },
  { id: 'note2', text: 'n2', when: { type: 'flag', id: 'note2.read', equals: true } },
] };
const markers = createQuestMarkers(def, [{ objectiveId: 'note1', targets: ['n1'] }, { objectiveId: 'note2', targets: ['n2'] }]);
const spots = { n1: { x: 10, y: 0, z: 1 }, n2: { x: 100, y: 0, z: 1 } };

function rig(state0) {
  let state = state0, created = 0; const hooks = createGameHooks();
  hooks.setQuestSource((out) => {
    out.done = state.completed.length >= def.objectives.length;
    out.id = out.done ? '' : def.objectives[state.completed.length].id; out.targets = markers.markerTargets(state);
  });
  const ents = [];
  const host = { fx, resolve: (id, o) => { const s = spots[id]; if (!s) return false; o.x = s.x; o.y = s.y; o.z = s.z; return true; },
    create: () => { created++; const e = { hidden: true, scale: 1, anim: '', x: 0, y: 0, z: 0, setPos(x, y, z) { this.x = x; this.y = y; this.z = z; } }; ents.push(e); return e; } };
  const player = { transform: { x: 0, y: 0, z: 0 } };
  const w = createQuestMarks(hooks, host);
  hooks.register({ onBoot: w.onBoot, onTick: w.onTick });
  hooks.boot(null, player, null, null, null);
  return { hooks, w, ents, player, send: (e) => applyQuestEvent(state, e, def), get state() { return state; }, set state(s) { state = s; }, get created() { return created; } };
}
const run = (r, sec) => { for (let i = 0; i < Math.round(sec * 60); i++) r.hooks.tick(1 / 60); };

// 1. appears for the available take step
const r = rig(createQuest(def));
run(r, 1); assert.equal(r.w.active, 1); assert.equal(r.ents.length, 1); assert.equal(r.ents[0].hidden, false);
assert.equal(r.ents[0].anim, 'idle'); assert.equal(r.ents[0].scale, 1); assert.equal(r.ents[0].x, 10);
// 2. take -> fades immediately, hidden after fadeMs, never reappears
r.send({ type: 'flag:set', key: 'note1.read', value: true });
run(r, 0.1); assert.equal(r.ents[0].anim, 'fade');
run(r, 0.4); assert.equal(r.ents[0].hidden, true); assert.equal(r.w.active, 0);
run(r, 5); assert.equal(r.w.active, 0); assert.equal(r.created, 1);
// 3. follows the objective; culled beyond 40 m, visible when near
r.send({ type: 'item:got', id: 'sword' }); run(r, 1);
assert.equal(r.ents.length, 2); assert.equal(r.ents[1].hidden, true, 'culled beyond 40 m');
r.player.transform.x = 80; run(r, 0.1); assert.equal(r.ents[1].hidden, false);
// 4. quest done -> hidden
r.send({ type: 'flag:set', key: 'note2.read', value: true }); run(r, 1);
assert.equal(r.w.active, 0); assert.equal(r.ents[1].hidden, true); assert.equal(r.hooks.questObjective().done, true);
assert.equal(r.created, 2, 'at most one entity per target');

// 5. save/load: getter stable, no double spawn, taken quest never spawns
const a = rig(createQuest(def)); run(a, 1);
const assets = new AssetRegistry({ palette: {} }), world = World.load({ name: 'm', terrain: null, structures: [], entities: [] }, assets, {});
const bytes = stringifyGameSave(collectSave(world, { quest: a.state, questDef: def }));
const before = JSON.stringify(a.hooks.questObjective());
a.state = applySave(parseGameSave(bytes), assets, { questDef: def }).quest;
a.hooks.boot(null, a.player, null, null, null); run(a, 1);
assert.equal(JSON.stringify(a.hooks.questObjective()), before); assert.equal(a.ents.length, 1); assert.equal(a.w.active, 1);
a.send({ type: 'flag:set', key: 'note1.read', value: true });
const taken = applySave(parseGameSave(stringifyGameSave(collectSave(world, { quest: a.state, questDef: def }))), assets, { questDef: def });
const b = rig(taken.quest); run(b, 1); assert.equal(b.w.active, 0); assert.equal(b.ents.length, 0, 'taken quest never spawns');

// 6. disabled modes register nothing
const h0 = createGameHooks(); registerQuestMarks(h0, { fx, enabled: false }); assert.equal(h0.count, 0);

// 7. zero alloc per tick (steady state)
const z = rig(createQuest(def)); run(z, 1);
if (global.gc) {
  global.gc(); const m0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1e5; i++) z.hooks.tick(1 / 60);
  global.gc(); const d = process.memoryUsage().heapUsed - m0; assert.ok(d < 200000, 'heap growth ' + d);
} else for (let i = 0; i < 1e5; i++) z.hooks.tick(1 / 60);
console.log('questMarks.test OK');
