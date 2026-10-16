// ED-QUI-03/04: origin + turn-in cards, objective cards, kind / count edits, round-trip, undo over the real content.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests, makeStack, fileText } from './model.js';
import { originCards, setTurnInSameAsGiver, TALK_RADIUS_M } from './originCards.js';
import { objectiveCards, setStepKind, setStepCount, kindOf, kindsFor, MAX_NOTE } from './objectiveCards.js';
import { addStepMax } from './formatEdit.js';
import { applyPick } from './targets.js';
import { makeNames } from './flow.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const world = JSON.parse(readFileSync(join(root, 'content/worlds/world_m1.world.json'), 'utf8'));
const m = loadQuests(join(root, 'content/quests'));
const sites = JSON.parse(readFileSync(join(root, 'content/quests/sites.json'), 'utf8')).sites;
const names = makeNames({ sites });
const q = (id) => m.quests.find((x) => x.id === id);
const clone = (id) => { const s = q(id); return { ...s, raw: structuredClone(s.raw) }; };

// --- origin / turn-in
let c = originCards(q('burl.road'), world, names, sites);
assert.equal(c.origin.glyph, '!'); assert.equal(c.turnIn.glyph, '?');
assert.equal(c.origin.id, 'bear'); assert.equal(c.turnIn.id, 'rook'); assert.equal(c.turnIn.same, false);
assert.equal(c.origin.kind, 'Character'); assert.equal(c.origin.radius, TALK_RADIUS_M);
assert.equal(typeof c.origin.pos.x, 'number'); assert.deepEqual(c.problems, []);
assert.equal(c.turnIn.pos.x, 982); // rook x

// same-as-giver (no turnIn)
const own = clone('burl.road'); delete own.raw.giver.turnIn;
c = originCards(own, world, names, sites); assert.equal(c.turnIn.same, true); assert.equal(c.turnIn.id, 'bear'); assert.deepEqual(c.problems, []);

// pack site giver resolves through sites.json
const pk = q('sq.burl.meat'); c = originCards(pk, world, names, sites);
assert.equal(c.origin.kind, 'Character'); assert.equal(c.origin.problem, null); assert.ok(c.origin.pos);

// object giver (D-087): fine as giver, red without a turn-in character (D-108)
const prop0 = world.entities.find((e) => e.components && e.components.inspect);
const og = clone('burl.road'); og.raw.objectGiver = true; og.raw.giver = { npc: prop0.id }; c = originCards(og, world, names, sites);
assert.equal(c.origin.kind, 'Object'); assert.equal(c.origin.problem, null); assert.match(c.turnIn.problem, /turn-in character/);
og.raw.giver.turnIn = 'rook'; c = originCards(og, world, names, sites); assert.deepEqual(c.problems, []);
og.raw.objectGiver = false; assert.match(originCards(og, world, names, sites).origin.problem, /not a character/);

// missing end / end = beast refused
const none = clone('burl.road'); none.raw.giver = {}; c = originCards(none, world, names, sites);
assert.ok(c.origin.problem && c.problems.length === 2);
const beast = world.entities.find((e) => e.components && e.components.brain);
const bq = clone('burl.road'); bq.raw.giver = { npc: 'bear', turnIn: beast.id }; c = originCards(bq, world, names, sites);
assert.match(c.turnIn.problem, /character/); assert.equal(c.turnIn.kind, 'Beast');
// picking a beast / an object for the turn-in is refused
const prop = world.entities.find((e) => e.components && e.components.inspect);
for (const e of [beast, prop]) assert.ok(applyPick(q('burl.road'), 'return', { entityId: e.id }, world, { sites, model: m }).error);

// writers keep shape; undo restores bytes
const st = makeStack(); const before = JSON.stringify(q('burl.road').raw);
const cmd = setTurnInSameAsGiver(q('burl.road')); st.run(cmd);
assert.equal(q('burl.road').raw.giver.turnIn, undefined); assert.equal(q('burl.road').raw.giver.npc, 'bear');
st.undo(); assert.equal(JSON.stringify(q('burl.road').raw), before);
const fq = clone('burl.road'); fq.raw = { id: 'x', begin: { npc: 'bear' }, end: { npc: 'rook' }, objectives: [] };
c = originCards(fq, world, names, sites); assert.equal(c.turnIn.id, 'rook');
const fcmd = setTurnInSameAsGiver(fq); fcmd.apply(); assert.deepEqual(fq.raw.end, { npc: 'bear' });
const pr = applyPick(fq, 'return', { entityId: 'rook' }, world, { sites }); assert.deepEqual(pr.cmd && (pr.cmd.apply(), fq.raw.end), { npc: 'rook' });

// --- objectives
const road = q('burl.road'); let oc = objectiveCards(road, world, { sites, names });
assert.deepEqual(oc.cards.map((x) => x.kind), ['goto', 'goto', 'flag']);
assert.deepEqual(oc.cards.map((x) => x.canCount), [false, false, false]); assert.equal(oc.cards[0].count, null);
assert.equal(oc.canAdd, false); assert.equal(oc.addNote, MAX_NOTE); assert.deepEqual(oc.problems, []);
assert.equal(oc.cards[0].text, 'Take the old road west'); assert.equal(oc.cards[0].canUp, false); assert.equal(oc.cards[2].canDown, false);
assert.equal(addStepMax(road), null);
// 4th step = lint error
const four = clone('burl.road'); four.raw.objectives.push({ ...four.raw.objectives[0], id: 'x' });
assert.match(objectiveCards(four, world, { sites, names }).problems[0], /4 objectives/);
// long title flagged
const lg = clone('burl.road'); lg.raw.objectives[0].text = 'x'.repeat(39); assert.equal(objectiveCards(lg, world, {}).cards[0].textBad, true);

// kinds per shape; count refused on area / flag / talk, allowed on collect / kill
const kill = q('sq.burl.boars.n'); oc = objectiveCards(kill, world, { sites, names });
assert.equal(oc.cards[0].kind, 'kill'); assert.equal(oc.cards[0].canCount, true); assert.ok(oc.cards[0].count >= 1);
assert.equal(setStepCount(road, 0, 2), null); assert.equal(setStepCount(road, 2, 2), null);
const stack = makeStack(), kbefore = JSON.stringify(kill.raw);
assert.equal(setStepCount(kill, 0, 0), null); assert.equal(setStepCount(kill, 0, 1.5), null);
stack.run(setStepCount(kill, 0, 4)); assert.equal(kill.raw.steps[0].params.count, 4); assert.equal(kill.steps ?? 1, 1);
stack.undo(); assert.equal(JSON.stringify(kill.raw), kbefore);
// kind change = new blank step of that kind, text + journal kept, no field mixing; legacy vs pack shapes
stack.run(setStepKind(kill, 0, 'talk')); assert.equal(kindOf(kill.raw.steps[0]), 'talk'); assert.deepEqual(kill.raw.steps[0].params, { to: '' });
assert.equal(kill.raw.steps[0].objText, JSON.parse(kbefore).steps[0].objText); stack.undo(); assert.equal(JSON.stringify(kill.raw), kbefore);
const lbefore = JSON.stringify(road.raw);
stack.run(setStepKind(road, 2, 'kill')); assert.deepEqual(road.raw.objectives[2].when, { type: 'beasts', kind: '', count: 1 }); assert.equal(road.raw.objectives[2].id, 'wake');
assert.equal(setStepKind(road, 2, 'kill'), null); assert.equal(setStepKind(road, 2, 'talk'), null);   // same kind / legacy has no talk
stack.undo(); assert.equal(JSON.stringify(road.raw), lbefore);
assert.ok(kindsFor(kill).includes('talk')); assert.ok(!kindsFor(road).includes('talk'));
// every real quest builds cards without throwing
for (const x of m.quests) { const r = objectiveCards(x, world, { sites, names }); for (const k of r.cards) assert.ok(k.label, x.id); }

// round-trip: nothing edited -> every quest file text identical
for (const [name, f] of m.files) if (f.kind !== 'sites' && f.kind !== 'areas') assert.equal(fileText(f), f.text, name);
console.log('originObjectives.test PASS');
