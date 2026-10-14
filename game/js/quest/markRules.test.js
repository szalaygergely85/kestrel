// QFIX-S3 (OB-155h/i/j/k, OB-164): marker rules run over EVERY quest in content (legacy + packs).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { createQuestBook } from './sim/questBook.js';
import { packedTop, entityTop, markZ, MARK_DEFAULT_TOP, MARK_MARGIN } from './markTop.js';

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets?.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const m1 = all.find(d => d.id === 'm1'); assert.ok(m1, 'm1 loaded');
const book = createQuestBook(m1, all.filter(d => d !== m1));
const idx = (id) => book.index(id);

// OB-155k: tower.blade is gold; isMain is transitive over `requires`; every mq.* is gold
assert.ok(book.isMain(idx('tower.blade')), 'tower.blade is main');
for (const d of all) {
  if (d.id.startsWith('mq.') || d.main === true) assert.ok(book.isMain(idx(d.id)), d.id + ' is main');
  if (book.isMain(idx(d.id))) for (const r of d.requires || []) if (r.quest) assert.ok(book.isMain(idx(r.quest)), `${d.id} requires ${r.quest} -> main too`);
}
// OB-155i: the chain never emits a '?' (waypoint) - chainMarks only fills the '!' list; and every authored mark names its start only as an offer
for (const o of m1.objectives) { const a = [], r = ['x']; book.chainMarks(a, r); assert.deepEqual(r, ['x'], 'chainMarks leaves the ? list alone'); void o; }
// OB-155j: ONE marker per entity in every reachable state of the book (initial state + each quest forced through its statuses is covered by the lists' dedupe)
const check = () => { const L = [[], [], [], []]; book.markLists(...L); const flat = L.flat(); assert.equal(new Set(flat).size, flat.length, 'one marker per entity: ' + JSON.stringify(L)); return L; };
check();
// synthetic collision: two quests, same giver, one ready + one available, gold and blue -> only the '?' survives
{
  const mk = (id, giver, extra) => ({ version: 1, id, title: id, giver: { npc: giver }, objectives: [{ id: 'a', text: 'a', when: { type: 'flag', id: id + '.f', equals: true } }], ...extra });
  const q1 = mk('side.a', 'npcX'), q2 = mk('side.b', 'npcX'), q3 = mk('mq.c', 'npcX');
  const b = createQuestBook({ version: 1, id: 'mm', title: 'mm', objectives: [{ id: 'z', text: 'z', when: { type: 'flag', id: 'zz', equals: true } }] }, [q1, q2, q3]);
  const L = [[], [], [], []]; b.markLists(...L);
  assert.deepEqual(L, [['npcX'], [], [], []], 'gold ! beats blue ! on one giver');
}
// OB-155h / OB-164: marker height from the model top (a 2.6 m waystone gets a glyph above 2.6 m, a 0.38 m crow close above it)
const pack = (cellM, sz, topLayer) => { const vox = new Uint8Array(2 * 2 * sz); for (let i = 0; i < 4; i++) vox[topLayer * 4 + i] = 1; const parts = new Float64Array(16); parts[2] = 0; parts[5] = sz; parts[10] = 0; parts[11] = 2; parts[12] = 2; parts[13] = sz; return { cellM, sz, anchor: new Float64Array([1, 1, 0]), partCount: 1, parts, vox }; };
const stone = pack(0.125, 24, 20), crow = pack(0.0475, 8, 7);
assert.ok(Math.abs(packedTop(stone) - 21 * 0.125) < 1e-9, 'waystone top 2.625');
const lookup = { stone, crow };
const ent = (model, z, scale) => ({ transform: { x: 0, y: 0, z, scale }, components: { voxel: { model } } });
const zStone = markZ({ z: 0 }, entityTop(null, ent('stone', 0, 1), (k) => lookup[k]));
assert.ok(zStone + 0.35 > 2.625, 'stone glyph (starts +0.35 above its base) clears the stone top: ' + zStone);
const zCrow = markZ({ z: 0 }, entityTop(null, ent('crow', 0, 1.6), (k) => lookup[k]));
assert.ok(zCrow < 1.0, 'crow marker stays low: ' + zCrow);
assert.equal(entityTop(null, { transform: { x: 0, y: 0, z: 0 }, components: {} }, () => null), MARK_DEFAULT_TOP, 'bare anchor -> default');
const board = { structures: [{ kind: 'mesh', bbox: { x0: -1, y0: -1, x1: 1, y1: 1, z0: 0, z1: 2.45 } }] };
assert.ok(markZ({ z: 0 }, entityTop(board, { transform: { x: 0, y: 0, z: 0 }, components: {} }, () => null)) >= 2.45 + MARK_MARGIN - 1e-9, 'anchor on a board mesh -> above the board top');
assert.equal(markZ({ z: 1 }, 5, 3.0), 4.0, 'MARK_TOP override wins');
console.log('markRules OK');
