// engine/world/serialize.contentWins.test.js (QFIX-S6 / OB-155g). A separate file from serialize.test.js (which must stay
// unchanged and green - this only exercises the NEW content-id save rule).
//
//   node engine/world/serialize.contentIds.test.js
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AssetRegistry } from '../core/assets.js';
import { World } from './World.js';
import { serialize, deserialize, stringifySave } from './serialize.js';
import { loadContentPack } from '../content/loadPack.js';
import { makeOk } from '../test/assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_MANIFEST = pathToFileURL(path.join(__dirname, '..', 'content', 'fixtures', 'pack', 'manifest.json')).href;
const nodeFetchText = (u) => readFile(new URL(u), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const fakePalette = { util: { validate: () => [] } };
const codeParts = { palette: fakePalette, models: { torch: { animations: { idle: {} } } }, worlds: {}, levels: {}, uiStyle: null, detailPass: null };

const bundleFixture = await loadContentPack(PACK_MANIFEST, { fetchText: nodeFetchText });
// Bundle A = the content an OLD save was made under; bundle B = current content (structure moved).
const mk = (origin, ents) => AssetRegistry.fromJSON({ ...bundleFixture, worlds: { tiny_world: { name: 'tiny_world',
  structures: [{ id: 'room', level: 'tiny', origin, yawSteps: 0 }], entities: ents } } }, codeParts);
const assetsOld = mk({ x: 0, y: 0, z: 0 }, [{ id: 'npc1', type: 'npc', x: 0, y: 0, z: 0 }]);
const assetsNew = mk({ x: 10, y: 20, z: 0 }, [{ id: 'npc1', type: 'npc', x: 0, y: 0, z: 0 }]);

const w = World.load(assetsOld.world('tiny_world'), assetsOld, {});
w.state['tower.sword.taken'] = true; // a taken flag
const old = JSON.parse(JSON.stringify(serialize(w)));
// Make it an "old-format" save: v2, with stale content-owned fields.
old.version = 2;
const brazier = old.entities.find((e) => e.id === 'room.brazier');
ok('fixture: brazier saved as plain static prop', brazier && brazier.type === 'prop');
const oldComps = Object.keys(brazier.components);
brazier.transform.x = 999; brazier.transform.z = 55; // the floating-item bug
const live = old.entities.find((e) => e.id === 'room.brazier');
old.entities.push({ id: 'room.ghost', type: 'prop', parent: 'room', fromContent: true, transform: { x: 1, y: 1, z: 1, yawDeg: 0, pitchDeg: 0 }, components: { sprite: { model: 'brazier', anim: 'idle', loop: true } } });
old.entities.find((e) => e.id === 'npc1').transform.x = 77; // dynamic-ish npc? has components? kept below
old.removed = [];

const w2 = deserialize(old, assetsNew, {});
const b2 = w2.get('room.brazier').data;
const ref = World.load(assetsNew.world('tiny_world'), assetsNew, {}).get('room.brazier').data;
ok('static prop position comes from CURRENT content, not the save', b2.transform.x === ref.transform.x && b2.transform.z === ref.transform.z && b2.transform.x !== 999, JSON.stringify(b2.transform));
ok('structure origin comes from current content', w2.structures[0].origin.x === 10 && w2.structures[0].origin.y === 20);
ok('a prop content no longer has is dropped', w2.get('room.ghost') === null);
ok('taken flag in world.state survives', w2.state['tower.sword.taken'] === true);
ok('v2 save was migrated (loads without throwing)', !!w2);

// removed ids still win; a removed prop stays removed
const w3 = World.load(assetsOld.world('tiny_world'), assetsOld, {}); w3.remove('room.brazier');
const s3 = JSON.parse(JSON.stringify(serialize(w3))); s3.version = 2;
ok('removed prop stays removed after content-wins load', deserialize(s3, assetsNew, {}).get('room.brazier') === null);

// round trip of a v3 save is stable
const s4 = serialize(deserialize(JSON.parse(JSON.stringify(serialize(w))), assetsOld, {}));
ok('v3 save round-trips byte-stable', stringifySave(s4) === stringifySave(serialize(w)));

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
