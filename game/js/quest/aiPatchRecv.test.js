import assert from 'node:assert/strict';
import { create } from './aiPatchRecv.js';
const mk = () => { const c = { sent: [], postMessage(m) { this.sent.push(m); }, onmessage: null, closed: false, close() { this.closed = true; } }; return c; };
let ch = mk(); let sim = { patchArchetype: (id, f) => (f.bad ? { ok: false, errors: ['bad value', { message: 'x' }] } : { ok: true, errors: [] }) };
const r = create(() => ch, () => sim);
assert.ok(r.active);
ch.onmessage({ data: { type: 'ai-patch', name: 'wolf', fields: { a: 1 } } });
assert.deepEqual(ch.sent[0], { type: 'ai-patch-result', name: 'wolf', ok: true, refused: [] });
ch.onmessage({ data: { type: 'ai-patch', name: 'wolf', fields: { bad: 1 } } });
assert.deepEqual(ch.sent[1].refused, ['bad value', 'x']); assert.equal(ch.sent[1].ok, false);
ch.onmessage({ data: { type: 'other' } }); ch.onmessage({ data: null }); assert.equal(ch.sent.length, 2);
sim = null; ch.onmessage({ data: { type: 'ai-patch', name: 'w', fields: {} } }); assert.equal(ch.sent[2].ok, false); // no sim
sim = { patchArchetype: () => { throw new Error('boom'); } }; ch.onmessage({ data: { type: 'ai-patch', name: 'w', fields: {} } });
assert.match(ch.sent[3].refused[0], /boom/);
sim = { patchArchetype: () => ({ ok: true, errors: [] }) }; ch.onmessage({ data: { type: 'ai-patch', name: 'w', fields: {} } }); assert.ok(ch.sent[4].ok); // reload: new sim read
r.close(); assert.ok(ch.closed);
assert.equal(create(null, () => sim).active, false); assert.equal(create(() => null, () => sim).active, false);
assert.equal(create(() => { throw new Error('x'); }, () => sim).active, false);
console.log('aiPatchRecv OK');
// ED-AI-06: drop / clear messages
{
  const ch2 = mk(); const calls = [];
  const sim2 = { groups: {}, count: 0, grid: null };
  create(() => ch2, () => sim2);
  ch2.onmessage({ data: { type: 'ai-drop', kind: 'nokind', count: 3, x: 1, y: 2, seed: 5 } });
  assert.equal(ch2.sent[0].type, 'ai-drop-result'); assert.equal(ch2.sent[0].ok, false); assert.equal(ch2.sent[0].n, 0);
  ch2.onmessage({ data: { type: 'ai-clear' } }); assert.equal(ch2.sent[1].ok, true);
  const ch3 = mk(); create(() => ch3, () => null);
  ch3.onmessage({ data: { type: 'ai-drop', kind: 'wolf' } }); assert.equal(ch3.sent[0].ok, false); void calls;
  console.log('aiPatchRecv drop OK');
}
