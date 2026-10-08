#!/usr/bin/env node
// MAP-01b: final engine terrain -> deterministic compact chart, no renderer dependency.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { World, AssetRegistry, loadContentPack } from '../engine/index.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CHART_PATH = 'content/chart/world_m1.chart.json';
// Semantic codes only; MAP-01a supplies the final drawing glyphs/colours.
export const CATEGORIES = Object.freeze(['grass', 'forest', 'water', 'rock', 'road', 'structure', 'steep']);
const sha = text => createHash('sha256').update(text).digest('hex');

export function inputFingerprint(inputs) {
  return sha(JSON.stringify(Object.entries(inputs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}

function overlaps(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
function waterTouches(w, cell) {
  if (w.shape === 'rect') return overlaps(cell, { x0:w.rect[0], y0:w.rect[1], x1:w.rect[2], y1:w.rect[3] });
  if (w.shape === 'circle') {
    const dx = w.c[0] - Math.max(cell.x0, Math.min(cell.x1, w.c[0]));
    const dy = w.c[1] - Math.max(cell.y0, Math.min(cell.y1, w.c[1]));
    return dx * dx + dy * dy < w.r * w.r;
  }
  throw new Error(`chart: unsupported water shape ${w.shape}`);
}

// Segment intersection with a road-width expanded cell: keeps sub-cell roads visible.
function roadTouches(road, cell) {
  const radius = road.halfWidth;
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i-1], b = road.points[i]; let lo = 0, hi = 1;
    for (let axis = 0; axis < 2; axis++) {
      const min = (axis ? cell.y0 : cell.x0) - radius, max = (axis ? cell.y1 : cell.x1) + radius;
      const d = b[axis] - a[axis];
      if (d === 0) { if (a[axis] < min || a[axis] > max) { hi = -1; break; } }
      else { const t0 = (min-a[axis])/d, t1 = (max-a[axis])/d; lo = Math.max(lo, Math.min(t0,t1)); hi = Math.min(hi, Math.max(t0,t1)); }
    }
    if (lo <= hi) return true;
  }
  return false;
}

/** Samples analytic FINAL heights, including edit layer and placed-level ring blending. */
export function bakeChart({ terrain, bounds, structures = [], water = [], roads = [], inputs = {}, width = 240, rows = 120 }) {
  if (!Number.isInteger(width) || !Number.isInteger(rows) || width < 1 || rows < 1 || width * rows > 45000) throw new Error('chart: invalid grid size');
  if (![bounds.x0,bounds.y0,bounds.x1,bounds.y1].every(Number.isFinite) || bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) throw new Error('chart: invalid bounds');
  const dx = (bounds.x1-bounds.x0)/width, dy = (bounds.y1-bounds.y0)/rows;
  const heights = [], glyphs = []; let min = Infinity, max = -Infinity;
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < width; col++) {
      const cell = { x0:bounds.x0+col*dx, y0:bounds.y0+row*dy, x1:bounds.x0+(col+1)*dx, y1:bounds.y0+(row+1)*dy };
      const x = (cell.x0+cell.x1)/2, y = (cell.y0+cell.y1)/2, h = terrain.heightAt(x,y), e = 2;
      const slope = Math.hypot((terrain.heightAt(x+e,y)-terrain.heightAt(x-e,y))/(2*e), (terrain.heightAt(x,y+e)-terrain.heightAt(x,y-e))/(2*e));
      if (!Number.isFinite(h) || !Number.isFinite(slope)) throw new Error('chart: non-finite terrain sample');
      min = Math.min(min,h); max = Math.max(max,h); heights.push(h);
      const type = terrain.typeName(terrain.typeAt(x,y));
      if (!['grass','forest','water','rock','path'].includes(type)) throw new Error(`chart: unsupported terrain type ${type}`);
      let category = type === 'path' ? 'road' : type;
      if (slope > 0.6 && category !== 'water' && category !== 'road') category = 'steep';
      // River/type paint wins over the authored road, matching the final recipe surface.
      const painted = terrain.edits && terrain.edits.typePaint(x,y) >= 0;
      if (category !== 'water' && !painted && roads.some(road => roadTouches(road,cell))) category = 'road';
      if (water.some(region => waterTouches(region,cell))) category = 'water';
      if (structures.some(s => overlaps(s.bbox,cell))) category = 'structure';
      line += CATEGORIES.indexOf(category);
    }
    glyphs.push(line);
  }
  const shades = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < width; col++) {
      const h = heights[row*width+col];
      line += (max === min ? 0 : Math.min(15, Math.max(0, Math.round(15*(h-min)/(max-min))))).toString(16);
    }
    shades.push(line);
  }
  return { chartVersion:1, world:'world_m1', width, rows, bounds, axis:'x east, y south; row 0 north', glyphTable:'semantic-v1 (MAP-01a pending)', categories:CATEGORIES, heightRange:[min,max], shadeLevels:16, inputs, inputHash:inputFingerprint(inputs), glyphs, shades };
}

export function chartText(chart) {
  const text = JSON.stringify(chart)+'\n';
  if (Buffer.byteLength(text) >= 100000) throw new Error('chart: output must be under 100 KB');
  return text;
}
export function checkChart(stored, expected) {
  if (stored !== chartText(expected)) throw new Error('chart: stale or altered chart; run node tools/bake-chart.mjs');
}

/** index=true builds staged/tracked release inputs, preserving unsaved owner edits. */
export async function bakeRepository({ root = ROOT, index = false, check = false } = {}) {
  // Public engine imports execute from disk; do not label unstaged engine code as indexed.
  if (index && execFileSync('git',['diff','--name-only','--','engine/'],{cwd:root,encoding:'utf8'}).trim()) throw new Error('chart: --index requires engine working files to match the index');
  const inputs = {}, cache = new Map();
  const read = file => {
    if (!cache.has(file)) {
      const absolute = path.resolve(root,file), relative = path.relative(root,absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('chart: input outside repo');
      const text = index ? execFileSync('git',['show',`:${file}`],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}) : fs.readFileSync(absolute,'utf8');
      // Git normalises text EOLs; a Windows checkout must match the indexed bake.
      cache.set(file,text); inputs[file] = sha(text.replaceAll('\r\n','\n'));
    }
    return cache.get(file);
  };
  // MESH-BIN-01: <id>.mesh.bin payloads are inputs too (hashed raw, no EOL normalisation)
  const bytesCache = new Map();
  const readBytes = file => {
    if (!bytesCache.has(file)) {
      const absolute = path.resolve(root,file), relative = path.relative(root,absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('chart: input outside repo');
      const bytes = index ? execFileSync('git',['show',`:${file}`],{cwd:root,maxBuffer:64*1024*1024}) : fs.readFileSync(absolute);
      bytesCache.set(file,bytes); inputs[file] = sha(bytes);
    }
    return bytesCache.get(file);
  };
  const manifest = JSON.parse(read('content/manifest.json'));
  const worldFile = 'worlds/world_m1.world.json', def = JSON.parse(read(`content/${worldFile}`));
  const required = new Set([worldFile, ...def.structures.map(s => s.mesh ? `meshes/${s.mesh}.mesh.json` : `levels/${s.level}.level.json`)]);
  for (const file of manifest.files) if (file.startsWith('terrain/') && file.endsWith('.edits.json') || file.startsWith('masks/')) required.add(file);
  for (const file of required) if (!manifest.files.includes(file)) throw new Error(`chart: input absent from manifest: ${file}`);
  const manifestURL = pathToFileURL(path.join(root,'content/manifest.json')).href;
  const filtered = { ...manifest, files:manifest.files.filter(file => required.has(file)) };
  const bundle = await loadContentPack(manifestURL,{ fetchText:async url => url === manifestURL ? JSON.stringify(filtered) : read(path.relative(root,fileURLToPath(url)).replaceAll('\\','/')), fetchBytes:async url => readBytes(path.relative(root,fileURLToPath(url)).replaceAll('\\','/')) });
  const recipeFile = `design/levels/${def.terrain}.js`, context = { window:{ ASSETS:{} }, Math };
  vm.runInNewContext(read(recipeFile),context,{ filename:recipeFile, timeout:5000 });
  const recipe = context.window.ASSETS.levels[def.terrain];
  // Props/behaviours are irrelevant to terrain ring floors. No model scripts or gameplay run.
  const levels = Object.fromEntries(Object.entries(bundle.levels).map(([key,level]) => [key,{ ...level, props:[], entities:[], interactables:[], triggers:[] }]));
  const assets = new AssetRegistry({ palette:{}, levels, meshes:bundle.meshes, terrain:{ [def.terrain]:recipe }, terrainEdits:bundle.terrainEdits });
  const world = World.load({ ...def, entities:[], props:[], horizon:[], triggers:[], interactables:[], nav:null },assets);
  for (const file of ['engine/world/Terrain.js','engine/world/terrainEdits.js','engine/world/World.js']) read(file);
  const chart = bakeChart({ terrain:world.terrain, bounds:{ x0:0,y0:0,x1:recipe.map.w*recipe.map.cell,y1:recipe.map.h*recipe.map.cell }, structures:world.structures, water:def.water || [], roads:recipe.recipe.path ? [recipe.recipe.path] : [], inputs });
  const text = chartText(chart), output = path.join(root,CHART_PATH);
  if (check) checkChart(fs.readFileSync(output,'utf8'),chart);
  else { fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,text); }
  return chart;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const chart = await bakeRepository({ index:process.argv.includes('--index'), check:process.argv.includes('--check') }); console.log(`chart ${process.argv.includes('--check')?'check':'bake'} OK: ${chart.width}x${chart.rows}, ${Buffer.byteLength(chartText(chart))} bytes, ${chart.inputHash}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
