// OUT-01: table + turn + met flags + save round trip. Run: node game/js/quest/outwall.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NPCS, PENDING, FACE_M, createOutwall } from './outwall.js';

const root = new URL('../../../', import.meta.url);
const w = JSON.parse(readFileSync(new URL('content/worlds/world_m1.world.json', root), 'utf8'));
for (const [id, n] of Object.entries(NPCS)) {
  const e = w.entities.find((x) => x.id === id);
  assert.ok(e && e.components.voxel.model === 'char.kit', id + ' is a char.kit npc in world_m1');
  const dlg = JSON.parse(readFileSync(new URL(`content/dialogue/${n.dialogue}.dialogue.json`, root), 'utf8'));
  for (const t of n.talkIds) assert.ok(dlg.nodes[t], 'talk id exists: ' + t);
  assert.match(n.metFlag, /^ow\.(hesk|dorrin)\.met$/);
}
const mk = (state) => {
  const ents = { hesk: { x: 0, y: 0, yawDeg: 270 }, dorrin: { x: 20, y: 0, yawDeg: 0 } };
  const world = { state, get: (id) => ({ data: { transform: ents[id] } }) };
  const set = []; const ow = createOutwall({ world, questFlag: (k) => { state[k] = true; set.push(k); } });
  return { ow, ents, set };
};
let state = {}; let { ow, ents, set } = mk(state);
for (let i = 0; i < 60; i++) ow.step(1 / 60, 0, 5);           // player 5 m north of Hesk, 20 m from Dorrin
assert.notEqual(ents.hesk.yawDeg, 270, 'Hesk turned toward the player');
assert.equal(ents.dorrin.yawDeg, 0, 'Dorrin out of range stays home');
for (let i = 0; i < 90; i++) ow.step(1 / 60, 0, FACE_M + 3); // player leaves range -> home
assert.ok(Math.abs(ents.hesk.yawDeg - 270) < 1e-6 || Math.abs(Math.abs(ents.hesk.yawDeg) - 90) < 1e-6, 'back to home yaw');
assert.equal(ow.talked('hesk'), true); assert.equal(ow.talked('hesk'), false, 'flag set once');
assert.equal(ow.talked('rook'), false); assert.deepEqual(set, ['ow.hesk.met']);
// save round trip: world.state is what the quest relay persists; JSON round trip, then a fresh controller sees it
state = JSON.parse(JSON.stringify(state)); ({ ow, set } = mk(state));
assert.equal(state['ow.hesk.met'], true); assert.equal(ow.talked('hesk'), false, 'no re-set after load');
assert.equal(ow.talked('dorrin'), true); assert.equal(state['ow.dorrin.met'], true);
ow.paused = true; const y = ents.hesk.yawDeg; ow.step(1, 0, 3); assert.equal(ents.hesk.yawDeg, y, 'paused = routines own the yaw');
// OUT-03: every approved character is either in NPCS or PENDING (never both); PENDING ones have no world entity yet
const APPROVED = ['nub', 'skip', 'stilt', 'slate', 'crag', 'hesk', 'dorrin', 'sorrel', 'pell', 'tam', 'ama', 'cobb'];
for (const id of APPROVED) assert.ok((id in NPCS) !== (id in PENDING), id + ' in exactly one table');
for (const [id, p] of Object.entries(PENDING)) {
  assert.match(p.status, /^(NEEDS DESIGNER|NEEDS REGISTRATION|done elsewhere)$/);
  if (p.status !== 'done elsewhere') assert.ok(!w.entities.some((x) => x.id === id), id + ' has no entity yet');
  if (p.model) assert.ok(readFileSync(new URL('design/models/' + p.model, root), 'utf8').length > 100, p.model + ' exists');
}
console.log('outwall.test OK');
