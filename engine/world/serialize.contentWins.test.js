// QFIX-S6 (OB-155g): on load, CONTENT wins for content-owned entities + structures.
//   node engine/world/serialize.contentWins.test.js
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AssetRegistry } from '../core/assets.js';
import { World } from './World.js';
import { serialize, deserialize } from './serialize.js';
import { loadContentPack } from '../content/loadPack.js';
import { makeOk } from '../test/assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK = pathToFileURL(path.join(__dirname, '..', 'content', 'fixtures', 'pack', 'manifest.json')).href;
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const codeParts = { palette: { util: { validate: () => [] } }, models: { torch: { animations: { idle: {} } } }, worlds: {}, levels: {}, uiStyle: null, detailPass: null };
const fx = await loadContentPack(PACK, { fetchText: (u) => readFile(new URL(u), 'utf8') });
const mk = (npc, origin) => AssetRegistry.fromJSON({ ...fx, worlds: { w: { name: 'w',
  structures: [{ id: 'room', level: 'tiny', origin, yawSteps: 0 }],
  entities: [{ id: 'npc1', type: 'npc', x: npc.x, y: npc.y, z: 0, components: npc.components },
             { id: 'crate', type: 'crate', x: 3, y: 3, z: 0, components: { body: { radius: 0.3 } } }] } } }, codeParts);

// OLD content, then save.
const oldA = mk({ x: 1, y: 1, components: { sprite: { model: 'torch', anim: 'idle', frame: 0 } } }, { x: 0, y: 0, z: 0 });
const w1 = World.load(oldA.world('w'), oldA, {});
w1.entity('crate').transform.x = 9; // sim moved it
const saved = JSON.parse(JSON.stringify(serialize(w1)));
saved.version = 2; // a pre-QFIX-S6 save

// NEW content: npc moved + model changed, structure moved.
const cur = mk({ x: 7, y: 8, components: { voxel: { model: 'torch' } } }, { x: 2, y: 0, z: 0 });
const w2 = deserialize(saved, cur, {});
const n = w2.entity('npc1');
ok('content position wins (npc1)', n.transform.x === 7 && n.transform.y === 8, JSON.stringify(n.transform));
ok('content model wins (no stale sprite)', n.components.sprite === undefined && !!n.components.voxel);
ok('content structure origin wins', w2.structures.find((s) => s.id === 'room').origin.x === 2);
ok('sim-owned body entity keeps its saved position', w2.entity('crate').transform.x === 9);
ok('migrated v2 save loads at v3', serialize(w2).version === 3);
// SWIM-SAVE-01: water inputs never travel into a save; a reload re-creates them as NaN.
{
  const b = w2.entity('crate').components.body;
  b.waterZ = 3.5; b.waterFloorZ = 1; b.swimming = true;
  const st = JSON.parse(JSON.stringify(serialize(w2)));
  const sb = st.entities.find((e) => e.id === 'crate').components.body;
  ok('waterZ/waterFloorZ not serialized', !('waterZ' in sb) && !('waterFloorZ' in sb) && sb.swimming === true);
  const w3 = deserialize(st, cur, {});
  ok('reload leaves water inputs unset (no stale value)', w3.entity('crate').components.body.waterZ === undefined);
}
// REV-S6: content-only changes against a save.
{
  const mk2 = (structs, ents) => AssetRegistry.fromJSON({ ...fx, worlds: { w: { name: 'w', structures: structs, entities: ents } } }, codeParts);
  const rooms = [{ id: 'room', level: 'tiny', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }, { id: 'room2', level: 'tiny', origin: { x: 20, y: 0, z: 0 }, yawSteps: 0 }];
  const chest = (x, y, z) => ({ id: 'chest', type: 'prop', x, y, z, components: { voxel: { model: 'torch', anim: 'closed', frame: 0 }, door: { state: 'closed' } } });
  const old = mk2(rooms, [chest(5, 5, 0), { id: 'rock', type: 'prop', x: 8, y: 8, z: 0, components: {} }]);
  const w = World.load(old.world('w'), old, {});
  const c = w.entity('chest').components;
  c.voxel.anim = 'open'; c.voxel.frame = 2; c.door.state = 'open'; c.health = { hp: 3 };
  const sv = JSON.parse(JSON.stringify(serialize(w)));
  // (a) structure removed, (b) rock re-grounded at the same x/y, (c) chest moved in content
  const nw = mk2([rooms[0]], [chest(6, 6, 0), { id: 'rock', type: 'prop', x: 8, y: 8, z: 2, components: {} }]);
  const w2 = deserialize(sv, nw, {});
  ok('removed-from-content structure is gone after load', !w2.structures.some((s) => s.id === 'room2') && w2.structures.some((s) => s.id === 'room'));
  ok('same x/y, changed content z takes the content z', w2.entity('rock').transform.z === 2, String(w2.entity('rock').transform.z));
  const m = w2.entity('chest');
  ok('moved content entity: content position', m.transform.x === 6 && m.transform.y === 6);
  ok('moved content entity keeps saved voxel anim/frame', m.components.voxel.anim === 'open' && m.components.voxel.frame === 2);
  ok('moved content entity keeps saved door state + health', m.components.door.state === 'open' && m.components.health && m.components.health.hp === 3);
}
if (fail) { console.error(failures.join('\n')); process.exit(1); }
console.log(`serialize.contentWins: ${pass} passed`);
