// QUEST-CHAIN-Q-01: tower.blade ends READY ('?' over Burl) in either order (note first / sword first), and the area-only
// zone towerDoor is fed live (saveRelay.stepGame -> questRelay.pollAreas); facts true before accept still count.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSaveRelay } from '../saveRelay.js';
const rd = (p) => JSON.parse(readFileSync(new URL('../../../' + p, import.meta.url)));
const defs = () => ({ m1: rd('content/quests/m1.quest.json'), blade: rd('content/quests/tower.blade.quest.json'), burl: rd('content/quests/burl.boars.quest.json') });
const mkWorld = () => ({ structures: [], state: {}, triggers: [
  { key: 'world.towerDoor', shape: 'circle', x: 1488, y: 1031, r: 3, zMin: -Infinity },
  { key: 'world.roadWest', shape: 'circle', x: 1340, y: 1048, r: 10, zMin: -Infinity }] });
function run(noteFirst) {
  const d = defs(), r = createSaveRelay({ storage: null, questDef: d.m1, giverDefs: [d.blade, d.burl], enabled: false });
  const w = mkWorld(), b = r.quest.book, o = { wakeDone: true, canSave: false };
  const step = (x, y, z) => r.stepGame(1 / 60, w, { x, y, z }, o);
  const read = () => { w.state['notes.keepLight.read'] = true; b.actKey('q.tower.blade.accept'); };
  assert.equal(b.statusOf('tower.blade'), 1, 'available at start');
  if (noteFirst) read();
  step(1486, 1024, 6);                                   // breach spot would need the marker; area fed by hand below
  r.quest.feed({ type: 'area:entered', id: 'breach' });
  w.state['tower.sword.taken'] = true; step(1497, 1027, 0.5);
  assert.ok(b.statusOf('tower.blade') !== 3, 'not ready before the door');
  step(1488.5, 1031, 0); // inside towerDoor
  if (!noteFirst) { assert.equal(b.statusOf('tower.blade'), 1, 'still available (note unread)'); read(); }
  assert.equal(b.statusOf('tower.blade'), 3, 'READY');
  const a = [], rd2 = []; b.giverMarks(a, rd2);
  assert.deepEqual(a, []); assert.deepEqual(rd2, ['bear'], "'?' over Burl");
}
run(true); run(false);
console.log('bladeChain OK');
