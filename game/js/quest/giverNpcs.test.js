// QFIX-S5a-4 + S5c (D-098, OB-155): every quest giver / turn-in is a placed character; Tobin is hidden until mq.smoke is done.
// Run: node game/js/quest/giverNpcs.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installGiverNpcs, GIVER_NAMES } from './giverNpcs.js';
import { giverOf, turnInOf, setPlacedNpcs, setHiddenNpcs } from './sim/giverResolve.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const w = JSON.parse(fs.readFileSync(root + 'content/worlds/world_m1.world.json', 'utf8'));
const ents = new Map(w.entities.map(e => [e.id, e]));
const assets = await loadDesignAssets(), dir = root + 'content/quests';
const defs = [...loadQuestFiles(dir).quests, ...(await loadPackQuests(dir, assets.items?.defs)).quests].map(q => q.def).filter(d => d.id !== 'm1' && d.giver);
assert.ok(!defs.some(d => d.pendingNpc), 'no pendingNpc left');
for (const id of Object.keys(GIVER_NAMES)) {
  const e = ents.get(id); assert.ok(e && e.type === 'npc', id + ' placed as npc'); assert.equal(e.components.dialogue, id.toLowerCase());
  assert.ok(fs.existsSync(root + 'content/dialogue/' + id.toLowerCase() + '.dialogue.json'), id + ' dialogue file');
}
// fake world: entities with voxel + state
const mk = () => ({ state: {}, renderVersion: 0, get: (id) => (ents2.has(id) ? { data: ents2.get(id) } : null) });
const ents2 = new Map(Object.keys(GIVER_NAMES).map(id => [id, { components: { voxel: { hidden: false } } }]));
const world = mk(), talked = [], ctl = { addNpc: (id) => talked.push(id) };
const g = installGiverNpcs({ world, ctl });
const tobinGated = defs.filter(d => d.giverNpc === 'postKeeper' || d.turnInNpc === 'postKeeper');
assert.ok(tobinGated.length >= 13);
assert.equal(ents2.get('postKeeper').components.voxel.hidden, true, 'Tobin hidden before mq.smoke');
assert.ok(!talked.includes('postKeeper') && talked.length === 10, 'no talk prompt for Tobin yet');
for (const d of tobinGated) if (!d.objectGiver) assert.equal(giverOf(d), d.giver.npc, d.id + ' keeps the old giver while Tobin is away');
world.state['mq.smoke.done'] = true; g.refresh();
assert.equal(ents2.get('postKeeper').components.voxel.hidden, false, 'Tobin present after mq.smoke');
assert.ok(talked.includes('postKeeper'));
// every quest now resolves to a placed character (or its object, for the 6 object givers)
let n = 0;
for (const d of defs) {
  if (!d.giverNpc || d.storyStart) continue; // story start (tower.blade) has no giver character
  const gi = giverOf(d), ti = turnInOf(d), isChar = (id) => ents.get(id)?.type === 'npc' || ['bear', 'rook'].includes(id);
  assert.ok(d.objectGiver ? ents.has(gi) : isChar(gi), d.id + ' giver ' + gi);
  assert.ok(isChar(ti), d.id + ' turnIn ' + ti);
  n++;
}
setPlacedNpcs(null); setHiddenNpcs(null);
console.log(`giverNpcs OK: ${n} quests resolve, ${Object.keys(GIVER_NAMES).length} givers placed, Tobin gated`);
