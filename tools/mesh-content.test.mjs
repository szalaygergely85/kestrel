// ME-14a cross-references, material maps, chunks and integrated mesh-file validation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMeshJSON } from './mesh-file.mjs';
import { validateContent } from './validate-content.mjs';

const mesh = readMeshJSON(fileURLToPath(new URL('../content/meshes/ruins/Fences/Line.mesh.json', import.meta.url)));
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
// ALPHA-01a (37.17): masked ranges need a registered mask; content/masks files are checked.
{
  const masked = () => {
    const a = assets();
    const m = a.meshes[mesh.id];
    m.uvMask = new Array(m.pos.length / 3 * 2).fill(0.5);
    m.ranges = [{ start: 0, count: m.triCount, part: 'p', mask: { tex: 'pack/Leaf', cutoff: 0.2 } }];
    return a;
  };
  const withMask = masked(); withMask.masks = { 'pack/Leaf': { id: 'pack/Leaf', w: 1, h: 1, data: new Uint8Array(1) } };
  assert.deepEqual(validateContent(withMask).errors, []);
  assert.ok(validateContent(masked()).errors.some((e) => e.includes('is not in the manifest masks')));
  const bad = masked(); bad.meshes[mesh.id].ranges[0].mask.cutoff = 1; bad.masks = withMask.masks;
  assert.ok(validateContent(bad).errors.some((e) => e.includes('cutoff')));
  const md = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-masks-'));
  try {
    fs.mkdirSync(path.join(md, 'pack'));
    const good = { kind: 'mask', schema: 1, id: 'pack/Leaf', w: 2, h: 2, cutoffDefault: 0.2, data: Buffer.from([0, 255, 255, 255]).toString('base64') };
    fs.writeFileSync(path.join(md, 'pack', 'Leaf.mask.json'), JSON.stringify(good));
    assert.deepEqual(validateContent(assets(), { maskFilesDir: md }).errors, []);
    fs.writeFileSync(path.join(md, 'pack', 'Other.mask.json'), JSON.stringify({ ...good, data: 'AAAA' }));
    assert.ok(validateContent(assets(), { maskFilesDir: md }).errors.some((e) => e.includes('Other.mask.json')));
    fs.writeFileSync(path.join(md, 'pack', 'Other.mask.json'), JSON.stringify({ ...good, id: 'pack/Elsewhere' }));
    assert.ok(validateContent(assets(), { maskFilesDir: md }).errors.some((e) => e.includes('does not match the file path')));
    fs.unlinkSync(path.join(md, 'pack', 'Other.mask.json'));
  } finally { fs.rmSync(md, { recursive: true, force: true }); }
}

console.log('ME-14a material, placement, chunk and filesystem checks ALL PASS');
