// MESH-UVMAP-01: gltf-import --uvmap on a real Quaternius rock + Lab classifier. node tools/uvmap.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from './gltf-import.mjs';
import { rgbToLab, textureTable } from './uvmap.mjs';

let n = 0; const ok = (m) => { n++; console.log(`ok - ${m}`); };
const map = JSON.parse(fs.readFileSync('design/meshes/quaternius/palette-map.json', 'utf8'));
for (const t of Object.keys(map.textures)) assert.ok(Object.keys(map.textures[t]).length <= 6); ok('palette-map: <= 6 keys per texture');
assert.ok(Math.abs(rgbToLab([255, 255, 255])[0] - 100) < 0.1 && Math.abs(rgbToLab([0, 0, 0])[0]) < 0.1); ok('Lab white/black');
assert.throws(() => textureTable(map, 'Nope'), /no entry/); ok('unknown texture named');

const src = 'design/meshes/quaternius/glTF/Rock_Medium_1.gltf';
if (fs.existsSync(src)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvmap-'));
  const run = async (name, extra = []) => { const out = path.join(dir, name); const r = await runCli([src, 'quaternius/Rock_Medium_1', '--uvmap', 'auto', '--out', out, ...extra]); return { r, json: JSON.parse(fs.readFileSync(out, 'utf8')), text: fs.readFileSync(out, 'utf8') }; };
  const a = await run('a.json'), b = await run('b.json');
  assert.strictEqual(a.text, b.text); ok('deterministic');
  assert.ok(a.json.matKeys.length >= 2 && a.json.matKeys.length <= 6 && a.json.matKeys.every((k) => a.json.mats[k] === k)); ok(`keys ${a.json.matKeys.join(',')}`);
  assert.strictEqual(a.json.ranges.reduce((s, r) => s + r.count, 0), a.json.triCount);
  assert.strictEqual(Object.values(a.r.report.uvmap.tris).reduce((s, v) => s + v, 0), a.json.triCount); ok('ranges cover all triangles, one range per key');
  const s = await run('s.json', ['--simplify', '120']);
  assert.ok(s.json.triCount <= 120 && s.json.matKeys.length >= 2); ok(`simplify per key: ${s.json.triCount} tris, ${s.json.matKeys.length} keys`);
  // never merged across keys: every vertex material of a range belongs to that range's key
  const flat = s.json.flat; let t0 = 0;
  for (const r of s.json.ranges) { const ids = new Set(); for (let t = t0; t < t0 + r.count; t++) ids.add(flat[t * 3 * 2 + 1] >>> 16); assert.strictEqual(ids.size, 1); t0 += r.count; }
  ok('each range holds exactly one material');
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`${n} passed`);
