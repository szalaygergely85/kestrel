// ED-QUEST-02: flow + list + edit commands over the real content/quests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../../design/palette.js';
import '../../../design/items.js';
import { loadQuests, makeStack, saveQuest } from './model.js';
import { makeNames, questRows, filterRows, itemChoices, buildFlow, flowText } from './flow.js';
import * as ed from './edit.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/quests');
const m = loadQuests(dir);
const defs = globalThis.ASSETS.items.defs;
const sites = JSON.parse(readFileSync(join(dir, 'sites.json'), 'utf8')).sites;
const names = makeNames({ itemDefs: defs, sites });
const q = (id) => m.quests.find((x) => x.id === id);

// list + filter
const rows = questRows(m.quests, names);
assert.equal(rows.length, m.quests.length);
const blue = rows.find((r) => r.id === 'sq.burl.blue');
assert.equal(blue.chip, 'blue'); assert.equal(blue.region, 'main'); assert.equal(blue.title, 'The Blue Ones');
assert.equal(rows.find((r) => r.id === 'sq.tm.nub').region, 'ch12');
assert.ok(filterRows(rows, 'BLUE ones').some((r) => r.id === 'sq.burl.blue'));
assert.ok(filterRows(rows, 'sq.tm.nub').length === 1);
assert.ok(filterRows(rows, 'bear').length >= 2, 'giver filter');
assert.equal(filterRows(rows, '').length, rows.length);
assert.equal(filterRows(rows, 'zzzz-none').length, 0);

// flow: sq.burl.blue (2 objectives, cloak) and sq.tm.nub (3 explore steps, heart piece)
const fb = buildFlow(q('sq.burl.blue'), names);
assert.deepEqual(fb.map((n) => n.kind), ['giver', 'offer', 'objective', 'objective', 'return', 'reward']);
assert.equal(fb[2].label, '1. Pick six blue sprigs');
assert.equal(fb[4].label, 'Return: Take the blue sprigs to Burl');
assert.match(fb[5].label, /^Reward: /); assert.ok(defs['gear.cloak.cloak.worn'].name && fb[5].label.includes(defs['gear.cloak.cloak.worn'].name));
const fn = buildFlow(q('sq.tm.nub'), names);
assert.deepEqual(fn.map((n) => n.kind), ['giver', 'offer', 'objective', 'objective', 'objective', 'return', 'reward']);
assert.equal(fn[2].label, '1. Look for small tracks by the stone');
assert.equal(fn[5].label, 'Return: Tell Burl where the tracks went');
assert.equal(fn[6].label, 'Reward: Heart Piece');
assert.ok(fn[1].detail.startsWith('Have you seen my Nub?'));
// no raw ids (dots / camelCase) in any label of any quest
for (const x of m.quests) for (const n of buildFlow(x, names)) if (n.kind === 'giver' || n.kind === 'reward') assert.ok(!/[a-z][A-Z]|\w\.\w/.test(n.label), 'raw id in ' + x.id + ': ' + n.label);
assert.ok(itemChoices(defs).some((c) => c.id === 'heart.piece' && c.name === 'Heart Piece'));

// edits: one undo step each, exact undo
const st = makeStack();
const orig = JSON.stringify(q('sq.burl.blue').raw);
const qb = q('sq.burl.blue');
st.run(ed.setTitle(qb, 'Blue!'));
st.run(ed.setReturnText(qb, 'Back to Burl'));
st.run(ed.setObjectiveField(qb, 0, 'text', 'Pick sprigs'));
st.run(ed.setObjectiveField(qb, 1, 'journal', 'J'));
st.run(ed.setRewardItem(qb, 'heart.piece', 2));
st.run(ed.setOfferLines(qb, ['Hello.', '', 'Bye.']));
assert.equal(qb.objectives[0].text, 'Pick sprigs'); assert.equal(qb.objectives[1].journal, 'J');
assert.deepEqual(qb.reward.items, [{ id: 'heart.piece', n: 2 }]); assert.deepEqual(qb.lines.offer, ['Hello.', 'Bye.']);
assert.equal(buildFlow(qb, names).at(-1).label, 'Reward: Heart Piece x2');
st.run(ed.addStep(qb)); assert.equal(qb.objectives.length, 3);
st.run(ed.moveStep(qb, 2, 0)); assert.equal(qb.objectives[0].text, 'New step');
st.run(ed.deleteStep(qb, 0)); assert.equal(qb.objectives.length, 2);
for (let i = 0; i < 9; i++) assert.ok(st.undo());
assert.equal(JSON.stringify(qb.raw), orig, 'undo restores exactly');
assert.ok(!st.undo());
// pack quest: steps + objText
const qn = q('sq.tm.nub'); const o2 = JSON.stringify(qn.raw);
st.run(ed.setObjectiveField(qn, 1, 'text', 'Tower door!')); assert.equal(qn.raw.steps[1].objText, 'Tower door!');
st.run(ed.addStep(qn)); assert.equal(qn.raw.steps[3].template, 'explore');
st.undo(); st.undo(); assert.equal(JSON.stringify(qn.raw), o2);

// new side quest: defaults, listed, saved as its own legacy file, undo removes
const mk = ed.newSideQuest(m); st.run(mk);
const nq = mk.quest;
assert.ok(m.quests.includes(nq)); assert.equal(nq.raw.abandonable, true); assert.equal(questRows([nq], names)[0].chip, 'blue');
assert.equal(flowText(nq, names).split('\n')[0], 'Giver: nobody yet');
assert.equal(ed.newSideQuest(m).quest.id, 'sq.new2');
const writes = []; assert.ok(saveQuest(m, nq, { writeFileSync: (p, t) => writes.push([p, t]) }).ok);
assert.ok(writes[0][0].endsWith('sq.new.quest.json')); assert.ok(writes[0][1].endsWith('}\n'));
st.undo(); assert.ok(!m.quests.includes(nq) && !m.files.has('sq.new.quest.json'));
console.log('flow.test ok');
