// ED-AI-05 / ED-AI-06 editor part: area painting tool (fake ground probe), validation marks, undo exactness, drop message.
import assert from 'node:assert/strict';
import { loadSpawnAreas, makeStack, spawnAreasText } from './ai/model.js';
import { createAreaTool, areaOutline, areaCentre, REFUSE_TEXT, DROP_MSG } from './aiAreaTool.js';

const files = { 'spawnAreas.json': '{\n  "areas": []\n}\n' };
const fs = { readFileSync: (p) => files[p.split('/').pop()], writeFileSync: (p, t) => { files[p.split('/').pop()] = t; } };
const kinds = { boar: { name: 'Boar' }, wolf: { name: 'Wolf' } };
const probe = (x, y) => (x > 500 ? { z: 0, walkable: false } : { z: 1, walkable: true }); // x > 500 = water / roof
const sent = [];
let changes = 0, reloads = 0;
const model = loadSpawnAreas('content/beasts', fs);
const t = createAreaTool({ model, kinds, stack: makeStack(), probe, channel: { post: (m) => sent.push(m) }, reload: () => reloads++, onChange: () => changes++, seed: () => 7 });
const base = spawnAreasText(model);

// painting needs "armed"; refused on non-walkable ground with the plain text
assert.equal(t.pointerDown(10, 10), false);
t.arm(true);
assert.equal(t.pointerDown(600, 10), false); assert.equal(t.st.msg, REFUSE_TEXT); assert.equal(model.areas.length, 0);

// disc: press centre, drag sets radius (clamped 6..60), release commits
assert.ok(t.pointerDown(100, 100)); t.pointerMove(130, 100); assert.equal(t.st.draft.r, 30);
t.pointerMove(900, 100); assert.equal(t.st.draft.r, 60); t.pointerMove(101, 100); assert.equal(t.st.draft.r, 6);
t.pointerMove(120, 100); const a = t.pointerUp();
assert.deepEqual([a.id, a.shape, a.x, a.y, a.r, a.kind, a.count, a.when], ['boar-1', 'disc', 100, 100, 20, 'boar', 3, 'both']);
assert.deepEqual(t.invalid(), {});

// polygon: points then finish; < 3 refused
t.st.mode = 'polygon'; t.setBrush('kind', 'wolf'); // selected disc is edited too (kind change) - that is one more undo step
t.select(null);
t.pointerDown(0, 0); t.pointerDown(10, 0); assert.equal(t.finish(), null); assert.match(t.st.msg, /at least 3/);
t.pointerDown(10, 10); const p = t.finish(); assert.equal(p.id, 'wolf-1'); assert.equal(p.pts.length, 3);
assert.deepEqual(areaCentre(p).map((v) => Math.round(v * 10) / 10), [6.7, 3.3]);
assert.ok(areaOutline(p).length >= 3 && areaOutline(a).length === 40);

// invalid area is marked with the validator's plain message; Save still allowed
t.setBrush('count', 99); assert.equal(t.st.brush.count, 12); // clamped
t.setField('wolf-1', 'respawnSec', 5);
const bad = t.invalid(); assert.deepEqual(Object.keys(bad), ['wolf-1']); assert.match(bad['wolf-1'][0], /respawnSec must be between 30 and 7200/);
assert.deepEqual(t.save(fs).written, ['spawnAreas.json']);

// move: refused on bad ground; works on good
t.select('boar-1'); assert.equal(t.moveSel(700, 0), false); assert.equal(t.moveSel(150, 150), true); assert.equal(model.areas[0].x, 150);

// undo/redo restore exact bytes
const after = spawnAreasText(model);
let n = 0; while (t.undo()) n++;
assert.equal(spawnAreasText(model), base); assert.ok(n >= 5);
while (t.redo()) n--; assert.equal(spawnAreasText(model), after);

// remove is undoable
t.remove('boar-1'); assert.equal(model.areas.length, 1); t.undo(); assert.equal(model.areas.length, 2);

// reload to apply
assert.ok(t.st.dirtyLive); t.reloadToApply(); assert.equal(reloads, 1); assert.equal(t.st.dirtyLive, false);

// ED-AI-06: drop pack message
assert.equal(t.dropPack(700, 0, 'wolf', 3), false); assert.equal(sent.filter((m) => m.type === DROP_MSG).length, 0);
assert.deepEqual(t.dropPack(40, 50, 'wolf', 3), { type: DROP_MSG, kind: 'wolf', count: 3, x: 40, y: 50, seed: 7 });
assert.equal(t.dropPack(40, 50, 'wolf', 99).count, 12); assert.equal(sent.filter((m) => m.type === DROP_MSG).length, 2);
t.clearTest(); assert.deepEqual(sent[sent.length - 1], { type: 'ai-clear' });
assert.ok(changes > 10);
console.log('aiAreaTool OK');
// ED-AI-05b: stroke end / Save post 'ai-areas'; Reload-to-apply only when no pong
{
  const sent2 = []; const timers = [];
  const m2 = loadSpawnAreas('content/beasts', fs);
  const t2 = createAreaTool({ model: m2, kinds, stack: makeStack(), probe, channel: { post: (m) => sent2.push(m) }, setTimer: (f) => timers.push(f) });
  t2.arm(true); t2.pointerDown(10, 10); t2.pointerUp(10, 10);
  const am = sent2.filter((m) => m.type === 'ai-areas'); assert.ok(am.length >= 1, 'ai-areas posted at stroke end'); assert.equal(am[am.length - 1].areas.length, m2.areas.length);
  assert.ok(sent2.some((m) => m.type === 'ai-ping')); assert.equal(t2.st.connected, null);
  timers.forEach((f) => f()); assert.equal(t2.st.connected, false, 'no pong -> Reload to apply');
  t2.ping(); t2.onPong(); assert.equal(t2.st.connected, true);
  console.log('areaTool live OK');
}
