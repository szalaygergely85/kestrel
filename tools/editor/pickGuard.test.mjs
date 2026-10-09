// ED-WG-01c: stale async pick is dropped (doc edit / camera move / newer click between click and resolve),
// plus the headless .vox import -> place -> move path on the editor doc model (ex ED-MESH-1d, no rendering).
import { makeOk } from '../../engine/test/assert.js';
import { VoxelPool } from '../../engine/index.js';
import { pickAt } from './pick.js';
import { makePickGuard } from './pickGuard.js';
import { makeInsertRecord, makeFieldEditRecord, applyEdit, invert } from './commands.js';
import { parseVox, buildVoxelModel, usedPaletteEntries } from '../voxParse.js';
import { autoMapColors } from '../voxAutoMap.js';
import { makeVoxCube } from './voxImportFixture.mjs';
import paletteMod from '../../design/palette.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- stale pick ----
const cam = { x: 0, y: 0, z: 2, yaw: 0, pitch: 0, fov: 60 };
let release;
const gate = new Promise((r) => { release = r; });
const sky = { kind: 0, face: 0, mat: 0, planeId: 0, depth: Infinity };
const ctx = { cam, cols: 8, rows: 6, pxCellW: 8, pxCellH: 16, world: null, assets: null, fb: null,
  voxelPool: null, renderer: 'mesh', readSurface: async () => { await gate; return sky; } };
let worldStamp = 'w1';
const guard = makePickGuard(() => worldStamp);
async function click() {
  const t = guard.begin();
  const r = await pickAt(3, 3, ctx);
  return guard.isStale(t) ? null : r;
}
let p = click(); guard.bump(); release(); // doc edit between click and resolve
ok('doc edit between click and async result -> dropped', (await p) === null);
const p2 = click(); worldStamp = 'w2'; // world rebuild
ok('world rebuild -> dropped', (await p2) === null);
const p3 = click(); const p4 = click(); // newer click supersedes the older one
const [r3, r4] = [await p3, await p4];
ok('older of two clicks dropped, newest kept', r3 === null && r4 && r4.kind === 'sky');
ok('no edit -> result delivered', (await click())?.kind === 'sky');

// ---- .vox import -> place -> move on the doc model ----
const parsed = parseVox(makeVoxCube(16));
const map = autoMapColors(usedPaletteEntries(parsed.voxels, parsed.palette), paletteMod);
const def = buildVoxelModel(parsed, map, 0.05, null, { parts: false });
const store = new Map(); const ids = new Map();
const reg = { keys: () => [...store.keys()], model: (k) => store.get(k), add: (_k, key, d) => store.set(key, d) };
const pool = new VoxelPool(); const table = { idFor: (k) => { if (!ids.has(k)) ids.set(k, ids.size + 1); return ids.get(k); } };
pool.bind(reg, table); pool.renderer = 'mesh';
reg.add('model', 'probe16', { name: 'probe16', voxel: def }); pool.bind(reg, table);
ok('import packs model', pool.models.has('probe16'));
const doc = { worldId: 'w', files: new Map([['world/w', { kind: 'world', id: 'w', def: { entities: [] }, meta: { nextId: 1 }, dirty: false, handle: null }]]) };
const snap = () => JSON.stringify(doc.files.get('world/w').def);
const before = snap();
const item = { id: 'e1', components: { voxel: { model: 'probe16' }, transform: { x: 1, y: 2, z: 0 } } };
const place = makeInsertRecord('world/w', 'entities', item);
applyEdit(doc, place);
const placed = doc.files.get('world/w').def.entities[0];
ok('placed entity references imported model', placed?.components.voxel.model === 'probe16');
const afterPlace = snap();
const move = makeFieldEditRecord('move', 'world/w', 'entities', placed, 0, { components: { ...placed.components, transform: { x: 4, y: 5, z: 0 } } });
applyEdit(doc, move);
const moved = doc.files.get('world/w').def.entities[0];
ok('move changes transform, keeps model', moved.components.transform.x === 4 && moved.components.voxel.model === 'probe16');
applyEdit(doc, invert(move));
ok('undo move restores placed state', snap() === afterPlace);
applyEdit(doc, invert(place));
ok('undo place restores authored world', snap() === before);

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
console.log('ALL PASS');
