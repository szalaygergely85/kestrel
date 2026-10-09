// MESH-PLACE-01: the generated meadow props (world_m1 structures mdw###) keep the path, the route walk line, Burl, the waystone and every
// boar home clear, stay out of the tower footprint, and Burl's bush is the leafy Bush_Common. Run: node tools/meadow-clear.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PATH, ROUTE, PATH_HALF, ROUTE_CLEAR, HOME_CLEAR, TOWER, MEADOW, POOL, segDist, anchors, isMeadowId } from './gen-meadow-meshes.mjs';
import { World } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';

const data = JSON.parse(readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url)));
const mdw = data.structures.filter((s) => isMeadowId(s.id));
assert.ok(mdw.length >= 100 && mdw.length <= 300, `meadow prop count ${mdw.length} in 100..300`);
assert.equal(new Set(data.structures.map((s) => s.id)).size, data.structures.length, 'structure ids unique');
const allowed = new Set(Object.values(POOL).flat().map((n) => 'quaternius/' + n));
const classes = new Set(Object.entries(POOL).filter(([, v]) => v.some((n) => mdw.some((s) => s.mesh === 'quaternius/' + n))).map(([k]) => k));
for (const s of mdw) assert.ok(allowed.has(s.mesh), `${s.id} uses an existing content mesh (${s.mesh})`);
for (const c of ['bush', 'flowerBush', 'grass', 'mushroom', 'rock', 'pebble']) assert.ok(classes.has(c), `meadow has ${c}`);

const fixed = anchors(data);
assert.equal(fixed.length, 7, 'Burl + waystone + 5 boar homes');
const globalThisWindow = globalThis; globalThisWindow.window = globalThisWindow;
await import('../design/palette.js'); await import('../design/detail-pass.js'); await import('../design/levels/overworld_far.js');
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'menu_ui', 'notes', 'brazier']) await import(`../design/models/${m}.js`);
const { assets } = await loadTestAssets();
const origWarn = console.warn; console.warn = () => {};
const world = World.load(data, assets, { physics: 'mesh' });
console.warn = origWarn;
const T = world.terrain;

let minPath = Infinity, minRoute = Infinity, minAnchor = Infinity;
for (const s of mdw) {
  const { x, y } = s.origin;
  assert.ok(x >= MEADOW.x0 && x <= MEADOW.x1 && y >= MEADOW.y0 && y <= MEADOW.y1, `${s.id} inside the meadow box`);
  assert.ok(!(x > TOWER.x0 && x < TOWER.x1 && y > TOWER.y0 && y < TOWER.y1), `${s.id} not inside the tower footprint`);
  const pd = segDist(x, y, PATH), rd = segDist(x, y, ROUTE);
  assert.ok(pd >= PATH_HALF + 1, `${s.id} is ${pd.toFixed(2)} m from the path centre line (>= ${PATH_HALF + 1}: nothing on the path)`);
  assert.notEqual(T.groundTypeAt(x, y), 4, `${s.id} not on path-type ground`);
  assert.ok(rd >= ROUTE_CLEAR, `${s.id} is ${rd.toFixed(2)} m from the route walk line (>= ${ROUTE_CLEAR})`);
  for (const a of fixed) {
    const d = Math.hypot(a.x - x, a.y - y);
    assert.ok(d >= 3, `${s.id} is ${d.toFixed(2)} m from ${a.id} (>= 3 m clear radius)`);
    minAnchor = Math.min(minAnchor, d);
  }
  minPath = Math.min(minPath, pd); minRoute = Math.min(minRoute, rd);
}
const bush = data.structures.find((s) => s.id === 'burlBush');
assert.equal(bush.mesh, 'quaternius/Bush_Common', "Burl's bush is the leafy Bush_Common");
const burl = fixed.find((a) => a.id === 'bear');
const bd = Math.hypot(bush.origin.x - burl.x, bush.origin.y - burl.y);
assert.ok(bd >= 1 && bd <= 3, `Burl's bush stays 1-3 m from Burl (${bd.toFixed(2)})`);
console.log(`meadow-clear OK: ${mdw.length} props; min dist path ${minPath.toFixed(2)} route ${minRoute.toFixed(2)} anchors ${minAnchor.toFixed(2)}`);

// Owner: vegetation is walk-through, rocks stay solid. Walk a 0.3 m player circle straight across each piece at its own y.
const opts = { height: 1.7, stepUpMax: 0.45, walkCos: Math.cos(50 * Math.PI / 180) };
const o = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
function walkAcross(s, half = 3) {
  const y = s.origin.y, step = 0.05; let x = s.origin.x - half;
  for (let i = 0; i < 200 && x < s.origin.x + half - 1e-9; i++) {
    world.collideCircle(x, y, step, 0, 0.3, T.groundAt(x, y) + 0.001, true, opts, o);
    if (Math.abs(o.x - x - step) > 1e-6) { return o.x - s.origin.x; }   // stopped: x offset where it blocked
    x = o.x;
  }
  return Infinity;
}
const bushes = data.structures.filter((s) => /Bush_Common/.test(s.mesh || ''));
assert.ok(bushes.length >= 25 && bushes.some((b) => b.id === 'burlBush'), `bushes found (${bushes.length}) incl. burlBush`);
for (const n of ['Bush_Common', 'Bush_Common_Flowers']) assert.equal(JSON.parse(readFileSync(new URL(`../content/meshes/quaternius/${n}.mesh.json`, import.meta.url))).collide, false, `${n} mesh json has collide:false`);
let walked = 0;
const solidNear = (b) => data.structures.some((q) => q.mesh && /Rock_Medium|Tree|Pine/.test(q.mesh) && Math.hypot(q.origin.x - b.origin.x, q.origin.y - b.origin.y) < 6);   // a neighbouring rock / trunk may block the line
for (const b of bushes.filter((q) => !solidNear(q))) { const stop = walkAcross(b); if (stop === Infinity) walked++; else assert.ok(false, `${b.id}: player blocked by a bush at ${stop.toFixed(2)}`); }
const rocks = mdw.filter((s) => /Rock_Medium/.test(s.mesh));
const blockedRocks = rocks.filter((r) => walkAcross(r) !== Infinity);
assert.ok(walked >= 15, `enough isolated bushes walked (${walked})`);
assert.ok(rocks.length >= 3 && blockedRocks.length === rocks.length, `every rock blocks the player (${blockedRocks.length}/${rocks.length})`);
console.log(`walk-through OK: ${walked} bushes walked straight through; ${blockedRocks.length}/${rocks.length} rocks block`);
