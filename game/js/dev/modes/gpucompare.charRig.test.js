// RIG-GC-01: the gpucompare `charRig` row is listed once, uses a fixed recipe, sets the jaw partRot, and its character builds in Node.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composeCharacter, meshCharacter, collapseRig, riggedModelDef, VoxelPool } from '../../../../engine/index.js';

const src = fs.readFileSync(new URL('./gpucompare.js', import.meta.url), 'utf8');
assert.strictEqual((src.match(/name: 'world_m1: charRig /g) || []).length, 1, 'one charRig row');
const i = src.indexOf("name: 'world_m1: charRig ");
const row = src.slice(i, i + 1400);
assert.ok(/meshOnly: true/.test(src.slice(i - 200, i)) && /addRy = 30/.test(row) && /partIndex\.jaw/.test(row), 'mesh only, jaw partRot set');
assert.ok(!/Math\.random|Date\.now|performance\.now/.test(row), 'no randomness / clock');
assert.ok(/composeCharacter\(gcKit, gcKit\.defaults\)/.test(src) && /'char\.gc'/.test(src), 'fixed default recipe registered as char.gc');

const kit = JSON.parse(fs.readFileSync(new URL('../../../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
const def = riggedModelDef(collapseRig(meshCharacter(composeCharacter(kit, kit.defaults)), kit.partMap));
const pool = new VoxelPool();
pool.bind({ keys: () => ['char.gc'], model: () => def }, { idFor: () => 10 });
const pm = pool.models.get('char.gc');
assert.ok(pm.meshOnly && pm.partIndex.jaw !== undefined, 'char.gc packs mesh-only with a jaw part');
assert.ok(pool.pushInstance('char.gc', 0, 0, 0, 270, -1, 0, 0) === 0, 'instance accepted');
console.log('PASS gpucompare.charRig.test.js');
