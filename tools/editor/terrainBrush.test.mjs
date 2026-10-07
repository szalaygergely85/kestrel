// tools/editor/terrainBrush.test.mjs (ED-TERRAIN-1c, docs/architecture.md 37.12): brush logic (no DOM).
// Run: node tools/editor/terrainBrush.test.mjs
import { readFileSync } from 'node:fs';
import { World, createEditLayer, editLayerFromJSON, editLayerToJSON, stringifyContent } from '../../engine/index.js';
import { makeOk } from '../../engine/test/assert.js';
import terrainDef from '../../design/levels/overworld_far.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../testing/content-node.mjs';
import {
  beginStroke, endStroke, applyTerrainSide, rectToWorld, effectiveStrength, dabSpacing, terrainEditsText, terrainEditsPath,
  isTerrainRecord, PAINT_TYPES, BRUSH_OPS,
} from './terrainBrush.js';

globalThis.window = globalThis.window || globalThis;
terrainDef; paletteMod; detailPassMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod; farTowerMod; ferrumLightsMod;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const { assets, bundle } = await loadTestAssets();
const KEY = 'overworld_far';

// ---- manifest + content file -------------------------------------------------
const manifest = JSON.parse(readFileSync(new URL('../../content/manifest.json', import.meta.url), 'utf8'));
ok('manifest registers the terrain edits file', manifest.files.includes(terrainEditsPath(KEY)), terrainEditsPath(KEY));
ok('registry serves terrainEdits(key) from the manifest', !!assets.terrainEdits(KEY) && !!bundle.terrainEdits[KEY]);
ok('shipped edits file is canonical', readFileSync(new URL(`../../content/${terrainEditsPath(KEY)}`, import.meta.url), 'utf8') === stringifyContent({ kind: 'terrainEdits', schema: 1, id: KEY, ...assets.terrainEdits(KEY) }));

const w = World.load(assets.world('world_m1'), assets, {});
const T = w.terrain;
let layer = T.edits;
ok('World.load gives the terrain a live edit layer from the file', !!layer && layer.cell === 2);
const ctx = { layer, terrain: T, key: KEY };
const cx = w.def.spawn ? w.def.spawn.x : 1500, cy = w.def.spawn ? w.def.spawn.y : 1000;

// ---- fixed-step spacing is independent of the mouse event granularity --------
{
  const a = beginStroke(ctx, { op: 'raise', radius: 6, strength: 0.1, x: cx, y: cy });
  const b = beginStroke(ctx, { op: 'raise', radius: 6, strength: 0.1, x: cx, y: cy });
  const pa = [], pb = [];
  pa.push(...a.points(cx + 40, cy + 30));
  pb.push(...b.points(cx, cy)); // first call = the start dab only
  for (let k = 1; k <= 100; k++) pb.push(...b.points(cx + 0.4 * k, cy + 0.3 * k)); // 0.5 m events along the same line
  ok('same polyline -> same dab count', pa.length === pb.length, `${pa.length} vs ${pb.length}`);
  ok('same polyline -> same dab positions', pa.every((p, i) => Math.abs(p[0] - pb[i][0]) < 1e-9 && Math.abs(p[1] - pb[i][1]) < 1e-9));
  const sp = dabSpacing(6);
  ok('dabs are one spacing apart', pa.length > 2 && Math.abs(Math.hypot(pa[2][0] - pa[1][0], pa[2][1] - pa[1][1]) - sp) < 1e-9, `${sp}`);
  ok('a stationary click gives exactly one dab', beginStroke(ctx, { op: 'raise', radius: 6, strength: 0.1, x: cx, y: cy }).points(cx, cy).length === 1);
}

// ---- strokes: edits, one record, bit-identical undo/redo ----------------------
const snap = () => ({
  json: JSON.stringify(editLayerToJSON(layer, KEY)),
  h: Float32Array.from(T.near.height), t: Uint8Array.from(T.near.type),
});
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const line = (n, dx, dy) => Array.from({ length: n + 1 }, (_, k) => [cx + dx * k, cy + dy * k]);
const STROKES = [['raise', 60], ['flatten', 50], ['smooth', 80], ['paint', 100], ['lower', 40]];

function runStroke(c, terrain, op, pct, pts, paintId = 4, radius = 6) {
  const s = beginStroke(c, { op, radius, strength: effectiveStrength(op, pct, paintId), x: pts[0][0], y: pts[0][1] });
  let moved = 0;
  for (const [x, y] of pts) for (const [dx, dy] of s.points(x, y)) { const r = s.dab(dx, dy); if (r) { terrain.rebakeRect(...rectToWorld(c.layer, r)); moved++; } }
  return { rec: endStroke(c, s), moved };
}

const states = [snap()];
const recs = [];
for (const [op, pct] of STROKES) {
  const { rec, moved } = runStroke(ctx, T, op, pct, line(12, 2, 1.5));
  ok(`${op}: dabs applied and ONE record returned`, !!rec && moved > 0 && isTerrainRecord(rec) && rec.key === KEY, `${moved}`);
  const st = snap();
  ok(`${op}: layer changed`, st.json !== states[states.length - 1].json);
  states.push(st); recs.push(rec);
}
ok('paint wrote the requested ground type into the near bake', T.near.type.includes(4));
ok('raise moved the near-bake heights', !sameBytes(states[1].h, states[0].h));
// undo everything, newest first: each step restores layer + near bake bit for bit
for (let k = recs.length - 1; k >= 0; k--) {
  T.rebakeRect(...rectToWorld(layer, applyTerrainSide(layer, recs[k], recs[k].before)));
  const st = snap();
  ok(`undo ${recs[k].label}: layer JSON identical`, st.json === states[k].json);
  ok(`undo ${recs[k].label}: near heights bit-identical`, sameBytes(st.h, states[k].h));
  ok(`undo ${recs[k].label}: near types identical`, sameBytes(st.t, states[k].t));
}
ok('everything undone == empty layer', Object.keys(editLayerToJSON(layer, KEY).chunks).length === 0);
for (let k = 0; k < recs.length; k++) {
  T.rebakeRect(...rectToWorld(layer, applyTerrainSide(layer, recs[k], recs[k].after)));
  const st = snap();
  ok(`redo ${recs[k].label}: layer + bake identical`, st.json === states[k + 1].json && sameBytes(st.h, states[k + 1].h) && sameBytes(st.t, states[k + 1].t));
}

// ---- determinism + save/load -------------------------------------------------
{
  const final = states[states.length - 1].json;
  const w2 = World.load(assets.world('world_m1'), assets, {});
  const t2 = w2.terrain;
  t2.setEdits(createEditLayer(2, 128));
  const c2 = { layer: t2.edits, terrain: t2, key: KEY };
  for (const [op, pct] of STROKES) runStroke(c2, t2, op, pct, line(12, 2, 1.5));
  ok('a second run of the same strokes is byte-identical', JSON.stringify(editLayerToJSON(c2.layer, KEY)) === final);

  const text = terrainEditsText(c2.layer, KEY);
  ok('saved text is canonical (stringifyContent of the JSON)', text === stringifyContent(JSON.parse(text)));
  const back = editLayerFromJSON(JSON.parse(text));
  ok('load(save(layer)) re-saves byte-identically', terrainEditsText(back, KEY) === text);
  ok('saved file kind/id/schema', JSON.parse(text).kind === 'terrainEdits' && JSON.parse(text).id === KEY && JSON.parse(text).schema === 1);
  // a World built from the saved file bakes the same near band as the live-edited one
  const withFile = Object.create(assets);
  withFile.terrainEdits = (k) => (k === KEY ? JSON.parse(text) : null);
  const w3 = World.load(withFile.world('world_m1'), withFile, {});
  ok('reloaded world bakes the same near heights as the live edit', sameBytes(w3.terrain.near.height, t2.near.height) && sameBytes(w3.terrain.near.type, t2.near.type));
}

ok('ops/paint tables match the recipe type names', BRUSH_OPS.length === 5 && PAINT_TYPES.every((p) => w.terrain.typeName(p.id) === p.name), PAINT_TYPES.map((p) => w.terrain.typeName(p.id)).join());
ok('a stroke that changes nothing yields no record', (() => {
  const c = { layer: createEditLayer(2, 128), terrain: T, key: KEY };
  const s = beginStroke(c, { op: 'paint', radius: 0.2, strength: 4, x: 1000, y: 1000 });
  s.dab(1000, 1000); // radius below a cell: touches no cell centre
  return endStroke(c, s) === null;
})());

console.log(`terrainBrush.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
