// UNDER-03 / OB-191: Ford trade post cellar (real world_m1, mesh physics). Run: node game/js/quest/under/fordCellar.test.mjs
import assert from 'node:assert/strict';
import { validateUnder } from '../../../../engine/index.js';
import { loadM1 } from './loadM1.mjs';
import { FORD_CELLAR, ladderEnd, ladderPrompt, stepFordCellar, bindFordCellarFlags, syncFordCellarFlags, chestKey, NOTE_KEY, markNoteRead } from './fordCellar.js';
import { buildChestDefs } from '../sim/chestDefs.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const { world, groundAt } = await loadM1('mesh');
const st = world.structures.find((s) => s.id === 'fordCellar');
ok(st && st.keepMask, 'site fordCellar placed with keepTerrain');
const errs = validateUnder(world);
ok(errs.length === 0, 'validateUnder: ' + errs.slice(0, 2).join('; '));

const opts = { height: 1.6, stepUpMax: 0.5, walkCos: 0.7 };
const cx = 1001, cy = 1060, g = groundAt(cx, cy), z0 = st.origin.z;
const inside = world.supportAt(cx, cy, z0 + 0.1, true, opts);
ok(Math.abs(inside.floorH - z0) < 0.05 && !inside.terrain, `inside: support is the room floor ${z0} (got ${inside.floorH})`);
const above = world.supportAt(cx, cy, g + 0.2, false, opts);
ok(above.terrain && Math.abs(above.floorH - g) < 1e-6, 'above the room: terrain supports');

// entities
const T = (id) => world.entity(id).transform;
for (const id of ['cellarTrapdoor', 'cellarLadder', 'cellarNote', 'cellarLamp', ...FORD_CELLAR.chests]) ok(world.entity(id), id + ' exists');
ok(Math.abs(T('cellarTrapdoor').z - groundAt(T('cellarTrapdoor').x, T('cellarTrapdoor').y)) < 0.3, 'trapdoor on the surface');
ok(Math.abs(T('cellarLadder').z - z0) < 0.01, 'ladder foot on the cellar floor');
const ids = buildChestDefs(world).map((d) => d.id);
for (const id of FORD_CELLAR.chests) ok(ids.includes(id), id + ' is a chest def');
ok(world.state['under.fordCellar.noteRead'] === false, 'note flag default false');

// ladder: E at the trapdoor goes down after 0.3 s, E at the ladder goes up
const top = T('cellarTrapdoor'), bot = T('cellarLadder');
ok(ladderEnd(world, top.x + 0.5, top.y, top.z) === 'down' && ladderPrompt('down') === '[E] Climb down', 'down end near the trapdoor');
ok(ladderEnd(world, bot.x, bot.y + 0.4, bot.z) === 'up', 'up end near the ladder');
ok(ladderEnd(world, top.x, top.y, bot.z) === 'up' && ladderEnd(world, bot.x, bot.y, top.z) === 'down', 'z picks the layer (cellar xy-under-trapdoor is still the up end)');
ok(ladderEnd(world, top.x + 6, top.y, top.z) === null, 'far away: nothing');
const s = { t: 0, end: null }, feet = { x: top.x, y: top.y + 0.3, z: top.z };
let moved = null; const mv = (x, y, z) => { moved = { x, y, z }; };
ok(stepFordCellar(world, s, 0.016, true, feet, mv) === true && !moved, 'E starts the climb');
ok(stepFordCellar(world, s, 0.2, false, feet, mv) === true && !moved, '0.2 s: still climbing');
ok(stepFordCellar(world, s, 0.12, false, feet, mv) === false && moved, '0.3 s: arrived');
const sup = world.supportAt(moved.x, moved.y, moved.z + 0.05, true, opts);
ok(Math.abs(sup.floorH - z0) < 0.05 && !sup.terrain, 'arrival below stands on the room floor, not on the terrain');
Object.assign(feet, moved); moved = null; s.t = 0;
stepFordCellar(world, s, 0.016, true, feet, mv); stepFordCellar(world, s, 0.3, false, feet, mv);
ok(moved && Math.abs(moved.z - top.z) < 0.01, 'E at the ladder climbs back to the surface');
const up = world.supportAt(moved.x, moved.y, moved.z + 0.05, false, opts);
ok(up.terrain, 'arrival above stands on the terrain');

// save flags
const handlers = {}; const events = { on(k, f) { handlers[k] = f; return () => {}; } };
bindFordCellarFlags(world, events);
handlers['chest:opened']({ id: 'chestCellar2' }); handlers['chest:opened']({ id: 'chestMeadow' });
ok(world.state[chestKey('chestCellar2')] === true && !world.state['under.fordCellar.chest.chestMeadow'], 'looted crate flagged, other chests ignored');
markNoteRead(world); ok(world.state[NOTE_KEY] === true, 'note read flag');
const saved = JSON.parse(JSON.stringify(world.state));
world.state[chestKey('chestCellar2')] = false; world.state[chestKey('chestCellar1')] = false;
syncFordCellarFlags(world, ['chestCellar1', 'chestCellar2']);
ok(world.state[chestKey('chestCellar1')] && world.state[chestKey('chestCellar2')] && saved[NOTE_KEY], 'flags restored from the opened-chest list');
console.log(`fordCellar.test: ${n} checks ok`);
