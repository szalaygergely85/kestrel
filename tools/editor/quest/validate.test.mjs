// ED-QUI-07a: validateQuest on 3 fixtures + R19 parity with tools/validate-content.mjs + nodeRole.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests } from './model.js';
import { loadDialogues } from './lines.js';
import { validateQuest, validateFooter, lintQuestText as mirror, r19Files } from './validate.js';
import { conversationView, nodeRole } from './conversation.js';
import { lintQuestText as real } from '../../validate-content.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content');
const m = loadQuests(join(root, 'quests')), dm = loadDialogues(join(root, 'dialogue'), fs);
const names = { bear: 'Burl' };
const ctx = { characters: new Set(['bear']), pos: () => ({ x: 0, y: 0, z: 0 }), groundAt: () => 0, walkable: () => true, labelOf: (id) => names[id] || id, hasFlag: () => true, flowOf: () => ({ accept: true, exit: true }) };
const rules = (r) => [...new Set(r.items.map((x) => x.rule))].sort().join(',');
const base = m.quests.find((q) => q.id === 'sq.burl.blue');
const variant = (mut) => { const raw = structuredClone(base.raw); mut(raw); return { quest: { ...base, raw, giver: raw.giver?.npc || null, title: raw.title, objectives: raw.objectives, reward: raw.reward, requires: raw.requires, lines: raw.lines ?? null }, }; };
const run = (q, c = ctx, d = null) => validateQuest({ ...m, quests: m.quests.filter((x) => x !== base).concat(q) }, q, c, d);

// 1 clean quest
const clean = validateQuest(m, base, ctx, null);
assert.deepEqual(clean.items.filter((x) => x.severity === 'error'), [], 'clean: no errors'); assert.equal(clean.ok, true);
const f = validateFooter(m, base, clean); assert.equal(f.path, 'content/quests/' + base.file); assert.ok(f.bytes > 100); assert.match(f.verdict, /NO ERRORS|^OK/);
// 2 missing hand-in: no giver at all
let r = run(variant((q) => { delete q.giver; }).quest);
assert.ok(r.errors >= 1 && /R14/.test(rules(r)), 'missing giver: ' + rules(r)); assert.ok(r.items.some((x) => x.rule === 'R14' && x.target.kind === 'giver'));
// 3 four objectives + 57-char pack line + xp field
r = run(variant((q) => { q.objectives.push({ ...q.objectives[0], id: 'o3' }, { ...q.objectives[0], id: 'o4' }); q.lines = { offer: ['x'.repeat(57)] }; q.reward = { ...q.reward, xp: 5 }; }).quest);
const qf = r.items.filter((x) => x.rule === 'QF').map((x) => x.text);
assert.ok(qf.some((t) => /4 objectives/.test(t)) && qf.some((t) => /xp field/.test(t)), qf.join('|'));
assert.ok(r.items.some((x) => x.rule === 'R19' && /57 chars/.test(x.text) && x.severity === 'error'), 'R19 talklen on the 57-char line');
assert.ok(r.errors >= 3 && !r.ok);
// R19 objective length -> warning with objective target
r = run(variant((q) => { q.objectives[0].text = 'This objective text is far too long to read'; }).quest);
assert.ok(r.items.some((x) => x.rule === 'R19' && x.severity === 'warn' && x.target.kind === 'objective'));

// parity: the mirror gives exactly the real lintQuestText on every quest + its dialogue nodes
let n = 0;
for (const q of m.quests) { const files = r19Files(q, dm); assert.deepEqual(mirror(files), real(files), q.id); n += files.length; }
const all = [...dm.files.values()].map((f2) => ({ path: 'content/dialogue/' + f2.name, json: f2.obj }));
assert.deepEqual(mirror(all), real(all), 'dialogue files');
// every real quest validates without throwing, items well-formed
for (const q of m.quests) for (const x of validateQuest(m, q, ctx, dm).items) assert.ok(x.rule && x.text && x.target && ['error', 'warn'].includes(x.severity), q.id);

// node roles: rook.meet.* first-meeting nodes are MEET, not HAND-IN
const road = m.quests.find((q) => q.id === 'burl.road');
const roles = conversationView(dm, road, undefined).nodes.map((x) => [x.id, nodeRole(x)]);
for (const [id, role] of roles) if (/\.meet\./.test(id)) assert.equal(role, 'MEET', id);
assert.equal(nodeRole({ id: 'x.ready.1', stage: 'Hand-in', pack: false }), 'HAND-IN');
assert.equal(nodeRole({ id: 'x.1', stage: 'Offer', pack: false }), 'OFFER'); assert.equal(nodeRole({ id: 'x.1', stage: 'Progress' }), 'ACTIVE');
console.log('validate.test PASS (' + n + ' R19 inputs; roles ' + JSON.stringify(roles) + ')');
