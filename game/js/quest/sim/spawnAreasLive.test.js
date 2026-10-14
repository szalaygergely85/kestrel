// ED-AI-05b: director.replaceAreas (diff by area id, off-screen-first despawn, determinism, no save leak) + receiver messages.
import assert from 'node:assert/strict';
import { createSpawnDirector, buildGroups, DESPAWN_GRACE_STEPS } from './spawnDirector.js';
import { create } from '../aiPatchRecv.js';

const A = (id, x, o = {}) => ({ id, shape: 'disc', x, y: 0, r: 10, kind: 'boar', count: 2, respawnSec: 60, when: 'both', ...o });
const mem = [{ id: 'b1', kind: 'boar', key: 'r', group: 0, x: 500, y: 500, slot: 0 }];
function mk(areas, extra = {}) {
  const parked = [];
  const groups = buildGroups(mem, 7, null, areas);
  const dir = createSpawnDirector({ groups, dayLenSec: 1200, viewHalfRad: 0.5, seed: 7, firstSlot: 1, onDespawn: (g, k) => parked.push(g.region + ':' + k), onRespawn: () => {}, ...extra });
  dir.bind({ count: 20, slotOf: () => -1 });
  return { dir, parked };
}
const run = (dir, n, px = 0, py = 0, fx = 1, fy = 0) => { for (let i = 0; i < n; i++) dir.step(1 / 60, px, py, fx, fy); };

// add / change / remove diff
{
  const { dir, parked } = mk([A('a', 100), A('b', 200)]);
  const gA = dir.groups.find((g) => g.area === 'a'), idA = dir.idx[gA.gid];
  dir.memberDied(idA); // state of an unchanged area survives
  const r = dir.replaceAreas([A('a', 100), A('b', 250), A('c', 300)]);
  assert.deepEqual(r, { added: 1, changed: 1, removed: 0, kept: 1 });
  assert.strictEqual(dir.groups.find((g) => g.area === 'a'), gA, 'unchanged group object untouched');
  assert.equal(dir.alive[dir.idx[gA.gid]], 1);
  assert.ok(parked.some((p) => p.startsWith('b:')), 'changed area members despawn (viewer at origin, b at x=200 is off the 0.5 rad cone? either way grace queue)');
  const rr = dir.replaceAreas([A('a', 100)]); assert.equal(rr.removed, 2); assert.equal(dir.groups.filter((g) => g.area).length, 1);
  assert.deepEqual(dir.replaceAreas([A('a', 100)]), { added: 0, changed: 0, removed: 0, kept: 1 }, 'no change -> no-op');
}
// added area spawns on a later tick via onRespawn; off-screen-first then forced despawn
{
  const spawned = []; const { dir, parked } = mk([A('a', 100)], { onRespawn: (gi, g) => spawned.push(g.region) });
  px: { dir.step(1 / 60, 0, 0, 1, 0); }
  dir.replaceAreas([A('a', 100), A('n', 400)]);
  assert.ok(parked.length >= 2, 'new area parked at once');
  run(dir, 31, 0, 0, -1, 0); // looking away from x=400 -> spawns
  assert.deepEqual(spawned, ['n']);
  // member in view: waits, then despawns when the grace is over
  const m = mk([A('v', 100)]); m.dir.step(0.01, 0, 0, 1, 0);
  m.dir.replaceAreas([]);
  assert.equal(m.parked.length, 0, 'in view -> queued, not despawned');
  run(m.dir, 30, 0, 0, -1, 0); assert.equal(m.parked.length, 2, 'looks away -> despawn');
  const w = mk([A('v', 100)]); w.dir.step(0.01, 0, 0, 1, 0); w.dir.replaceAreas([]);
  run(w.dir, DESPAWN_GRACE_STEPS + 31, 0, 0, 1, 0); assert.equal(w.parked.length, 2, 'grace over -> at once');
}
// determinism + no save leak
{
  const a = mk([A('a', 100)]), b = mk([A('a', 100)]);
  const L = [A('a', 100), A('z', 50), A('m', 60)];
  a.dir.replaceAreas(L); b.dir.replaceAreas([...L].reverse());
  assert.deepEqual(a.dir.groups.map((g) => [g.gid, g.slots]), b.dir.groups.map((g) => [g.gid, g.slots]));
  const st = {}; a.dir.memberDied(a.dir.idx[a.dir.groups.find((g) => g.area === 'a').gid]); a.dir.memberDied(a.dir.idx[a.dir.groups.find((g) => g.area === 'a').gid]);
  assert.equal(a.dir.dead[a.dir.idx[a.dir.groups.find((g) => g.area === 'a').gid]], 1);
  a.dir.save(st); assert.deepEqual(st['spawnDirector.v1'], {}, 'area state never in a save');
}
// receiver
{
  const ch = { sent: [], postMessage(m) { this.sent.push(m); }, onmessage: null };
  let got = null; const dir = { replaceAreas: (a) => { got = a; return { added: 1, changed: 0, removed: 0, kept: 0 }; } };
  create(() => ch, () => null, () => dir);
  ch.onmessage({ data: { type: 'ai-ping' } }); assert.deepEqual(ch.sent[0], { type: 'ai-pong' });
  ch.onmessage({ data: { type: 'ai-areas', areas: [A('a', 1)] } }); assert.equal(got.length, 1); assert.equal(ch.sent[1].ok, true); assert.equal(ch.sent[1].added, 1);
  const ch2 = { sent: [], postMessage(m) { this.sent.push(m); }, onmessage: null }; create(() => ch2, () => null, () => null);
  ch2.onmessage({ data: { type: 'ai-areas', areas: [] } }); assert.equal(ch2.sent[0].ok, false);
}
console.log('spawnAreasLive OK');
