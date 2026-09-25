// engine/world/serialize.contentIds.test.js (US-027a, docs/architecture.md
// 21.8/21.10 S5). A separate file from serialize.test.js (which must stay
// unchanged and green - this only exercises the NEW content-id save rule).
//
//   node engine/world/serialize.contentIds.test.js
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AssetRegistry } from '../core/assets.js';
import { World } from './World.js';
import { serialize, deserialize } from './serialize.js';
import { loadContentPack } from '../content/loadPack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_MANIFEST = pathToFileURL(path.join(__dirname, '..', 'content', 'fixtures', 'pack', 'manifest.json')).href;
const nodeFetchText = (u) => readFile(new URL(u), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const fakePalette = { util: { validate: () => [] } };
const codeParts = { palette: fakePalette, models: { torch: { animations: { idle: {} } } }, worlds: {}, levels: {}, uiStyle: null, detailPass: null };

// Bundle A: the "current" content the world is first loaded from - the
// fixture's `tiny` level (a `brazier` prop) placed as structure "room",
// plus a world-authored entity `npc1`.
const bundleFixture = await loadContentPack(PACK_MANIFEST, { fetchText: nodeFetchText });
const bundleA = {
  ...bundleFixture,
  worlds: {
    tiny_world: {
      name: 'tiny_world',
      structures: [{ id: 'room', level: 'tiny', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }],
      entities: [{ id: 'npc1', type: 'npc', x: 0, y: 0, z: 0 }],
    },
  },
};
const assetsA = AssetRegistry.fromJSON(bundleA, codeParts);

const world = World.load(assetsA.world('tiny_world'), assetsA, {});
ok('world picked up contentVersion from assets', world.contentVersion === assetsA.contentVersion);
ok('room.brazier prop tagged as a content id', world._contentIds.has('room.brazier'));
ok('npc1 world entity tagged as a content id', world._contentIds.has('npc1'));

// Remove a content prop, and spawn an unrelated runtime entity (no content id).
world.remove('room.brazier');
world.spawn('debris', { x: 1, y: 1, z: 0, yawDeg: 0, pitchDeg: 0 }, {}, 'debris_1');

const state = serialize(world);
ok('serialize writes contentVersion when content-backed', state.contentVersion === assetsA.contentVersion);
ok('serialize records the removed prop', Array.isArray(state.removed) && state.removed.includes('room.brazier'));
ok('serialize tags the content entity fromContent', !!state.entities.find((e) => e.id === 'npc1').fromContent);
ok('serialize does not tag the runtime entity fromContent', !state.entities.find((e) => e.id === 'debris_1').fromContent);
ok('the removed prop is not in state.entities', !state.entities.find((e) => e.id === 'room.brazier'));

// Bundle B: content changed - npc1 deleted, npc2 added. Same level/prop.
const bundleB = {
  ...bundleFixture,
  worlds: {
    tiny_world: {
      name: 'tiny_world',
      structures: [{ id: 'room', level: 'tiny', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }],
      entities: [{ id: 'npc2', type: 'npc', x: 5, y: 5, z: 0 }],
    },
  },
};
const assetsB = AssetRegistry.fromJSON(bundleB, codeParts);

const warnCalls = [];
const origWarn = console.warn;
console.warn = (...args) => warnCalls.push(args.join(' '));
let world2;
try {
  world2 = deserialize(JSON.parse(JSON.stringify(state)), assetsB, {});
} finally {
  console.warn = origWarn;
}

const dropWarnings = warnCalls.filter((m) => m.includes('deserialize: dropped'));
ok('the deleted content entity (npc1) is gone', world2.get('npc1') === null);
ok('exactly one drop warning was logged for the whole load', dropWarnings.length === 1, JSON.stringify(warnCalls));
ok('the warning names the dropped id', dropWarnings[0] && dropWarnings[0].includes('npc1'));
ok('the new content entity (npc2) exists', world2.get('npc2') !== null);
ok('the removed prop stays removed', world2.get('room.brazier') === null);
ok('a runtime-spawned entity survives the reload', world2.get('debris_1') !== null);
ok('world2 keeps the removed set for a further save', Array.from(world2._removedContent).includes('room.brazier'));

// A save with no contentVersion (old-style / fromGlobals) is untouched by
// this rule - deserialize must not even ask `assets.has('world', ...)`.
{
  const plainState = { ...state };
  delete plainState.contentVersion;
  delete plainState.removed;
  for (const e of plainState.entities) delete e.fromContent;
  const world3 = deserialize(JSON.parse(JSON.stringify(plainState)), assetsB, {});
  // No content rule at all (pre-existing behaviour, unchanged by this
  // story): `room.brazier` isn't in the saved entities, so World.load's
  // ordinary prop-spawn loop just spawns it fresh from the level - a
  // save's removal of a level prop was never durable without contentVersion.
  ok('no-contentVersion save falls back to ordinary prop-spawn (respawns room.brazier)', world3.get('room.brazier') !== null);
  ok('no-contentVersion save keeps whatever entities were saved (npc1, not npc2)', world3.get('npc1') !== null && world3.get('npc2') === null);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
