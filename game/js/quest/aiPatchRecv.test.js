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
