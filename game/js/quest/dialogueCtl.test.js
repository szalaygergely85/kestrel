// dialogueCtl.test.js (DIALOGUE-01b2): fake world/entity/input, real runner + compiled bear dialogue.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileDialogue } from '../../../engine/index.js';
import { createDialogueCtl } from './dialogueCtl.js';

// CH1-05: the live bear graph was rewritten; the controller test keeps the pre-CH1 shape as a fixture.
const def = JSON.parse(readFileSync(new URL('./sim/fixtures/bear.legacy.dialogue.json', import.meta.url), 'utf8'));
const dialogues = { bear: compileDialogue(def) };

function fake() {
  const plays = [];
  const comp = { model: 'bear', anim: 'idle', playing: true, loop: true };
  const ent = { transform: { x: 1, y: 2, z: 0 }, components: { voxel: comp, dialogue: 'bear' } };
  const handle = { data: ent, play(a, o) { plays.push(a); comp.anim = a; comp.playing = true; return this; } };
  const state = {}, inter = [];
  const world = { state, get: (id) => (id === 'bear' ? handle : null), addInteractable: (s) => { inter.push(s); return s; } };
  const listeners = {};
  const events = { on: (n, f) => { listeners[n] = f; return () => { delete listeners[n]; }; } };
  const flagsOut = [];
  const keys = new Set();
  const input = { pressed: (c) => keys.has(c) };
  const press = (...c) => { keys.clear(); c.forEach((k) => keys.add(k)); };
  return { plays, comp, world, state, inter, events, listeners, flagsOut, input, press, keys };
}
const mk = (f) => createDialogueCtl({ world: f.world, dialogues, events: f.events, onFlag: (k, v) => f.flagsOut.push([k, v]) });
const DT = 1 / 60;
function run(c, f, n) { f.keys.clear(); for (let i = 0; i < n; i++) c.step(DT, f.input, true); }

// open: unknown/no dialogue refuses; known opens, locks, plays talk
{
  const f = fake(), c = mk(f);
  assert.equal(c.openFor('nobody'), false);
  assert.equal(c.open, false); assert.equal(c.locked, false);
  assert.equal(c.openFor('bear'), true);
  assert.ok(c.open && c.locked);
  assert.equal(c.openFor('bear'), false, 'no re-open while open');
  assert.equal(f.plays.at(-1), 'wave', 'first node has clip wave');
}

// advance / choose / flags / close step lock
{
  const f = fake(), c = mk(f);
  c.openFor('bear'); run(c, f, 1);
  f.press('KeyE'); c.step(DT, f.input, true);           // completes the typing line
  assert.equal(c.runner.state, 'waiting');
  f.press('Enter'); c.step(DT, f.input, true);          // next node (YOU line)
  assert.equal(c.runner.speakerKey, 'you');
  assert.equal(f.plays.at(-1), 'listen', 'player line -> NPC listens');
  f.press('KeyE'); c.step(DT, f.input, true); f.press('KeyE'); c.step(DT, f.input, true); // finish + advance
  f.press('KeyE'); c.step(DT, f.input, true);           // finish typing node 3 (burl)
  assert.equal(c.runner.state === 'choosing', true, c.runner.state);
  const before = c.runner.state;
  f.press('KeyS'); c.step(DT, f.input, true);
  assert.equal(c.runner.selected, 1);
  f.press('ArrowUp'); c.step(DT, f.input, true); f.press('KeyW'); c.step(DT, f.input, true);
  assert.equal(c.runner.selected, 2, 'wraps up');
  f.press('Enter'); c.step(DT, f.input, true);          // pick choice 3 -> node c.l1, NOT also advancing it
  assert.equal(c.runner.state, 'typing');
  assert.equal(c.runner.visibleChars, 0, 'pick does not also skip the next line');
  assert.equal(f.plays.at(-1), 'talk');
  // to the end: close node sets bear.talked
  for (let i = 0; i < 12 && c.open; i++) { f.press('KeyE'); c.step(DT, f.input, true); }
  assert.equal(c.open, false);
  assert.equal(f.state['dlg.bear.talked'], true);
  assert.deepEqual(f.flagsOut.at(-1), ['bear.talked', true]);
  assert.ok(c.locked, 'still locked through the closing step');
  assert.equal(f.plays.at(-1), 'idle');
  f.keys.clear(); c.step(DT, f.input, true);
  assert.equal(c.locked, false, 'unlocked the next step');
  assert.equal(before, 'choosing');
}

// Esc closes without setting the unreached flag; lock holds one step; repeat line afterwards
{
  const f = fake(), c = mk(f);
  c.openFor('bear'); f.press('Escape'); c.step(DT, f.input, true);
  assert.equal(c.open, false); assert.ok(c.locked);
  assert.equal(f.state['dlg.bear.talked'], undefined);
  f.keys.clear(); c.step(DT, f.input, true); assert.equal(c.locked, false);
  f.state['dlg.bear.talked'] = true; c.openFor('bear');
  assert.equal(c.runner.line, 'Back again? The berries are still mine. Mostly.');
}

// damage closes; pause overlay (look lost) closes
{
  const f = fake(), c = mk(f);
  c.openFor('bear'); f.listeners['combat:hit']({ target: 'beast' }); assert.ok(c.open, 'only player hits close');
  f.listeners['combat:hit']({ target: 'player' });
  assert.equal(c.open, false); assert.ok(c.locked);
  f.keys.clear(); c.step(DT, f.input, true); assert.equal(c.locked, false);
  c.openFor('bear'); c.step(DT, f.input, false); assert.equal(c.open, false);
}

// clips: talk while typing, listen waiting, node clip once then back
{
  const f = fake(), c = mk(f);
  c.openFor('bear');
  assert.deepEqual(f.plays, ['idle'].slice(0, 0).concat(['wave']));
  f.comp.playing = false; run(c, f, 1);                 // wave finished
  assert.equal(f.plays.at(-1), 'talk');
  const n = f.plays.length; run(c, f, 5); assert.equal(f.plays.length, n, 'no restart every step');
  f.press('KeyE'); c.step(DT, f.input, true);
  assert.equal(f.plays.at(-1), 'listen');
}

// NPC talk prompt registration
{
  const f = fake(), c = mk(f);
  const rec = c.addNpc('bear');
  assert.equal(rec.name, 'npc.talk'); assert.equal(rec.prompt, '[E] Talk'); assert.deepEqual(rec.def, { npcId: 'bear' });
  assert.equal(c.addNpc('ghost'), null);
}

// zero allocation per step
if (global.gc) {
  const f = fake(), c = mk(f); c.openFor('bear'); f.comp.playing = false;
  for (let i = 0; i < 2000; i++) { f.press(i % 90 === 0 ? 'KeyE' : 'None'); c.step(DT, f.input, true); if (!c.open) c.openFor('bear'); }
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) { f.press(i % 90 === 0 ? 'KeyE' : 'None'); c.step(DT, f.input, true); if (!c.open) c.openFor('bear'); }
  global.gc(); assert.ok(process.memoryUsage().heapUsed - h0 < 200000, 'heap growth ' + (process.memoryUsage().heapUsed - h0));
}
console.log('dialogueCtl.test.js ok');

// CH1-06: `s.<key>` route = world.state check / injected questFlag set (not dlg.*, not the book)
{
  const f = fake(), setKeys = [];
  const comp = compileDialogue({ id: 'sx', speakers: { a: { label: 'A' } },
    entry: [{ node: 'n1', requires: 's.waystone.woken' }, { node: 'n0' }],
    nodes: { n0: { speaker: 'a', lines: ['hi'], setFlag: 's.burl.follow', end: true }, n1: { speaker: 'a', lines: ['woken'], end: true } } });
  f.world.get = (id) => (id === 'x' ? { data: { components: { dialogue: 'sx' } }, play() {} } : null);
  const c2 = createDialogueCtl({ world: f.world, dialogues: { sx: comp }, questFlag: (k) => { setKeys.push(k); f.state[k] = true; } });
  c2.openFor('x'); assert.equal(c2.runner.line, 'hi', 'has false -> default entry');
  assert.deepEqual(setKeys, ['burl.follow'], 's. set -> questFlag(rest)'); assert.equal(f.state['dlg.s.burl.follow'], undefined);
  c2.close(); run(c2, f, 1);
  f.state['waystone.woken'] = true;
  c2.openFor('x'); assert.equal(c2.runner.line, 'woken', 's. has reads world.state[rest]');
  assert.equal(f.state['dlg.waystone.woken'], undefined);
}
console.log('dialogueCtl s. route ok');
