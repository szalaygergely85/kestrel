// FB-02: Burl's Ember (sq.burl.fire, opens after mq.river.road; gates the west-bank chain (OB-136)): pack def, collect 3 emberpods, hand-in grants `unlock:fireball` + 1 mana potion exactly once.
import { fileURLToPath } from 'node:url';
import { makeOk } from '../../../engine/test/assert.js';
import { createQuestBook, DONE, ACTIVE, READY } from './sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { World, AssetRegistry } from '../../../engine/index.js';
import { createQuestPickups } from '../questPickups.js';
import { fireballOn, FIREBALL_FLAG } from './features.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const get = id => all.find(d => d.id === id);
const d = get('sq.burl.fire');
ok(!!d && d.title === "Burl's Ember" && d.giver.npc === 'bear', 'quest registered, giver Burl');
ok(d.reward.items.some(i => i.id === 'potion.mp' && i.n === 1) && d.reward.unlock[0] === 'fireball', 'reward = mana potion + unlock fireball');
ok(d.objectives[0].when.count === 3 && d.objectives[0].when.id === 'emberpod', 'collect 3 emberpods');
ok(d.objectives.every(o => o.text.length <= 38) && d.lines.ready.every(l => l.length <= 56), 'texts within limits');
ok(!!assets.items.defs.emberpod && assets.items.defs.emberpod.name === 'Fire Pod', 'item def emberpod');
const wj = JSON.parse(readFileSync(fileURLToPath(new URL('../../../content/worlds/world_m1.world.json', import.meta.url)), 'utf8'));
ok(wj.entities.filter(e => e.components?.questPickup?.item === 'emberpod').length === 3, '3 emberpod pickups in the world');

// prereq gate + flow
const pre = { ...get('mq.river.road') }; delete pre.requires;
const book = createQuestBook(get('m1'), [pre, d]);
const inv = new Map();
book.packOps = { count: id => inv.get(id) || 0, remove: (id, n) => inv.set(id, (inv.get(id) || 0) - n), add: (id, n) => { inv.set(id, (inv.get(id) || 0) + n); return n; }, equipped: () => true };
const real = createQuestBook(get('m1'), all.filter(x => x.id !== 'm1'));
ok(!real.accept('sq.burl.fire'), 'not offered before its prereq');
ok(book.accept('mq.river.road') && book.accept('sq.burl.fire') !== undefined, 'accept (prereq stubbed)');
for (let i = 0; i < 3; i++) book.feed({ type: 'item:count', id: 'emberpod', n: i + 1 });
ok(book.statusOf('sq.burl.fire') === READY, 'ready after 3 pods');
const reward = book.handIn('sq.burl.fire');
ok(!!reward && book.statusOf('sq.burl.fire') === DONE, 'handed in');

// grant: unlock once, potion each grant call is the pack's job, flag never re-given
const world = World.load({ name: 'fb2', terrain: null, structures: [], entities: [] }, new AssetRegistry({ palette: {} }), {});
let unlocks = 0; const events = { on() { return () => {}; }, emit(n) { if (n === 'magic.unlocked') unlocks++; } };
const packInv = { slots: [], cap: 20 };
const qp = createQuestPickups({ getBook: () => book, feed: () => {}, defs: assets.items.defs });
qp.onBoot({ world, events, inventory: packInv, player: null, state: {} });
ok(!fireballOn(world, null), 'locked before the reward');
qp.grantReward(reward); qp.grantReward(reward);
ok(world.state[FIREBALL_FLAG] === true && fireballOn(world, null), 'flag set after the reward');
ok(unlocks === 1, 'magic.unlocked emitted exactly once on a double grant (' + unlocks + ')');
console.log(`burlFire: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);

// OB-136 order: the west-bank chain needs the fireball beat (sq.burl.fire done); mirror/smoke hang off stones
ok(get('mq.ford.stones').requires.some(r => r.quest === 'sq.burl.fire' && r.done === true), 'mq.ford.stones requires sq.burl.fire done');
ok(get('mq.ford.mirror').requires.some(r => r.quest === 'mq.ford.stones') && get('mq.smoke').requires.some(r => r.quest === 'mq.ford.mirror'), 'mirror/smoke chained behind stones');
ok(get('sq.burl.fire').requires.some(r => r.quest === 'mq.river.road'), 'sq.burl.fire opens after mq.river.road');
