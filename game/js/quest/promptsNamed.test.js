// OB-054b: no interactable prompt is a bare verb ("[E] Inspect"): every prompt names its object, <= 28 chars, no Esc hint.
// Checks the data prompts (tower level json, inspect table) and the errands-generated ones on the real world_m1.
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { World } from '../../../engine/index.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { createErrands, labelOf, promptFor } from './errands.js';

const root = new URL('../../../', import.meta.url);
const html = await readFile(new URL('game/index.html', root), 'utf8');
globalThis.window = globalThis;
for (const m of html.matchAll(/<script\b[^>]*\bsrc="(\.\.\/design\/[^"?]+)"/g)) {
  const url = new URL(m[1], new URL('game/index.html', root));
  if (m[1].startsWith('../design/local/')) { try { await access(url); } catch { continue; } }
  await import(url.href);
}
const BARE = /^\[E\] (Use|Take|Inspect|Read|Open|Close|Pick|Talk|Loot|Look|Touch|Wake|Pull|Examine)$/;
const bad = [];
const check = (where, p) => { if (typeof p === 'string' && p && (BARE.test(p) || p.length > 28 || /esc/i.test(p) || !p.startsWith('[E] '))) bad.push(where + ': ' + JSON.stringify(p)); };

// 1. helpers
assert.equal(promptFor('Inspect', labelOf('canvasHeap')), '[E] Inspect canvas heap');
assert.ok(promptFor('Inspect', 'a very long object name indeed').length <= 28);

// 2. static data: tower interactables + look-at table
const tower = JSON.parse(await readFile(new URL('content/levels/tower.level.json', root), 'utf8'));
for (const i of tower.interactables || []) for (const k of ['prompt', 'openPrompt', 'closePrompt']) check('tower.' + i.id + '.' + k, i[k]);
const tbl = JSON.parse(await readFile(new URL('content/dialogue/inspect.json', root), 'utf8'));
for (const [k, t] of Object.entries(tbl.texts)) check('inspect.' + k, t.prompt);

// 3. errands-generated prompts on the real world with a book built from every quest def
const defs = [];
const walk = async (dir) => { for (const e of await readdir(dir, { withFileTypes: true })) { const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir); if (e.isDirectory()) await walk(u); else if (/\.quest\.json$/.test(e.name)) defs.push(JSON.parse(await readFile(u, 'utf8'))); else if (e.name === 'pack.json') defs.push(...JSON.parse(await readFile(u, 'utf8')).quests); } };
await walk(new URL('content/quests/', root));
const { assets } = await loadTestAssets();
const world = World.load(assets.world('world_m1'), assets);
defs.push({ giver: { npc: 'post', turnIn: 'notePost' } }); // pack.json quests get their giver at book build time: stand-in for the two object givers (post, notePost)
const book = { count: defs.length + 1, def: (i) => defs[i - 1], statusOf: () => 0, packOps: null };
const er = createErrands({ getBook: () => book, questFlag() {}, inspect() {}, texts: tbl });
er.load(world);
let n = 0;
for (const r of world.interactables) { n++; check('world.' + r.key, r.prompt); }
assert.ok(world.interactables.some((r) => r.key === 'qi.notePost'), 'generic object-giver anchors present (qi.notePost)');
assert.deepEqual(bad, [], 'bare/oversize prompts:\n' + bad.join('\n'));
console.log('promptsNamed.test.js: OK (' + n + ' world interactables)');
