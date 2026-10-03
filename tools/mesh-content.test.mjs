// ME-14a cross-references, material maps, chunks and integrated mesh-file validation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateContent } from './validate-content.mjs';

const mesh = JSON.parse(fs.readFileSync(new URL('../content/meshes/ruins/Fences/Line.mesh.json', import.meta.url), 'utf8'));
mesh.mats = { [mesh.matKeys[0]]: 'stone' };
function assets() {
  return { palette: { materials: { stone: {} } }, meshes: { [mesh.id]: structuredClone(mesh) },
    worlds: { demo: { structures: [{ id: 'ruin', mesh: mesh.id, origin: { x: 12, y: 4, z: 0 }, yawDeg: 35 }],
      entities: [{ id: 'prop', components: { mesh: { id: mesh.id, yawDeg: 10 } } }] } },
    chunks: { test: { entities: [{ id: 'placed', components: { mesh: { id: mesh.id, yawDeg: -35 } } }] } }, levels: {} };
}
assert.deepEqual(validateContent(assets()).errors, []);
for (const mutate of [
  (a) => { a.meshes[mesh.id].mats[mesh.matKeys[0]] = 'missing'; },
  (a) => { a.worlds.demo.structures[0].level = 'tower'; },
  (a) => { delete a.worlds.demo.structures[0].mesh; },
  (a) => { a.worlds.demo.structures[0].mesh = 'missing'; },
  (a) => { a.worlds.demo.structures[0].yawDeg = Infinity; },
  (a) => { a.worlds.demo.structures[0].yawSteps = 1; },
  (a) => { a.worlds.demo.entities[0].components.mesh.id = 'missing'; },
  (a) => { a.chunks.test.entities[0].components.mesh.yawDeg = NaN; },
]) { const a = assets(); mutate(a); assert.ok(validateContent(a).errors.length > 0); }
const grid = assets(); grid.levels.grid_fixture = { rows: [], legend: {} };
grid.worlds.demo.structures = [{ id: 'grid', level: 'grid_fixture', yawDeg: 35 }];
assert.ok(validateContent(grid).errors.some((e) => e.includes('allowed only for mesh')));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-me14-'));
const file = path.join(dir, 'bad.mesh.json');
try {
  fs.writeFileSync(file, '{broken');
  const checked = validateContent(assets(), { meshFilesDir: dir });
  assert.ok(checked.errors.some((e) => e.includes('JSON parse failed')));
} finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
console.log('ME-14a material, placement, chunk and filesystem checks ALL PASS');
