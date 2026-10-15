// EP-SPELLS SPELL-09: Spell Book placement lint + pickup learns once + waystone wake grants (real content).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../design/palette.js';
import '../../design/items.js';
import { loadQuestFiles, loadPackQuests } from '../../tools/validate-content.mjs';
import { normalizeQuestDef } from './quest/sim/questFormat.js';
import { CHEST_TABLES } from './quest/sim/chestDefs.js';
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

// AC1 lint on the real content: 0 findings; no Spell Book item or placement remains (D-115: spells are the 4 of D-021)
assert.deepEqual(lintSpellPlacements(CHEST_TABLES, rewards, items), []);
assert.equal(PLACEMENTS.freeze.kind, 'unplaced'); assert.equal(PLACEMENTS.teleport.kind, 'unplaced'); assert.equal(PLACEMENTS.telekinesis.rule, 'thirdNear');
assert.deepEqual(Object.keys(PLACEMENTS), [...SPELL_IDS]);
assert.deepEqual(Object.keys(items).filter((k) => k.startsWith('book.spell.')), [], 'no book items');
assert.deepEqual(Object.keys(items).filter((k) => /^spell\.(spark|gust|ward|lightOrb|fireRing|updraft)$/.test(k)), [], 'no retired spell items');
assert.equal(spellOfBook('book.spell.telekinesis'), 'telekinesis'); assert.equal(spellOfBook('book.spell.gust'), null); assert.equal(spellOfBook('book.spell.nope'), null);
// lint catches: a book for a spell that has none, an unknown id
assert.ok(lintSpellPlacements({ ...CHEST_TABLES, chestCrypt: { fixed: [{ item: 'book.spell.freeze', n: 1 }], weighted: [] } }, rewards, items).some((m) => /freeze/.test(m)), 'freeze is unplaced: no book allowed');
assert.ok(lintSpellPlacements({ ...CHEST_TABLES, chestCrypt: { fixed: [{ item: 'book.spell.nope', n: 1 }], weighted: [] } }, rewards, items).some((m) => /nope/.test(m)));
for (const c of ['chestGoblinTunnel', 'chestStrandCave']) assert.ok(!CHEST_TABLES[c].fixed.some((f) => f.item.startsWith('book.spell.')), c + ' holds no book');
assert.ok(CHEST_TABLES.chestBearDen.fixed.some((f) => f.item === 'scroll.spell'));
assert.ok(!(rewards.get('mq.ford.mirror') || []).some((i) => i.startsWith('book.spell.')), 'Ward reward removed from mq.ford.mirror');
// no retired spell code or ids left in game/js (spellBooks.js / spellBookHook.js keep the generic book.spell. prefix for future use)
{
  const { readdirSync, statSync } = await import('node:fs'); const hits = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const f = d + '/' + n; if (statSync(f).isDirectory()) walk(f); else if (/\.(js|mjs)$/.test(n) && !/\.test\.m?js$/.test(n)) { const t = readFileSync(f, 'utf8'); if (/createWardSim|createFireRingSim|createLightOrbSim|'spell\.(spark|lightOrb|ward|fireRing|gust|updraft)'|book\.spell\.(spark|lightOrb|ward|fireRing|gust|updraft)/.test(t)) hits.push(f); } } };
  walk(fileURLToPath(new URL('game/js', root))); assert.deepEqual(hits, [], 'retired spell references');
}
// near/far id sets match the real world file's waystones (side per the river, riverBand.test.js)
const world = JSON.parse(readFileSync(new URL('content/worlds/world_m1.world.json', root), 'utf8'));
const wsIds = world.entities.filter((e) => e.components && e.components.waystone).map((e) => e.components.waystone.id);
for (const id of [...NEAR_SIDE, ...FAR_REGION]) assert.ok(wsIds.includes(id), 'waystone ' + id);

// AC2 a Spell Book in the pack (if one ever exists) still learns once; a 2nd copy is the "already know" line
const player = { transform: {}, components: {} };
const inv = ensureInventory(player, { pack: [], left: null, right: null });
const st = {}, book = createSpellBook(st);
const defsWithBook = { ...items, 'book.spell.teleport': { id: 'book.spell.teleport', name: 'Spell Book: Teleport', kind: 'upgrade', stackMax: 1 } };
import('./quest/sim/inventory.js').then(async ({ addItem }) => {
  addItem(inv, defsWithBook, 'book.spell.teleport', 1);
  assert.deepEqual(readBooks(inv, book, st), ['You learn Teleport.']); assert.equal(book.tier('teleport'), 1); assert.equal(countOf(inv, 'book.spell.teleport'), 0);
  assert.deepEqual(readBooks(inv, book, st), [], 'nothing left to read');
  addItem(inv, defsWithBook, 'book.spell.teleport', 1);
  assert.deepEqual(readBooks(inv, book, st), ['You already know Teleport.']);
  // waystone wakes: 3rd near-side -> Telekinesis, once; survives a "reload" (same state, new book); a far waystone teaches nothing now
  const w = (...ids) => Object.fromEntries(ids.map((i) => ['waystone.' + i + '.woken', true]));
  assert.deepEqual(wakeGrants(w('waystone', 'ws_roadBend')), []);
  assert.deepEqual(wakeGrants(w('waystone', 'ws_roadBend', 'ws_ford', 'ws_outwall')), [], 'ford/outwall are far story relays');
  const s2 = { ...w('waystone', 'ws_roadBend', 'ws_northwood') }, b2 = createSpellBook(s2);
  assert.deepEqual(readBooks(null, b2, s2), ['You learn Telekinesis.']); assert.deepEqual(readBooks(null, b2, s2), []);
  Object.assign(s2, w('ws_highPastures')); assert.deepEqual(readBooks(null, b2, s2), [], 'a far waystone teaches nothing');
  const reload = createSpellBook(JSON.parse(JSON.stringify(s2))); assert.deepEqual(readBooks(null, reload, s2), [], 'Continue: no second grant');
  { const h = { freeze: 'Look into the dry well.', telekinesis: 'Wake more waystones.', teleport: 'Help Rook at the ford.', fireball: 'Ask Burl.' }; for (const k in h) if (learnHint(k) !== h[k]) throw new Error('learnHint ' + k + ' = ' + learnHint(k)); if (/esc/i.test(Object.keys(h).map(learnHint).join(' '))) throw new Error('hint mentions Esc'); }
  console.log('spellBooks.test ok');
});
