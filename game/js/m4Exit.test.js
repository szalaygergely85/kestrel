// M4 exit test (Node half): new game -> wake -> relay -> save -> quit -> Continue keeps position, hearts (+ pieces), items,
// equipment, quick bar, quest book (active/done/tracked + given items), flags and clock hour; the round trip is byte-stable,
// and old-shape saves (no quests/equipment/quickbar/look/savedAt) still load. Real save code: saveRelay + saveState + engine serialize.
// Run: node game/js/m4Exit.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, AssetRegistry } from '../../engine/index.js';
import { loadQuestFiles } from './questBoot.js';
import { createSaveRelay } from './saveRelay.js';
import { ensureInventory, addItem, removeItem, countOf } from './quest/sim/inventory.js';
import { ensureEquipment, equip } from './quest/sim/equipment.js';
import { ensureQuickbar, assign } from './quest/sim/quickbar.js';
import { collect, reconcile } from './quest/sim/heartPieces.js';
import { tickClock } from './quest/worldClock.js';
import { loadDesignAssets } from '../../tools/validate-content.mjs';

const ROOT = new URL('../../', import.meta.url);
const defs = (await loadDesignAssets()).items.defs;
const items = Object.values(defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(async (u) => JSON.parse(readFileSync(new URL(u, new URL('game/', ROOT)), 'utf8')), { log() {}, items });
assert.deepEqual(files.errors, []);
const { questDef } = files;
// Clones of two real pack quests with the Ch1 gates removed (the gates are covered by questBatch1.test); same giveOn*/reward data.
const open = (id) => { const d = structuredClone(files.giverDefs.find((x) => x.id === id)); d.requires = []; return d; };
const giverDefs = [open('sq.burl.parcel'), open('sq.tm.nub')];
const assets = new AssetRegistry({ palette: {} });
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const KEY = 'kestrel.save.slot.0';
const mkWorld = () => World.load({ name: 'm4_fixture', terrain: null, structures: [], entities: [], state: {} }, assets, {});
const look = { v: 1, kit: 'human', base: 'b1', skin: 's2', eyes: 'e1', height: 1, age: 'adult', hair: { id: 'h1', ramp: 'brown' } };

function wirePack(relay, inv, eq) {
  const ops = { count: (id) => countOf(inv, id), remove: (id, n) => removeItem(inv, id, n), add: (id, n) => addItem(inv, defs, id, n), equipped: (id) => Object.values(eq).includes(id) };
  relay.quest.book.packOps = ops; return ops;
}
function snap(world, relay) {
  const p = world.get('player').data, c = p.components, book = relay.quest.book;
  return structuredClone({
    pos: [p.transform.x, p.transform.y, p.transform.z, p.transform.yawDeg], health: c.health, mana: c.mana, inventory: c.inventory,
    equipment: c.equipment, quickbar: c.quickbar, quickbarSeen: c.quickbarSeen, state: world.state,
    quests: book.toSave(), tracked: book.tracked(), statuses: Array.from({ length: book.count }, (_, i) => book.status(i)),
    objective: relay.quest.objectiveText(), dead: relay.deadBeasts.sort(), chests: relay.openedChests.sort(), play: relay.playTimeSec, look: relay.look,
  });
}

// ---------- phase A: a new game played up to the first relay ----------
const wA = mkWorld();
const pA = wA.spawn('unit', { x: 410.5, y: 612.25, z: 3.5, yawDeg: 77, pitchDeg: 0 }, { health: { hp: 30, max: 30, invuln: 0 }, mana: { mp: 4, max: 10 } }, 'player');
const inv = ensureInventory(pA.data, { pack: [{ id: 'sword', n: 1 }], left: 'sword', right: null });
for (const [id, n] of [['shield', 1], ['bow', 1], ['arrow', 12], ['potion.hp', 2]]) assert.equal(addItem(inv, defs, id, n), n, id);
const eq = ensureEquipment(pA.data);
for (const id of ['sword', 'shield']) assert.ok(equip(inv, eq, defs, id), 'equip ' + id);
const bar = ensureQuickbar(pA.data); assign(pA.data, defs, 5, 'potion.hp'); // QB-6: slot 5 = key 4
assert.ok(bar.includes('potion.hp'));
const A = createSaveRelay({ storage, questDef, giverDefs, defaultLook: look });
A.onWorldLoaded();
A.quest.world = wA; wirePack(A, inv, eq);
for (let i = 0; i < 600; i++) tickClock(wA.state, 1 / 6, { dayLenS: 7200, startHour: 8 });
A.quest.feed({ type: 'flag:set', key: 'wake', value: true });
A.quest.feed({ type: 'area:entered', id: 'relay1' });
wA.state['relay.ws_roadBend.woken'] = true;
// quests: parcel accepted (giveOnAccept meat) + tracked; nub fully done (reward heart.piece -> counter)
const book = A.quest.book;
assert.ok(book.accept('sq.burl.parcel'), 'parcel accepted'); assert.equal(countOf(inv, 'boar.meat'), 2, 'giveOnAccept item in pack');
assert.ok(book.accept('sq.tm.nub')); for (const id of ['waystone', 'towerDoor', 'roadWest']) book.feed({ type: 'area:entered', id });
const rw = book.handIn('sq.tm.nub'); assert.ok(rw, 'nub handed in'); for (const it of rw.items) addItem(inv, defs, it.id, it.n); // the caller (questPickups) grants the reward
const hp = pA.data.components.health;
const cr = collect(inv, hp, wA.state); assert.deepEqual([cr.total, cr.hearts], [1, 0], 'heart piece counted');
for (let k = 0; k < 3; k++) { addItem(inv, defs, 'heart.piece', 1); collect(inv, hp, wA.state); }
assert.equal(hp.max, 40, '4 pieces = +1 heart');
assert.equal(book.track('sq.burl.parcel'), true);
A.tick(125, wA, false);
assert.equal(A.save(wA), true, 'rest/save');
const before = snap(wA, A), text1 = mem.get(KEY);
assert.ok(before.tracked >= 1 && before.state['hearts.pieces'] === 4 && before.state['clock.hour'] > 8, JSON.stringify([before.tracked, before.state]));
assert.equal(before.quests.quests['sq.burl.parcel'].given?.[0]?.id, 'boar.meat', 'given list reaches toSave');
assert.equal(before.equipment.main, 'sword'); assert.equal(before.equipment.off, 'shield');

// ---------- phase B: quit -> Continue (fresh relay + world) ----------
const B = createSaveRelay({ storage, questDef, giverDefs, defaultLook: null });
B.onWorldLoaded();
const wB = B.load(assets, {}); assert.ok(wB, 'Continue finds the slot'); B.onWorldLoaded();
const pB = wB.get('player').data; reconcile(pB.components.health, wB.state, 30); wirePack(B, pB.components.inventory, pB.components.equipment);
const after = snap(wB, B);
assert.deepEqual(after, before, 'Continue restores the same snapshot');
assert.equal(B.quest.book.tracked(), before.tracked);
assert.ok(B.quest.book.abandon('sq.burl.parcel'), 'abandon after Continue works'); assert.equal(countOf(pB.components.inventory, 'boar.meat'), 0, 'given items go back after a reload');
const B2 = createSaveRelay({ storage, questDef, giverDefs }); mem.set(KEY, text1); B2.onWorldLoaded(); const w2 = B2.load(assets, {}); B2.onWorldLoaded();
assert.equal(B2.save(w2), true);
const strip = (t) => { const o = JSON.parse(t); delete o.meta.savedAt; return JSON.stringify(o); };
assert.equal(strip(mem.get(KEY)), strip(text1), 'save -> load -> save is byte-stable');

// ---------- old-shape saves still load (pre-QG-02 quests / pre-EQ equipment+quickbar / pre-CHARGEN look / pre-SAVE-TIME) ----------
{
  const o = JSON.parse(text1); delete o.game.quests; delete o.meta.savedAt; delete o.player;
  const ents = o.world.entities.find((e) => e.id === 'player'); delete ents.components.equipment; delete ents.components.quickbar; delete ents.components.quickbarSeen;
  mem.set(KEY, JSON.stringify(o));
  const O = createSaveRelay({ storage, questDef, giverDefs, defaultLook: look }); O.onWorldLoaded();
  const wo = O.load(assets, {}); assert.ok(wo, 'old-shape save loads'); O.onWorldLoaded();
  const po = wo.get('player').data; assert.equal(po.transform.x, 410.5); assert.equal(po.components.health.max, 40);
  assert.equal(ensureEquipment(po).main, null, 'missing equipment -> empty set (migrateEquipment/autoEquip fill later)');
  assert.ok(Array.isArray(ensureQuickbar(po)) && ensureQuickbar(po).length === 6);
  assert.equal(O.look, look, 'missing look -> kit default');
  assert.equal(wo.state['hearts.pieces'], 4);
}
console.log('m4Exit.test: new game -> relay -> save -> Continue snapshot equal, byte-stable, old shapes load PASS');
