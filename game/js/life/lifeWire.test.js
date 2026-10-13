// LIFE-HOOKS-01. Run: node game/js/life/lifeWire.test.js  - real raids.json + real quest book + real createRaids behind a stub sim.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createQuestBook } from '../quest/sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { createLifeWire, prepareRaidDefs, syncGates, DAY_KEY } from './lifeWire.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const rel = (p) => fileURLToPath(new URL(p, import.meta.url));

const json = JSON.parse(readFileSync(rel('../../../content/life/raids.json'), 'utf8'));
const { defs, gates } = prepareRaidDefs(json);
ok(defs.length === 1 && defs[0].id === 'gooseFarm' && defs[0].requires === 'life.gate.sq.ow.raid' && gates['life.gate.sq.ow.raid'] === 'sq.ow.raid', 'raids.json -> defs + gate flag', JSON.stringify({ defs, gates }));

// real book: the board accept is an action key, not a world.state flag
const assets = await loadDesignAssets();
const dir = rel('../../../content/quests');
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map((q) => q.def);
const get = (id) => all.find((d) => d.id === id);
const pre = { ...get('mq.ford.mirror') }; delete pre.requires;
const book = createQuestBook(get('m1'), [pre, get('sq.ow.raid')]);
const state = {};
ok(!state['q.sq.ow.raid.accept'], 'the q.*.accept key is never a world.state flag');
syncGates(book, state, gates);
ok(state['life.gate.sq.ow.raid'] === false, 'gate closed before accept');
ok(book.accept('mq.ford.mirror') !== undefined, 'prereq stubbed');
const via = book.statusOf('sq.ow.raid') === 1 ? book.accept('sq.ow.raid') : null;
ok(book.statusOf('sq.ow.raid') >= 2, 'board note accepted -> status active', 'status=' + book.statusOf('sq.ow.raid') + ' via=' + via);
syncGates(book, state, gates);
ok(state['life.gate.sq.ow.raid'] === true, 'gate opens once accepted');

// wiring: stub sim/world, real createRaids from raids.json, clock through midnight
const goals = {}, log = [];
const sim = { slotOf: (id) => Number(id.slice(4)) - 1, isDead: () => false, setGoal: (s, x, y) => { goals[s] = [x, y]; }, clearGoal: (s) => { delete goals[s]; }, setAltTargets() {} };
const L = {}; const events = { on(n, f) { (L[n] = L[n] || []).push(f); return () => {}; }, emit(n, p) { log.push(n); (L[n] || []).forEach((f) => f(p)); } };
const world = { entity: (id) => (id === 'gooseFarm' ? { transform: { x: 860, y: 990 } } : null) };
const st = { 'clock.hour': 20.9 };
const wire = createLifeWire({ defs, gates, sim, events, state: st, world, book: () => null });
for (let i = 0; i < 20; i++) wire.step(21.5);
ok(!log.includes('life:raid:start') && Object.keys(goals).length === 0, 'gate closed (no book) -> no raid');
wire.dispose();
const st2 = { 'clock.hour': 23.9 };
const wire2 = createLifeWire({ defs: [{ ...defs[0], chancePerNight: 1 }], gates, sim, events, state: st2, world, book: () => book });
wire2.step(23.95); wire2.step(0.05);
ok((st2[DAY_KEY] | 0) === 1, 'midnight wrap increments clock.day', String(st2[DAY_KEY]));
wire2.step(1);
ok(log.includes('life:raid:start') && Object.keys(goals).length === 5, 'accepted + night: raid starts, 5 wolves given the goose-pen goal', JSON.stringify({ log, goals }));
wire2.dispose();

// main.js hands the ambient fauna to the beast sim, with the wildlife created first
const main = readFileSync(rel('../main.js'), 'utf8');
ok(/createWild\(/.test(main) && main.indexOf('wild = createWild(') < main.indexOf('createBeastSim(world') && /fauna: wild \? wild\.fauna : null/.test(main), 'main.js: wild before beasts, fauna passed');

console.log(`lifeWire.test: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
