// EP-SPELLS SPELL-09: Spell Book placement lint + pickup learns once + waystone wake grants (real content).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../design/palette.js';
import '../../design/items.js';
import { loadQuestFiles, loadPackQuests } from '../../tools/validate-content.mjs';
import { normalizeQuestDef } from './quest/sim/questFormat.js';
import { CHEST_TABLES } from './quest/sim/chestDefs.js';
import { createChests } from './quest/sim/chest.js';
import { ensureInventory, countOf } from './quest/sim/inventory.js';
import { createSpellBook } from './quest/sim/spellBook.js';
import { SPELL_IDS } from './quest/spellDefs.js';
import { lintSpellPlacements, PLACEMENTS, NEAR_SIDE, FAR_REGION, wakeGrants, bookId, spellOfBook, learnHint } from './quest/sim/spellBooks.js';
import { readBooks } from './spellBookHook.js';

const items = globalThis.ASSETS.items.defs;
const root = new URL('../../', import.meta.url);
const dir = fileURLToPath(new URL('content/quests', root));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, items);
const rewards = new Map();
for (const q of [...files.quests, ...packs.quests]) { const d = normalizeQuestDef(q.def); if (d.reward && d.reward.items) rewards.set(d.id, d.reward.items.map((i) => i.id)); }

// AC1 lint on the real content: 0 findings; Updraft and Fireball carry no book anywhere
assert.deepEqual(lintSpellPlacements(CHEST_TABLES, rewards, items), []);
assert.equal(PLACEMENTS.updraft.kind, 'unplaced');
for (const id of SPELL_IDS) if (id !== 'updraft') assert.ok(id === 'fireball' || items[bookId(id)], 'book item ' + id);
assert.equal(spellOfBook('book.spell.gust'), 'gust'); assert.equal(spellOfBook('book.spell.nope'), null);
// lint catches: duplicate source, unknown id, a book in the wrong chest
const dup = { ...CHEST_TABLES, chestCrypt: { fixed: [{ item: 'book.spell.spark', n: 1 }], weighted: [] } };
assert.ok(lintSpellPlacements(dup, rewards, items).some((m) => /spark/.test(m)), 'spark in a chest AND wake');
assert.ok(lintSpellPlacements({ ...CHEST_TABLES, chestCrypt: { fixed: [{ item: 'book.spell.nope', n: 1 }], weighted: [] } }, rewards, items).some((m) => /nope/.test(m)));
assert.ok(lintSpellPlacements({ ...CHEST_TABLES, chestStrandCave: { fixed: [], weighted: [] } }, rewards, items).some((m) => /lightOrb/.test(m)), 'missing source');
// earned spots, not doors: the book chests are the guarded stashes; plain names
assert.deepEqual(['chestGoblinTunnel', 'chestStrandCave'].map((c) => CHEST_TABLES[c].fixed.filter((f) => f.item.startsWith('book.spell.')).map((f) => f.item)), [['book.spell.fireRing'], ['book.spell.lightOrb']]);
assert.ok(CHEST_TABLES.chestBearDen.fixed.some((f) => f.item === 'scroll.spell'));
assert.equal(items['book.spell.lightOrb'].name, 'Spell Book: Light Orb');
// near/far id sets match the real world file's waystones (side per the river, riverBand.test.js)
const world = JSON.parse(readFileSync(new URL('content/worlds/world_m1.world.json', root), 'utf8'));
const wsIds = world.entities.filter((e) => e.components && e.components.waystone).map((e) => e.components.waystone.id);
for (const id of [...NEAR_SIDE, ...FAR_REGION]) assert.ok(wsIds.includes(id), 'waystone ' + id);

// AC2 a real chest hands over the book; reading learns once; a 2nd copy is the "already know" line
const player = { transform: {}, components: {} };
const inv = ensureInventory(player, { pack: [], left: null, right: null });
const d = { id: 'c', x: 0, y: 0, z: 0, frontX: 0, frontY: 1, propId: 'c', interact: { radius: 2, facingDeg: 70, facingCos: 0.342 }, table: CHEST_TABLES.chestStrandCave };
const sim = createChests([d], { items, inventoryOf: () => inv, events: { emit() {} }, seed: 1 });
assert.equal(sim.open('c', { x: 0, y: 1, z: 0, forwardX: 0, forwardY: -1, onBottom: true }), true); sim.step(1);
assert.equal(countOf(inv, 'book.spell.lightOrb'), 1);
const st = {}, book = createSpellBook(st);
assert.deepEqual(readBooks(inv, book, st), ['You learn Light Orb.']);
assert.equal(book.tier('lightOrb'), 1); assert.equal(countOf(inv, 'book.spell.lightOrb'), 0);
assert.deepEqual(readBooks(inv, book, st), [], 'nothing left to read');
import('./quest/sim/inventory.js').then(async ({ addItem }) => {
  addItem(inv, items, 'book.spell.lightOrb', 1);
  assert.deepEqual(readBooks(inv, book, st), ['You already know Light Orb.']); assert.equal(book.tier('lightOrb'), 1);
  // waystone wakes: 3rd near-side -> Spark, first far region -> Gust, once; survives a "reload" (same state, new book)
  const w = (...ids) => Object.fromEntries(ids.map((i) => ['waystone.' + i + '.woken', true]));
  assert.deepEqual(wakeGrants(w('waystone', 'ws_roadBend')), []);
  assert.deepEqual(wakeGrants(w('waystone', 'ws_roadBend', 'ws_ford', 'ws_outwall')), [], 'ford/outwall are far story relays');
  const s2 = { ...w('waystone', 'ws_roadBend', 'ws_northwood') }, b2 = createSpellBook(s2);
  assert.deepEqual(readBooks(null, b2, s2), ['You learn Spark.']); assert.deepEqual(readBooks(null, b2, s2), []);
  Object.assign(s2, w('ws_highPastures')); assert.deepEqual(readBooks(null, b2, s2), ['You learn Gust.']);
  const reload = createSpellBook(JSON.parse(JSON.stringify(s2))); assert.deepEqual(readBooks(null, reload, s2), [], 'Continue: no second grant');
  { const h = { fireRing: 'Find its Spell Book.', lightOrb: 'Find its Spell Book.', spark: 'Wake more waystones.', gust: 'Wake a waystone across the river.', ward: 'Help Rook at the ford.', updraft: null }; for (const k in h) if (learnHint(k) !== h[k]) throw new Error('learnHint ' + k + ' = ' + learnHint(k)); if (/esc/i.test(Object.keys(h).map(learnHint).join(' '))) throw new Error('hint mentions Esc'); }
  console.log('spellBooks.test ok');
});
