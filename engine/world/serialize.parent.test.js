// engine/world/serialize.parent.test.js (CO-5 follow-up, docs/coordinates.md
// section 8). Covers the bug serialize.v2.test.js's fixture couldn't reach:
// an entity whose live `parent` is a structure id but whose `id` does NOT
// follow the `<structId>.` dot-prefix convention (e.g. a runtime-spawned
// entity explicitly parented to a structure via `World.spawn`'s own
// `parent` argument, not the `ed.spawn` shorthand). Before this fix,
// `serialize()` recomputed `parent` from the id prefix (always null here)
// instead of reading the entity's own live field, and a restored entity
// always lost its `parent` on the next save because `deserialize()` didn't
// carry it into `def.entities` and `World.load`'s entity loop only ever set
// `parent` inside the `ed.spawn` branch.
//
//   node engine/world/serialize.parent.test.js
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

// A structure at origin.z = -3 (per the CO-5 backlog note), no terrain
// needed - the entity below uses an explicit numeric z, not `'ground'`.
const bundleFixture = await loadContentPack(PACK_MANIFEST, { fetchText: nodeFetchText });
const bundle = {
  ...bundleFixture,
  worlds: {
    tiny_world: {
      name: 'tiny_world',
      structures: [{ id: 'room', level: 'tiny', origin: { x: 0, y: 0, z: -3 }, yawSteps: 0 }],
      entities: [],
    },
  },
};
const assets = AssetRegistry.fromJSON(bundle, codeParts);

const world = World.load(assets.world('tiny_world'), assets, {});

// Spawn a runtime entity parented to "room" WITHOUT a "room."-prefixed id -
// the exact case the old id-prefix heuristic could not see.
world.spawn('debris', { x: 1, y: 2, z: -3, yawDeg: 0, pitchDeg: 0 }, {}, 'sidecar_1', 'room');

ok('the live entity has parent = "room" right after spawn', world.get('sidecar_1').data.parent === 'room');

// ---------------------------------------------------------------------------
// 1. serialize() reads the live field, not the id prefix.
// ---------------------------------------------------------------------------
const state = serialize(world);
const sidecar = state.entities.find((e) => e.id === 'sidecar_1');
ok('serialize records parent = "room" for a non-dot-id entity', !!sidecar && sidecar.parent === 'room');

// ---------------------------------------------------------------------------
// 2. Round trip: parent survives deserialize -> serialize, and the two
// serializations are byte-identical (stringifySave).
// ---------------------------------------------------------------------------
const world2 = deserialize(JSON.parse(JSON.stringify(state)), assets, {});
ok('deserialize restores parent = "room" on the live entity', world2.get('sidecar_1').data.parent === 'room');

const state2 = serialize(world2);
const sidecar2 = state2.entities.find((e) => e.id === 'sidecar_1');
ok('the second serialize still records parent = "room"', !!sidecar2 && sidecar2.parent === 'room');

ok('the two WorldStates deep-equal (parent included)', JSON.stringify(state) === JSON.stringify(state2));

const text1 = stringifySave(state);
const text2 = stringifySave(state2);
ok('stringifySave round trip is byte-identical', text1 === text2);

// A third independent round trip, to rule out ordering flakiness.
const world3 = deserialize(JSON.parse(JSON.stringify(state2)), assets, {});
const text3 = stringifySave(serialize(world3));
ok('a third round trip is still byte-identical', text1 === text3);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
