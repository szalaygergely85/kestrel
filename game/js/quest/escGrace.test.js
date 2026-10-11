// OB-049: escGrace helper + dialogue Esc (closes dialogue, pause grace up, second Esc ends it).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileDialogue } from '../../../engine/index.js';
import { createDialogueCtl } from './dialogueCtl.js';
import { createEscGrace } from './escGrace.js';

const keys = new Set();
const input = { pressed: (c) => keys.has(c) };
// helper alone
let g = createEscGrace();
assert.equal(g.lockLost(true, true), false); assert.equal(g.lockLost(false, true), true); assert.equal(g.active, true);
keys.clear(); g.tick(true, input); assert.equal(g.active, true, 'no Esc yet');
keys.add('Escape'); g.tick(true, input); assert.equal(g.active, false, '2nd Esc ends grace'); keys.clear();
g = createEscGrace(); g.lockLost(true, false); assert.equal(g.lockLost(false, false), false, 'lock lost with nothing open: no grace'); assert.equal(g.active, false);
g = createEscGrace(); g.lockLost(true, true); g.lockLost(false, true); g.lockLost(true, false); assert.equal(g.active, false, 're-lock clears');
assert.equal(createEscGrace().lockLost(undefined, true), false);

// dialogue Esc
const def = JSON.parse(readFileSync(new URL('./sim/fixtures/bear.legacy.dialogue.json', import.meta.url), 'utf8'));
const comp = { model: 'bear', anim: 'idle', playing: true, loop: true };
const ent = { transform: { x: 1, y: 2, z: 0 }, components: { voxel: comp, dialogue: 'bear' } };
const handle = { data: ent, play() { return this; } };
const world = { state: {}, get: (id) => (id === 'bear' ? handle : null), addInteractable: (s) => s };
const ctl = createDialogueCtl({ world, dialogues: { bear: compileDialogue(def) }, events: { on: () => () => {} } });
assert.ok(ctl.openFor('bear'), 'opens');
ctl.step(1 / 60, input, true);
assert.equal(ctl.open, true);
ctl.step(1 / 60, input, false); // Esc under lock: Chrome releases the lock
assert.equal(ctl.open, false, 'dialogue closed');
assert.equal(ctl.escGrace.active, true, 'pause stays down on that press');
keys.add('Escape'); ctl.step(1 / 60, input, false); keys.clear();
assert.equal(ctl.escGrace.active, false, '2nd Esc: pause may open');
// key path with lock held: Esc keydown closes, no grace
ctl.step(1 / 60, input, true); assert.ok(ctl.openFor('bear'));
keys.add('Escape'); ctl.step(1 / 60, input, true); keys.clear();
assert.equal(ctl.open, false); assert.equal(ctl.escGrace.active, false);
console.log('escGrace OK');
