// EDITOR-PATH-SMOKE: Node-only, no DOM. For each editor pure module (quest model, creature archetypes, logic model, foliage brush,
// grass brush) round-trips the data files it owns (load -> save byte-identical) and checks one edit + undo restores the bytes.
// Run: node tools/verify-editor-path.mjs   -> one "OK|FAIL <module> ..." line per module, exit 1 on any miss. Output is deterministic.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import '../design/palette.js';
import '../design/detail-pass.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).sort().flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
/** Copy a content dir to a temp dir; same() asserts every file there is byte-identical to the original and returns the file count. */
function copyDir(rel, tag) {
  const src = path.join(ROOT, rel), base = mkdtempSync(path.join(os.tmpdir(), `editorpath-${tag}-`)), tmp = path.join(base, 'd');
  cpSync(src, tmp, { recursive: true });
  return { src, tmp, base, same() { let n = 0; for (const f of walk(src)) { const r = path.relative(src, f); assert.equal(readFileSync(path.join(tmp, r), 'utf8'), readFileSync(f, 'utf8'), r); n++; } return n; } };
}

const modules = [];
const mod = (name, fn) => modules.push([name, fn]);

mod('quest', async () => {
  const { loadQuests, saveAll, setQuestField, makeStack } = await import('./editor/quest/model.js');
  const d = copyDir('content/quests', 'q'); const m = loadQuests(d.tmp);
  assert.deepEqual(m.errors, []); assert.equal(saveAll(m).written.length, 0, 'no edit writes nothing');
  const st = makeStack(); st.run(setQuestField(m.quests[0], 'title', 'X')); assert.equal(saveAll(m).written.length, 1, 'edit is written');
  st.undo(); saveAll(m); return { n: d.same(), base: d.base, info: `${m.quests.length} quests` };
});

mod('archetypes', async () => {
  const { loadArchetypes, saveArchetypes, setArchField, makeStack } = await import('./editor/ai/model.js');
  const d = copyDir('content/beasts', 'a'); const m = loadArchetypes(d.tmp);
  assert.deepEqual(m.errors, []); assert.equal(saveArchetypes(m).written.length, 0, 'no edit writes nothing');
  const st = makeStack(); st.run(setArchField(m, 'grazer', 'noticeR', 12)); assert.equal(saveArchetypes(m).written.length, 1, 'edit is written');
  while (st.undo()); saveArchetypes(m); return { n: d.same(), base: d.base, info: 'archetypes+kinds' };
});

mod('logic', async () => {
  const L = await import('./editor/logic/model.js');
  const d = copyDir('content/logic', 'l'); const m = L.loadLogic(d.tmp);
  assert.deepEqual(m.errors, []); assert.equal(L.saveAll(m).written.length, 0, 'no edit writes nothing');
  const st = L.makeStack(); let edited = 0;
  for (const f of m.files.values()) if (f.blocks.length) { st.run(L.deleteBlock(f, f.blocks[0].id)); edited++; }
  assert.ok(edited > 0); assert.equal(L.saveAll(m).written.length, edited, 'edits are written');
  while (st.undo()); L.saveAll(m); return { n: d.same(), base: d.base, info: `${m.files.size} files` };
});

mod('foliage', async () => {
  const { stringifyContent } = await import('../engine/index.js');
  const { loadTestAssets } = await import('./testing/content-node.mjs');
  const { createDoc } = await import('./editor/doc.js'); const { applyEdit, invert } = await import('./editor/commands.js');
  const { createStack } = await import('./editor/undo.js'); const FP = await import('./editor/foliagePanel.js');
  const file = path.join(ROOT, 'content/editor/foliage.json'), text = readFileSync(file, 'utf8'), json = JSON.parse(text);
  // foliage.json is read-only palette data (hand-formatted, never written by the editor); the file the brush writes is the world json
  assert.deepEqual(JSON.parse(JSON.stringify(json)), json, 'foliage.json parses stably');
  const worldText = readFileSync(path.join(ROOT, 'content/worlds/world_m1.world.json'), 'utf8');
  assert.equal(stringifyContent(JSON.parse(worldText)), worldText, 'world file load -> save byte-identical');
  const { assets, bundle } = await loadTestAssets(); const doc = createDoc(assets, bundle), f = doc.files.get('world/world_m1');
  f.def = structuredClone(f.def); f.def.structures = [];
  const bytes = () => stringifyContent(f.def), before = bytes(), stack = createStack();
  const world = { structureAt: () => null, sectorAt: () => null, floorAt: () => 0 };
  const st = FP.createFoliageState(json); st.palette = 'rock_field'; st.density = 20; st.radius = 10;
  const ctl = FP.createFoliageController({ doc, fileId: 'world/world_m1', assets, json, getWorld: () => world, commit: (r) => { applyEdit(doc, r); stack.push(r); } }, st);
  ctl.start({ x: 500, y: 500 }); ctl.move({ x: 510, y: 500 }); ctl.end();
  assert.notEqual(bytes(), before, 'stroke changed the world file'); const painted = f.def.structures.length;
  let r; while ((r = stack.undo())) applyEdit(doc, invert(r));
  assert.equal(bytes(), before, 'undo restores the bytes'); return { n: 1, info: `${painted} placements painted+undone` };
});

mod('grass', async () => {
  const E = await import('../engine/index.js'); const G = await import('./editor/grassBrush.js');
  const file = path.join(ROOT, 'content/grassmask/overworld_far.grassMask.json'), text = readFileSync(file, 'utf8');
  const layer = E.grassMaskFromJSON(JSON.parse(text)), id = JSON.parse(text).id;
  const gm = G.wrapLayer(layer, { sampleAt: E.grassSampleAt, setSample: E.setGrassSample, grassMaskToJSON: E.grassMaskToJSON });
  assert.equal(G.grassMaskText(gm, id), text, 'grass mask load -> save byte-identical');
  const ctx = { gm, key: id }, s = G.beginStroke(ctx, { op: 'paint', radius: 3, strength: G.effectiveStrength(60), x: 0, y: 0 });
  for (const [x, y] of s.points(8, 0)) s.dab(x, y);
  const rec = G.endStroke(ctx, s); assert.ok(rec, 'stroke recorded'); assert.notEqual(G.grassMaskText(gm, id), text, 'stroke changed the mask');
  G.applyGrassSide(gm, rec, 'before'); assert.equal(G.grassMaskText(gm, id), text, 'undo restores the bytes');
  return { n: 1, info: `${rec.entries.length} cells painted+undone` };
});

let bad = 0; const bases = [];
for (const [name, fn] of modules) {
  try { const r = await fn(); if (r.base) bases.push(r.base); console.log(`OK   ${name}: ${r.n} file(s) byte-identical after edit+undo (${r.info})`); }
  catch (e) { bad++; console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); }
}
for (const b of bases) try { rmSync(b, { recursive: true, force: true }); } catch { /* temp only */ }
console.log(bad ? `${bad} module(s) FAILED` : `editor path OK: ${modules.length} modules`);
process.exit(bad ? 1 : 0);
