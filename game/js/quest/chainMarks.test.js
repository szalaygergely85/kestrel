// OB-124b: gold '!' at the start entity / '?' at the end entity of the current main-chain step (m1 objective.mark data).
// OB-137a: pickup prompts use the item def name, never a raw id.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createQuestBook } from './sim/questBook.js';
import '../../../design/palette.js';
import '../../../design/items.js';
import { itemLabel } from '../questPickups.js';

const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const m1 = JSON.parse(fs.readFileSync(dir + '/m1.quest.json', 'utf8'));
const boars = JSON.parse(fs.readFileSync(dir + '/burl.boars.quest.json', 'utf8'));
const blade = JSON.parse(fs.readFileSync(dir + '/tower.blade.quest.json', 'utf8'));
const book = createQuestBook(m1, [blade, boars]);
const marks = () => { const a = [], r = []; book.chainMarks(a, r); return [a, r]; };
const feed = (e) => book.feed(e);

// walk the chain up to the waystone step
feed({ type: 'flag:set', key: 'wake', value: true }); feed({ type: 'area:entered', id: 'breach' }); feed({ type: 'item:got', id: 'sword' });
assert.deepEqual(marks(), [[], []], 'leave: no early ? (OB-155i)');
feed({ type: 'area:entered', id: 'towerDoor' }); feed({ type: 'flag:set', key: 'quest.burl.boars.done', value: true }); feed({ type: 'flag:set', key: 'burl.arrived', value: true });
assert.deepEqual(marks(), [[], []], 'waystone step: no early ?');
feed({ type: 'flag:set', key: 'waystone.waystone.woken', value: true });
// road step available: gold ! on Burl
assert.deepEqual(marks(), [['bear'], []], 'road available -> ! on bear');
feed({ type: 'flag:set', key: 'burl.departing', value: true }); // OB-157: Burl handed the step over
assert.deepEqual(marks(), [[], []], 'after the give: no ! on bear, no early ?');
feed({ type: 'area:entered', id: 'roadWest' });
assert.deepEqual(marks(), [[], []], 'road taken -> no early ?');
feed({ type: 'area:entered', id: 'bendRelay' });
assert.deepEqual(marks(), [[], []], 'relay1 active -> no early ?');
feed({ type: 'flag:set', key: 'waystone.ws_roadBend.woken', value: true });
assert.deepEqual(marks(), [[], []], 'chain done -> none');
// every authored mark names a valid id (no raw junk)
for (const o of m1.objectives) if (o.mark) for (const k of ['start', 'end']) if (o.mark[k]) assert.match(o.mark[k], /^[A-Za-z][A-Za-z0-9_.-]*$/);

// OB-137a: prompt label
assert.equal(itemLabel({ signArm: { name: 'Signpost Arm' } }, 'signArm'), 'Signpost Arm');
const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
assert.equal(itemLabel({}, 'signArm'), 'Sign arm'.replace('Sign arm', 'Sign arm')); assert.equal(warned, 1);
console.warn = warn;
const world = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../content/worlds/world_m1.world.json', import.meta.url)), 'utf8'));
const ITEMS = globalThis.ASSETS && globalThis.ASSETS.items;
const items = [...JSON.stringify(world).matchAll(/"questPickup":{"item":"([^"]+)"/g)].map((m) => m[1]);
assert.ok(items.length > 0);
assert.ok(ITEMS && ITEMS.defs, 'items loaded');
for (const id of items) { const l = itemLabel(ITEMS.defs, id); assert.ok(!/[a-z][A-Z]|[._]/.test(l), 'prompt label has a raw id: ' + id + ' -> ' + l); }
console.log('chainMarks OK');

// OB-137 (journal): every quest's reward item and giver resolve to a display name, never a raw id.
{
  const { labelOf } = await import('./errands.js');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(d + '/' + e.name) : e.name.endsWith('.quest.json') ? [d + '/' + e.name] : []);
  let n = 0; const bad = [];
  for (const f of walk(dir)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const it of (d.reward && d.reward.items) || []) { const def = globalThis.ASSETS.items.defs[it.id]; if (!(def && def.name)) bad.push(d.id + ' reward ' + it.id); n++; }
    if (d.giver && d.giver.npc) { const known = ['bear', 'rook', 'hesk', 'dorrin'].includes(d.giver.npc); const l = labelOf(d.giver.npc); if (!known && /[A-Z._]/.test(l)) bad.push(d.id + ' giver ' + d.giver.npc); n++; }
  }
  console.log('journal names checked:', n, 'problems:', bad.join('; ') || 'none');
  assert.equal(bad.length, 0, bad.join('; '));
}
