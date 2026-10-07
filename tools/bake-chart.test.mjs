import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Terrain, World, AssetRegistry, createEditLayer, setSampleDh, setSampleType, editLayerToJSON, editLayerFromJSON } from '../engine/index.js';
import { bakeChart, chartText, checkChart, inputFingerprint, bakeRepository } from './bake-chart.mjs';

const terrain = { heightAt:(x,y) => 0.1*x + Math.max(0,x-8), typeAt:x => x > 6 ? 1 : 0, typeName:id => ['grass','forest'][id] };
const opts = { terrain, bounds:{x0:0,y0:0,x1:12,y1:8}, width:6, rows:4,
  inputs:{ terrain:'base', edits:'empty', structures:'one' },
  structures:[{bbox:{x0:11,y0:7,x1:12,y1:8}}],
  water:[{shape:'circle',c:[1,1],r:0.2},{shape:'rect',rect:[4,0,5,0.5]}],
  roads:[{points:[[0,4.1],[12,4.1]],halfWidth:0.05}] };
const chart = bakeChart(opts), text = chartText(chart);
assert.equal(chart.glyphs[0][0],'2','small circle water survives downsampling');
assert.equal(chart.glyphs[0][2],'2','small rect water survives downsampling');
assert.equal(chart.glyphs[0][3],'1','forest terrain is encoded'); assert.equal(chart.glyphs[0][4],'6','steep grade is encoded');
assert.equal(chart.glyphs[2],'444444','narrow road crossing cells survives');
assert.equal(chart.glyphs[3][5],'5','structure footprint has priority');
assert.equal(chart.shades[0][0],'0'); assert.equal(chart.shades[0][5],'f','height shade spans full range');
assert.equal(chartText(bakeChart(opts)),text,'byte-identical repeat');
assert.equal(inputFingerprint({b:'2',a:'1'}),inputFingerprint({a:'1',b:'2'}));
checkChart(text,chart);
for (const field of ['terrain','edits','structures']) {
  assert.throws(()=>checkChart(text,bakeChart({...opts,inputs:{...opts.inputs,[field]:'changed'}})),/stale/);
}
assert.throws(()=>checkChart(text.replace('444444','044444'),chart),/stale/);
assert.throws(()=>bakeChart({...opts,width:0}),/grid/);
assert.throws(()=>bakeChart({...opts,terrain:{...terrain,heightAt:()=>NaN}}),/non-finite/);
assert.throws(()=>chartText({...chart,padding:'x'.repeat(100000)}),/100 KB/);

// Real recipe + public Terrain edit-layer API: both height brush and type paint are read.
const context = {window:{ASSETS:{}},Math};
vm.runInNewContext(fs.readFileSync(new URL('../design/levels/overworld_far.js',import.meta.url),'utf8'),context);
const recipe = context.window.ASSETS.levels.overworld_far;
const structureDefs = recipe.structures; recipe.structures = [];
const layer = createEditLayer(), target = {bounds:{x0:400,y0:400,x1:408,y1:408},width:2,rows:2};
const base = new Terrain(recipe), before = bakeChart({...target,terrain:base});
setSampleDh(layer,201,201,30000); setSampleType(layer,201,201,2);
const saved = editLayerToJSON(layer,'overworld_far'), restored = editLayerFromJSON(saved);
const edited = new Terrain(recipe,{edits:restored}), after = bakeChart({...target,terrain:edited});
assert.ok(after.heightRange[1] > before.heightRange[1]+200,'editor delta affects baked heights');
assert.equal(after.glyphs[0][0],'2','editor type paint affects chart');
const paintedRoad = bakeChart({...target,terrain:edited,roads:[{points:[[400,402],[408,402]],halfWidth:0.1}]});
assert.equal(paintedRoad.glyphs[0][0],'2','painted water wins over the authored road');
assert.equal(base.heightAt(402,402)+300,edited.heightAt(402,402),'base and edited terrains rebind their own edit layers');

// Real World.load injects structure bbox and ring floor BEFORE the terrain is sampled.
recipe.structures = structureDefs;
const level = {name:'fixture',start:{x:0.5,y:0.5},rows:['..','..'],legend:{'.':{floorH:10,ceilH:'sky',solid:false,floorMat:'grass',wallMat:'grass',ceilMat:'sky'}}};
const assets = new AssetRegistry({palette:{},terrain:{overworld_far:recipe},levels:{fixture:level}});
const world = World.load({terrain:'overworld_far',structures:[{id:'tower',level:'fixture',origin:{x:400,y:400,z:2}}]},assets);
assert.equal(world.terrain.heightAt(400.5,400.5),12,'final structure ring floor and placement lift');
const blended = bakeChart({...target,terrain:world.terrain,structures:world.structures});
assert.equal(blended.glyphs[0][0],'5','structure edge intersection, not only centre sampling');

// Shipped data is built from the index, so unsaved editor worlds are never silently published.
// CI/staged input changes must rebake this chart; local working-file freshness uses --check.
const shipped = await bakeRepository({index:true,check:true});
assert.equal(shipped.width,240); assert.equal(shipped.rows,120);
assert.ok(Buffer.byteLength(chartText(shipped))<100000);
assert.ok(Object.keys(shipped.inputs).some(file=>file.endsWith('.edits.json')),'edit file included in freshness inputs');
assert.ok(Object.keys(shipped.inputs).some(file=>file.endsWith('.level.json')),'ring floor input included');
assert.ok(Object.keys(shipped.inputs).some(file=>file.endsWith('.mesh.json')),'mesh footprints included');
console.log('bake-chart: final terrain/brush/structure blending, water/road footprints, determinism and indexed freshness PASS');
