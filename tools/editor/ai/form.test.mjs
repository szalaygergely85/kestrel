// ED-AI-03: field specs vs validator, debounce, undo, bridge payloads. Run: node tools/editor/ai/form.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArchetypes } from './model.js';
import { validateArchetype, ARCH_ENUMS } from './validate.js';
import { ARCH_FIELDS, ATTACK_FIELDS, clampField, boundsOf, attackNote } from './form.js';
import { createPatchBridge } from './patchBridge.js';
import { createCreatures } from '../aiPanel.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/beasts');
const fresh = () => loadArchetypes(dir);
const ok = { noticeR: 20, nearR: 5, coneCos: 0.5, noticeSec: 1, aggro: 'hostile', loseR: 60, loseSightSec: 5, leashR: 50, walk: 2, run: 6, role: 'melee', keepMin: 4, keepMax: 8, backOffR: 2, medium: 'land', when: 'any' };

// 1. specs == validator: min/max accepted, just outside refused (on a field-by-field basis, other fields kept valid)
for (const s of ARCH_FIELDS) {
  if (s.enum) { assert.deepEqual(s.enum, ARCH_ENUMS[s.key], s.key); continue; }
  const probe = (v) => validateArchetype({ ...ok, ...(s.key === 'run' ? { walk: 0 } : {}), ...(s.key === 'loseR' ? {} : {}), [s.key]: v }, 'x').filter((m) => m.includes(`(${s.key}) must be`));
  const lo = s.key === 'keepMax' ? 0 : s.min;
  const mk = (v) => probe(v);
  assert.equal(mk(s.min).length, 0, `${s.key} min ok`);
  assert.equal(mk(s.max).length, 0, `${s.key} max ok`);
  assert.ok(mk(s.min - 0.01).length > 0, `${s.key} below min refused`);
  assert.ok(mk(s.max + 0.01).length > 0 || s.special !== undefined, `${s.key} above max refused`);
  assert.equal(s.min, lo === 0 && s.key === 'keepMax' ? 0 : s.min);
}
assert.equal(validateArchetype({ ...ok, leashR: 1e9 }, 'x').length, 0, 'no-leash sentinel valid');

// 2. clamping
const run = ARCH_FIELDS.find((s) => s.key === 'run');
assert.deepEqual(clampField(run, '99', null, 4), { value: 12, clamped: true });
assert.deepEqual(clampField(run, 'abc', null, 4), { value: 4, clamped: true });
assert.deepEqual(clampField(run, '5', null, 4), { value: 5, clamped: false });
assert.equal(clampField(ARCH_FIELDS.find((s) => s.key === 'leashR'), 1e9, null, 5).clamped, false);
const wind = ATTACK_FIELDS.find((s) => s.windup);
assert.equal(clampField(wind, 0.1, { type: 'melee', dmgF: 1 }, 0.5).value, 0.4);
assert.equal(clampField(wind, 0.5, { type: 'aoe', dmgF: 1 }, 0.9).value, 0.8, 'big attack wind-up min 0.8');
assert.deepEqual(boundsOf(wind, { type: 'melee', dmgF: 3 }), [0.8, 5]);
assert.equal(attackNote({ type: 'aoe' }), 'needs ground marker');

// 3. debounce: a 1 s drag at 16 ms ticks -> <= 1 message / 100 ms, last value delivered
{
  let t = 0; const timers = []; const posts = [];
  const b = createPatchBridge({ channel: { post: (m) => posts.push({ t, m }) }, now: () => t, setTimer: (fn, ms) => { timers.push({ at: t + ms, fn }); return timers.length; }, clearTimer: () => {} });
  for (t = 0; t <= 1000; t += 16) { timers.filter((x) => x.at <= t && !x.done).forEach((x) => { x.done = true; x.fn(); }); b.sendPatch('grazer', { run: 1 + t / 100 }); }
  t = 1200; timers.filter((x) => !x.done).forEach((x) => { x.done = true; x.fn(); });
  assert.ok(posts.length <= 11 && posts.length >= 8, 'messages ' + posts.length);
  for (let i = 1; i < posts.length; i++) assert.ok(posts[i].t - posts[i - 1].t >= 100, 'gap');
  assert.equal(posts[0].m.type, 'ai-patch'); assert.equal(posts[0].m.name, 'grazer');
  assert.equal(posts.at(-1).m.fields.run, 1 + 992 / 100);
}

// 4. controller: undo steps, drag = one step, refusal echo, reset, save
{
  const m = fresh(), msgs = []; let echo = null, ch = { post: (x) => msgs.push(x) };
  const bridge = createPatchBridge({ channel: ch, delayMs: 0, onResult: (r) => { echo = r; } });
  const c = createCreatures({ model: m, bridge, fs: { writeFileSync() {}, readFileSync() {} } });
  const w0 = m.arch.grazer.walk;
  c.dragArch('grazer', 'run', 5); c.dragArch('grazer', 'run', 6); c.dragArch('grazer', 'run', 7);
  assert.equal(m.arch.grazer.run, 4.5, 'drag does not edit');
  c.release();
  assert.equal(m.arch.grazer.run, 7); assert.equal(c.stack.undo(), true); assert.equal(m.arch.grazer.run, 4.5); assert.equal(c.stack.undo(), false, 'one step');
  c.redo();
  assert.ok(msgs.some((x) => x.type === 'ai-patch' && x.fields.run === 7));
  assert.equal(c.setArch('grazer', 'walk', 500), true); assert.equal(m.arch.grazer.walk, 12); assert.equal(c.st.flags['grazer.walk'], true);
  c.undo(); assert.equal(m.arch.grazer.walk, w0);
  const kind = Object.keys(m.kinds)[0];
  assert.equal(c.setAttack(kind, 0, 'windupSec', 0.01), true); assert.equal(m.kinds[kind].attacks[0].windupSec, 0.4);
  assert.deepEqual(c.errors(), []);
  bridge.constructor; ch.onmessage({ type: 'ai-patch-result', name: 'grazer', ok: false, refused: ['too fast'] });
  assert.deepEqual(echo, { name: 'grazer', ok: false, refused: ['too fast'] });
  c.onResult(echo); assert.deepEqual(c.st.refusal.grazer, ['too fast']);
  c.reset(); assert.equal(JSON.stringify(m.files.arch.obj), m.files.arch.snap);
  assert.ok(c.list('boar').kinds.includes('boar'));
  assert.equal(m.arch.grazer.run, 4.5); c.undo(); assert.equal(m.arch.grazer.run, 7, "undo of reset");
  const writes = []; const c2 = createCreatures({ model: m, fs: { writeFileSync: (p, t) => writes.push(p), readFileSync() {} } });
  c2.setArch('grazer', 'noticeR', 11); assert.equal(c2.save().written.length >= 1, true);
  c2.setArch('grazer', 'nearR', 70); assert.equal(c2.save().ok, false, 'invalid model not saved');
}
console.log('form.test.mjs OK');
