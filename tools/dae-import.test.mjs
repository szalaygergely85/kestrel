// TREES-LP-a: Collada importer on an inline fixture (triangles + polylist + node matrix + 2 materials) and the 2 real Kenney trees.
// node tools/dae-import.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { importDae, daeToJson, readCollada, parseXml } from './dae-import.mjs';
import { loadEngineMaterialKeys } from './gltf-import.mjs';
import { validateMesh, meshFromJSON } from '../engine/index.js';

let n = 0; const ok = (m) => { n++; console.log(`ok - ${m}`); };
const map = JSON.parse(fs.readFileSync('design/meshes/kenney/palette-map.json', 'utf8'));
const keys = await loadEngineMaterialKeys();
for (const k of Object.keys(map.keys)) assert.ok(keys.has(k), `palette key ${k}`); ok('map keys exist in design/palette.js');

// Fixture: one geometry = a triangle (material A) + a quad polylist (material B); node = translate-in-matrix (+2 x, +1 y), Y_UP.
const FIX = `<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>
<library_effects>
 <effect id="eA"><profile_COMMON><technique sid="c"><phong><diffuse><color>0.16 0.79 0.67 1</color></diffuse></phong></technique></profile_COMMON></effect>
 <effect id="eB"><profile_COMMON><technique sid="c"><phong><diffuse><color>0.89 0.51 0.34 1</color></diffuse></phong></technique></profile_COMMON></effect>
</library_effects>
<library_materials><material id="mA" name="leafsGreen"><instance_effect url="#eA"/></material><material id="mB" name="woodBark"><instance_effect url="#eB"/></material></library_materials>
<library_geometries><geometry id="g"><mesh>
 <source id="s"><float_array id="fa" count="21">0 0 0  1 0 0  0 0 -1  0 1 0  1 1 0  1 1 -1  0 1 -1</float_array>
  <technique_common><accessor source="#fa" count="7" stride="3"/></technique_common></source>
 <vertices id="v"><input semantic="POSITION" source="#s"/></vertices>
 <triangles count="1" material="symA"><input offset="0" semantic="VERTEX" source="#v"/><p>0 1 2</p></triangles>
 <polylist count="1" material="symB"><input offset="0" semantic="VERTEX" source="#v"/><input offset="1" semantic="NORMAL" source="#v"/><vcount>4</vcount><p>3 0 4 0 5 0 6 0</p></polylist>
</mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="vs"><node id="n" name="fix"><matrix>1 0 0 2  0 1 0 1  0 0 1 0  0 0 0 1</matrix>
 <instance_geometry url="#g"><bind_material><technique_common>
  <instance_material symbol="symA" target="#mA"/><instance_material symbol="symB" target="#mB"/></technique_common></bind_material></instance_geometry></node></visual_scene></library_visual_scenes>
</COLLADA>`;

assert.throws(() => parseXml('<a><b></a>'), /mismatched/); ok('xml: mismatched tag rejected');
const r = readCollada(FIX);
assert.strictEqual(r.instances.length, 1);
assert.deepStrictEqual(r.geoms.g.prims.map((p) => p.tris.length / 3), [1, 2]); ok('polylist quad fans into 2 triangles, triangles kept');
const res = importDae(FIX, 'kenney/fixture', { map });
const m = res.mesh;
assert.strictEqual(m.triCount, 3); assert.deepStrictEqual([...m.matKeys].sort(), ['leaf', 'wood']); ok(`fixture: 3 tris, keys ${m.matKeys.join(',')}`);
assert.deepStrictEqual(validateMesh(m).errors, []);
// Y_UP -> (x,-z,y) after the matrix: x in [2,3], engine y = -z in [0,1], engine z = y in [1,2]
assert.deepStrictEqual([...m.bbox].map((v) => Math.round(v * 1e4) / 1e4 + 0), [2, 0, 1, 3, 1, 2]); ok('node matrix + axis convert: bbox 2,0,1 .. 3,1,2');
const json = daeToJson(m, importDae(FIX, 'kenney/fixture', { map }).tab, keys);
assert.deepStrictEqual(validateMesh(meshFromJSON(json)).errors, []); ok('canonical json reloads and validates');
// mirrored node (negative scale) keeps outward winding
const MIR = FIX.replace('<matrix>1 0 0 2  0 1 0 1  0 0 1 0  0 0 0 1</matrix>', '<scale>-1 1 1</scale>');
const mir = importDae(MIR, 'kenney/mirror', { map }).mesh;
assert.strictEqual(mir.triCount, 3); assert.deepStrictEqual([...mir.bbox].map((v) => Math.round(v * 1e4) / 1e4 + 0), [-1, 0, 0, 0, 1, 1]); ok('mirrored node imports (winding compensated)');
{ const far = importDae(FIX.replace('0.16 0.79 0.67', '1 0 1'), 'k/x', { map }); assert.ok(far.report.unmapped.length === 1); ok('far colour reported as unmapped'); }

// Real files
const REAL = { 'kenney/tree_oak': 'tree_oak', 'kenney/tree_pineTallA': 'tree_pineTallA' };
for (const [id, name] of Object.entries(REAL)) {
  const src = `design/meshes/kenney/dae/${name}.dae`, out = `content/meshes/${id}.mesh.json`;
  if (!fs.existsSync(src)) { console.log(`skip - ${src} missing`); continue; }
  const rr = importDae(fs.readFileSync(src, 'utf8'), id, { map, scale: map.scale, simplifyTo: 600 });
  assert.ok(rr.mesh.triCount > 20 && rr.mesh.triCount <= 600, `${id} tris ${rr.mesh.triCount}`);
  const h = rr.mesh.bbox[5] - rr.mesh.bbox[2], w = rr.mesh.bbox[3] - rr.mesh.bbox[0];
  assert.ok(h > 5 && h < 14 && w > 1 && w < 12 && Math.abs(rr.mesh.bbox[2]) < 0.05, `${id} bbox ${[...rr.mesh.bbox]}`);
  assert.ok(rr.mesh.matKeys.every((k) => keys.has(k)) && rr.report.unmapped.length === 0);
  const j = daeToJson(rr.mesh, rr.tab, keys);
  assert.ok(j.collider && j.collider.length / 9 <= 28 && j.collide !== false && j.castShadow !== false);
  if (fs.existsSync(out)) assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).triCount, j.triCount, 'committed mesh matches the importer');
  ok(`${id}: ${rr.mesh.triCount} tris, ${h.toFixed(1)} m tall, keys ${rr.mesh.matKeys.join(',')}, collider ${j.collider.length / 9} tris`);
}
console.log(`dae-import.test: ${n} ok`);
