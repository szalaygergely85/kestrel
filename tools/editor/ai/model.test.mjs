// ED-AI-01: archetype/kind data moved to content/beasts/*.json. Run: node tools/editor/ai/model.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArchetypes, saveArchetypes, fileText, setArchField, setAttackField, addAttack, removeAttack, makeStack, validateModel, stringifyBeasts } from './model.js';
import { validateArchetype, validateArchetypes, validateKinds, validateAttack, leashLabel } from './validate.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = join(here, '../../../content/beasts');

const base = JSON.parse(readFileSync(join(here, 'fixtures/beasts-baseline.json'), 'utf8'));
const { ARCHETYPES, KINDS } = base; // (game/ tables vs the JSON: tools/beasts-data.test.mjs)

// 2. load -> save without an edit is byte-identical and writes nothing; canonical layout reproduces the files
const m = loadArchetypes(dir);
assert.deepEqual(m.errors, []);
for (const f of Object.values(m.files)) { assert.equal(fileText(f), readFileSync(join(dir, f.name), 'utf8')); assert.equal(stringifyBeasts(f.obj), f.text, f.name + ' canonical'); }
const writes = [];
const fsMock = { writeFileSync: (p, t) => writes.push([p, t]) };
assert.equal(saveArchetypes(m, fsMock).written.length, 0);
assert.deepEqual(validateModel(m), [], 'shipped data is valid');

// 3. commands + exact undo
const st = makeStack();
const orig = m.files.arch.text, origK = m.files.kinds.text;
st.run(setArchField(m, 'grazer', 'noticeR', 12));
assert.equal(m.arch.grazer.noticeR, 12);
st.run(setAttackField(m, 'grey_wolf', 0, 'dmgF', 1.2));
st.run(addAttack(m, 'boar'));
assert.equal(m.kinds.boar.attacks.length, 2);
st.run(removeAttack(m, 'grey_wolf', 1));
assert.equal(m.kinds.grey_wolf.attacks.length, 1);
assert.deepEqual(saveArchetypes(m, fsMock).written.sort(), ['archetypes.json', 'kinds.json']);
assert.ok(writes[0][1].includes('"noticeR": 12'));
for (let i = 0; i < 4; i++) assert.ok(st.undo());
assert.equal(fileText(m.files.arch), orig); assert.equal(fileText(m.files.kinds), origK);
st.redo(); assert.equal(m.arch.grazer.noticeR, 12);
st.undo(); assert.equal(fileText(m.files.arch), orig);
// unknown fields survive an edit
const m2 = loadArchetypes('x', { readFileSync: (p) => (p.endsWith('kinds.json') ? '{}' : '{"grazer": {"noticeR": 10, "mystery": [1, 2]}}\n') });
const s2 = makeStack(); s2.run(setArchField(m2, 'grazer', 'noticeR', 11));
assert.ok(fileText(m2.files.arch).includes('"mystery": [1, 2]'));

// 4. five hand-broken fixtures each fire exactly the expected message
const good = () => JSON.parse(JSON.stringify(ARCHETYPES.ranged));
const one = (mut, re) => { const a = good(); mut(a); const e = validateArchetype(a, 'ranged'); assert.equal(e.length, 1, JSON.stringify(e)); assert.match(e[0], re); };
one((a) => { a.noticeR = 100; a.loseR = 150; }, /Notice distance \(noticeR\) must be between 1 and 80 m, but is 100/);
one((a) => { a.nearR = 30; }, /Near distance \(nearR 30\) must not be larger than Notice distance \(noticeR 22\)/);
one((a) => { a.walk = 6; a.run = 4; }, /Walk speed \(walk 6\) must not be faster than Run speed \(run 4\)/);
one((a) => { a.backOffR = 11; }, /Back-off distance \(backOffR 11\) must not be larger than Keep-away minimum \(keepMin 10\)/);
one((a) => { a.role = 'sniper'; }, /Combat role \(role\) must be one of melee, ranged.*"sniper"/);
assert.match(validateArchetype({ ...good(), leashR: 3 }, 'x')[0], /Leash distance \(leashR\) must be at least 5 m, or 1000000000 for "No leash"/);
assert.equal(leashLabel(1e9), 'No leash'); assert.equal(leashLabel(25), '25 m');
// attacks / kinds / order
const at = { id: 'a', type: 'melee', range: 2, windupSec: 0.2, activeSec: 0.3, recoverSec: 1, cooldownSec: 2, dmgF: 1, weight: 1 };
assert.match(validateAttack(at, 'K')[0], /wind-up \(windupSec 0.2 s\) must be at least 0.4 s/);
assert.match(validateAttack({ ...at, windupSec: 0.5, type: 'aoe' }, 'K')[0], /big attack .* at least 0.8 s/);
assert.match(validateAttack({ ...at, windupSec: 0.5, weight: 0 }, 'K')[0], /weight must be more than 0/);
const k = JSON.parse(JSON.stringify(KINDS.boar)); k.attacks = [0, 1, 2, 3].map(() => ({ ...at, windupSec: 0.5 }));
assert.match(validateKinds({ boar: k }, ARCHETYPES)[0], /has 4 attacks, the most allowed is 3/);
assert.match(validateKinds({ boar: { ...KINDS.boar, arch: 'nope' } }, ARCHETYPES)[0], /archetype "nope" does not exist/);
const rev = Object.fromEntries(Object.entries(ARCHETYPES).reverse());
assert.ok(validateArchetypes(rev).some((x) => /moved to position/.test(x)));
const dropped = { ...ARCHETYPES }; delete dropped.swarm;
assert.ok(validateArchetypes(dropped).some((x) => /"swarm" was removed/.test(x)));
console.log('ED-AI-01 model.test OK');
