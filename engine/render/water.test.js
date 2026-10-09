// US-055a2a (architecture.md 35.3, 35.11 step 2): the water layer's mesh + JS twin (flat water, A = 0).
// Clipmap topology, ring-seam coverage, origin snapping, occluder, region clip, selection, mock-device buffers, allocation.
// Run: node --expose-gc engine/render/water.test.js
import { buildClipmap, getClipmap, WATER_RING_HALF, WATER_RING_STEP, WATER_SNAP, waterVertexJS, waterInsideJS } from '../mesh/waterMesh.js';
import { selectWater, createWaterSelection, renderWaterJS, ringRuns, WATER_REGION_SLOTS } from './water.js';
import { createWater, collectWaterDefs } from '../world/water.js';
import { projTerms, shearProjection, projectPoint } from './projection.js';
import { frustumPlanes } from '../mesh/culling.js';
import { WaterLayer } from './gpu/waterLayer.js';
import { makeOk, makeMockGpuDevice } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const rect = (id, r, z) => ({ id, shape: 'rect', rect: r, z });
const circ = (id, c, r, z) => ({ id, shape: 'circle', c, r, z });
const mkWorld = (list) => ({ water: createWater(collectWaterDefs({ water: list }, [])) });

const COLS = 160, ROWS = 60;
const grid = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 2 };
const terms = {};
const M = new Float64Array(16);
const planes = new Float64Array(24);
/** Builds a frame: M, planes, an fb with a sky-everywhere scene depth. */
function frame(cam) {
  projTerms(cam, grid, terms);
  shearProjection(terms, M);
  frustumPlanes(M, planes);
  return { gbuf: { cols: COLS, rows: ROWS }, depth: { depth: new Float32Array(COLS * ROWS).fill(Infinity) }, water: null };
}

// ---- 1. clipmap topology ----
{
  const cm = buildClipmap();
  ok('clipmap: ~14.7k vertices, ~27.3k triangles (35.3: ~13.6k / 26.6k)', cm.vertCount > 13000 && cm.vertCount < 15500 && cm.triCount > 26000 && cm.triCount < 28500, `${cm.vertCount} / ${cm.triCount}`);
  ok('clipmap: 5 contiguous index ranges (4 rings + skirt)', cm.rangeStart[0] === 0 && cm.rangeStart[5] === cm.index.length && cm.rangeStart.every((v, i) => i === 0 || v >= cm.rangeStart[i - 1]));
  ok('clipmap: ring 0 is 64x64 quads (8192 tris), rings 1..3 are 32-quad-hole annuli', cm.rangeStart[1] - cm.rangeStart[0] === 64 * 64 * 2 * 3 && cm.rangeStart[2] - cm.rangeStart[1] > 3072 * 2 * 3);
  const v = cm.verts, idx = cm.index;
  let neg = 0, zero = 0, area = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 4, b = idx[t + 1] * 4, c = idx[t + 2] * 4;
    const A = (v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[b + 1] - v[a + 1]) * (v[c] - v[a]);
    if (A < 0) neg++; else if (A === 0) zero++;
    area += A / 2;
  }
  ok('clipmap: every triangle CCW from above, none degenerate', neg === 0 && zero === 0, `neg ${neg} zero ${zero}`);
  ok('clipmap: total area = the full +-1900 m square (no overlap, no hole)', area === 3800 * 3800, `${area}`);
  // watertight: after merging equal positions, every edge is shared by exactly 2 triangles except the 4 outer skirt edges
  const rep = new Int32Array(cm.vertCount), seen = new Map();
  for (let i = 0; i < cm.vertCount; i++) { const k = v[i * 4] + ',' + v[i * 4 + 1]; if (!seen.has(k)) seen.set(k, i); rep[i] = seen.get(k); }
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = rep[idx[t + e]], b = rep[idx[t + (e + 1) % 3]];
    const k = a < b ? a * 65536 + b : b * 65536 + a;
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  let open = 0, over = 0;
  for (const [k, n] of edges) {
    if (n > 2) over++;
    else if (n === 1) {
      const a = Math.floor(k / 65536), b = k % 65536;
      const onBorder = Math.abs(v[a * 4]) === 1900 && Math.abs(v[b * 4]) === 1900 && v[a * 4] === v[b * 4] || Math.abs(v[a * 4 + 1]) === 1900 && Math.abs(v[b * 4 + 1]) === 1900 && v[a * 4 + 1] === v[b * 4 + 1];
      if (!onBorder) open++;
    }
  }
  ok('clipmap: watertight - no open edge inside the skirt border, no edge shared by 3', open === 0 && over === 0, `open ${open} over ${over}`);
  // every ring vertex sits on its ring's grid; stitch vertices are on a ring's outer / hole boundary
  let offGrid = 0, badStitch = 0;
  for (let i = 0; i < cm.vertCount; i++) {
    const ring = v[i * 4 + 2], st = v[i * 4 + 3];
    if (ring < 4) {
      const s = WATER_RING_STEP[ring];
      if (Math.abs(v[i * 4] / s - Math.round(v[i * 4] / s)) > 0 && st === 0) offGrid++;
      if (st !== 0) {
        const h = WATER_RING_HALF[ring], onOuter = Math.abs(v[i * 4]) === h || Math.abs(v[i * 4 + 1]) === h;
        const hi = ring > 0 ? WATER_RING_HALF[ring - 1] : -1, onHole = Math.abs(v[i * 4]) === hi || Math.abs(v[i * 4 + 1]) === hi;
        if (!onOuter && !onHole) badStitch++;
      }
    }
  }
  ok('clipmap: ring vertices on their grid, stitch flags only on ring boundaries', offGrid === 0 && badStitch === 0, `off ${offGrid} stitch ${badStitch}`);
  ok('clipmap: shared singleton', getClipmap() === getClipmap());
}

// ---- 2. ring-seam fixture: every pixel written exactly once ----
{
  const world = mkWorld([rect('sea', [-4000, -4000, 4000, 4000], 0)]);
  const cams = [
    { x: 0.3, y: 0.7, z: 20, yawDeg: 0, pitchDeg: -10 },
    { x: 3.9, y: -3.9, z: 20, yawDeg: 37, pitchDeg: -10 },
    { x: -123.4, y: 55.5, z: 12, yawDeg: 200, pitchDeg: -5 },
    { x: 4.1, y: 4.1, z: 60, yawDeg: 90, pitchDeg: -25 },
    { x: 1000.25, y: -2000.5, z: 8, yawDeg: 311, pitchDeg: -3 },
  ];
  for (let ci = 0; ci < cams.length; ci++) {
    const cam = cams[ci];
    const fb = frame(cam);
    const t = renderWaterJS(fb, world, cam, M, planes, true);
    let multi = 0, missing = 0, below = 0;
    const slack = 3; // rows right under the horizon are hits beyond the 1900 m skirt
    for (let row = Math.ceil(terms.horizonRow) + slack; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = row * COLS + col;
        below++;
        if (t.writes[i] > 1) multi++;
        if (t.writes[i] === 0) missing++;
      }
    }
    let anyMulti = 0;
    for (let i = 0; i < t.writes.length; i++) if (t.writes[i] > 1) anyMulti++;
    ok(`seams cam#${ci}: every ground pixel written exactly once (${below} px)`, multi === 0 && missing === 0 && anyMulti === 0, `multi ${multi} missing ${missing} anyMulti ${anyMulti}`);
    let backs = 0;
    for (let i = 0; i < t.kind.length; i++) if (t.kind[i] && (t.objectId[i] & 16)) backs++;
    ok(`seams cam#${ci}: seen from above = no back faces`, backs === 0);
  }
  // from below: the same layer is drawn with the back bit
  const cam = { x: 0, y: 0, z: -3, yawDeg: 0, pitchDeg: 20 };
  const fb = frame(cam);
  const t = renderWaterJS(fb, world, cam, M, planes, false);
  let w = 0, b = 0;
  for (let i = 0; i < t.kind.length; i++) if (t.kind[i]) { w++; if (t.objectId[i] & 16) b++; }
  ok('from below: water is drawn and every texel carries the back bit', w > 0 && b === w, `${w} ${b}`);
}

// ---- 3. origin snapping: vertex world positions unchanged while the eye moves < 4 m ----
{
  const world = mkWorld([rect('sea', [-500, -500, 500, 500], 0)]);
  const sel = createWaterSelection();
  const cam = { x: 0, y: 0, z: 10, yawDeg: 0, pitchDeg: -10 };
  frame(cam);
  selectWater(world, cam, planes, sel);
  const o0x = sel.O[0], o0y = sel.O[1];
  let same = true;
  const cm = getClipmap();
  for (let k = 0; k < 40; k++) {
    const ang = k * 0.7;
    cam.x = 3.99 * Math.cos(ang) * (k / 40); cam.y = 3.99 * Math.sin(ang) * (k / 40);
    frame(cam); selectWater(world, cam, planes, sel);
    if (sel.O[0] !== o0x || sel.O[1] !== o0y) same = false;
  }
  ok('eye within 4 m of O: O (hence every vertex world position O + l) is unchanged', same && o0x === 0 && o0y === 0);
  // moving further: O moves in WATER_SNAP steps and every ring vertex stays on its world grid
  let grid = true;
  for (const ex of [4.01, 11.9, -4.01, 100.3, -77.77, 12345.6]) {
    cam.x = ex; cam.y = -ex * 0.37; frame(cam); selectWater(world, cam, planes, sel);
    if (sel.O[0] % WATER_SNAP !== 0 || sel.O[1] % WATER_SNAP !== 0) grid = false;
    if (Math.abs(sel.O[0] - cam.x) > 4 || Math.abs(sel.O[1] - cam.y) > 4) grid = false;
    for (let i = 0; i < cm.vertCount; i += 7) {
      const ring = cm.verts[i * 4 + 2];
      if (ring >= 4) continue;
      const wx = sel.O[0] + cm.verts[i * 4], s = WATER_RING_STEP[ring] / 2; // half-step (conforming midpoints)
      if (Math.abs(wx / s - Math.round(wx / s)) > 1e-9) grid = false;
    }
  }
  ok('eye far away: O snaps to 8 m, |eye - O| <= 4, every vertex on a fixed world grid', grid);
  cam.x = 0; cam.y = 0;
}

// ---- 4. occluder: a wall hides water ----
{
  const world = mkWorld([rect('pool', [-200, -200, 200, 200], 0)]);
  const cam = { x: 0, y: 0, z: 5, yawDeg: 0, pitchDeg: -10 };
  const fb = frame(cam);
  const clear = renderWaterJS(fb, world, cam, M, planes, false);
  const baseline = clear.kind.slice();
  const dBase = clear.depth.slice();
  // a "wall" 2 m away over the left half of the screen
  const sd = fb.depth.depth;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS / 2; col++) sd[row * COLS + col] = 2;
  const t = renderWaterJS(fb, world, cam, M, planes, false);
  let leftWater = 0, rightLost = 0, rightKept = 0;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const i = row * COLS + col;
    if (col < COLS / 2) { if (t.kind[i]) leftWater++; } else if (baseline[i]) { if (t.kind[i] && t.depth[i] === dBase[i]) rightKept++; else rightLost++; }
  }
  ok('wall: no water texel behind the wall cells', leftWater === 0, `${leftWater}`);
  ok('wall: water elsewhere is untouched', rightLost === 0 && rightKept > 100, `${rightLost} ${rightKept}`);
  // a floor above the water (shallows): scene depth just nearer than the water hides it, just farther shows it
  const probe = baseline.findIndex((k, i) => k && i % COLS === 80 && (i / COLS | 0) > ROWS - 6);
  const dW = dBase[probe];
  sd.fill(Infinity); sd[probe] = dW - 0.01;
  let t2 = renderWaterJS(fb, world, cam, M, planes, false);
  ok('occluder: scene nearer than the water by 1 cm hides the texel', t2.kind[probe] === 0);
  sd[probe] = dW + 0.01;
  t2 = renderWaterJS(fb, world, cam, M, planes, false);
  ok('occluder: scene farther than the water by 1 cm shows it, vD within 1e-3', t2.kind[probe] === 1 && Math.abs(t2.depth[probe] - dW) < 1e-3);
}

// ---- 5. region clip: circle (and rect edges) ----
{
  const world = mkWorld([circ('pond', [0, -12], 5, 0.5)]);
  const cam = { x: 0, y: 0, z: 6, yawDeg: 0, pitchDeg: -10 };
  const fb = frame(cam);
  const t = renderWaterJS(fb, world, cam, M, planes, false);
  const p4 = new Float64Array(4);
  let inHit = 0, inMiss = 0, outHit = 0, outTot = 0, inTot = 0;
  for (let a = -20; a <= 20; a++) for (let b = -20; b <= 20; b++) {
    const wx = a * 0.75, wy = -12 + b * 0.75, r = Math.hypot(wx, wy + 12);
    if (Math.abs(r - 5) < 0.4) continue;
    projectPoint(M, COLS, ROWS, wx, wy, 0.5, p4);
    if (p4[3] <= 0) continue;
    const col = Math.floor(p4[0]), row = Math.floor(p4[1]);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
    const hit = t.kind[row * COLS + col] !== 0;
    if (r < 5) { inTot++; if (hit) inHit++; else inMiss++; } else { outTot++; if (hit) outHit++; }
  }
  ok('circle clip: interior points are water, exterior points are not', inTot > 50 && outTot > 50 && inMiss <= inTot * 0.04 && outHit <= outTot * 0.04, `in ${inHit}/${inTot} out-hit ${outHit}/${outTot}`);
  // only the pond's draw: total covered cells ~ disc area on screen, and nothing outside the pond's AABB rows
  const world2 = mkWorld([rect('r', [-3, -14, 3, -8], 0.5)]);
  const t3 = renderWaterJS(frame(cam), world2, cam, M, planes, false);
  let rectOut = 0, rectIn = 0, rectInTot = 0;
  for (let a = -10; a <= 10; a++) for (let b = -20; b <= 10; b++) {
    const wx = a * 0.6, wy = -11 + b * 0.5;
    if (Math.abs(wx) > 2.7 && Math.abs(wx) < 3.3) continue;
    if (Math.abs(wy + 8) < 0.3 || Math.abs(wy + 14) < 0.3) continue;
    projectPoint(M, COLS, ROWS, wx, wy, 0.5, p4);
    if (p4[3] <= 0) continue;
    const col = Math.floor(p4[0]), row = Math.floor(p4[1]);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
    const inside = Math.abs(wx) < 3 && wy > -14 && wy < -8, hit = t3.kind[row * COLS + col] !== 0;
    if (inside) { rectInTot++; if (hit) rectIn++; } else if (hit) rectOut++;
  }
  ok('rect clip: inside is water, outside is not', rectInTot > 30 && rectIn >= rectInTot * 0.95 && rectOut <= 12, `in ${rectIn}/${rectInTot} out ${rectOut}`);
  // pixel depth really is the plane: unproject-free check via the eye height: d = (z_eye - z_w) / slope
  let depthOk = 0, depthTot = 0;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const i = row * COLS + col;
    if (!t3.kind[i]) continue;
    const slope = (terms.horizonRow - row) / terms.planeDistY; // z = eyeZ + slope * d
    const d = (0.5 - cam.z) / slope;
    depthTot++;
    if (Math.abs(d - t3.depth[i]) < 0.02 * d + 0.02) depthOk++;
  }
  ok('water texel depth = the analytic ray/plane distance (within 2 %)', depthTot > 50 && depthOk === depthTot, `${depthOk}/${depthTot}`);
}

// ---- 6. selection: slots, frustum, eye region first, ring runs ----
{
  const list = [];
  for (let i = 0; i < 12; i++) list.push(rect('p' + i, [i * 30 - 150, -40, i * 30 - 120, -20], 0));
  list.push(rect('eye', [-5, -5, 5, 5], 4));
  const world = mkWorld(list);
  const cam = { x: 0, y: 0, z: 3, yawDeg: 0, pitchDeg: -5 };
  frame(cam);
  const sel = createWaterSelection();
  selectWater(world, cam, planes, sel);
  const regionIdx = (id) => world.water.ids.indexOf(id);
  ok('select: at most 8 regions, the one holding the eye is slot 0', sel.count <= WATER_REGION_SLOTS && sel.count > 0 && sel.region[0] === regionIdx('eye'), `${sel.count} ${sel.region[0]}`);
  ok('select: eye below the surface flags the slot (composite skips it until 144a)', sel.u[11] === 1);
  // facing away from every region except the eye one
  const away = { x: 0, y: 0, z: 3, yawDeg: 180, pitchDeg: -5 };
  frame(away); selectWater(world, away, planes, sel);
  ok('select: frustum culls regions behind the camera', sel.count === 1 && sel.region[0] === regionIdx('eye'), `${sel.count}`);
  const w2 = mkWorld([rect('a', [0, -90, 10, -70], 0), rect('b', [0, -40, 10, -20], 0)]);
  frame(cam); selectWater(w2, cam, planes, sel);
  ok('select: nearest AABB first', sel.count === 2 && sel.region[0] === 1 && sel.region[1] === 0);
  // ring runs
  const runs = new Int32Array(7);
  const rs = getClipmap().rangeStart;
  ringRuns(-1, -1, 1, 1, runs, 0);
  ok('ringRuns: a 2 m box at O needs ring 0 only', runs[0] === 1 && runs[1] === rs[0] && runs[2] === rs[1] - rs[0]);
  ringRuns(-20, -20, 20, 20, runs, 0);
  ok('ringRuns: a 40 m box = rings 0+1 merged into one run', runs[0] === 1 && runs[1] === rs[0] && runs[2] === rs[2] - rs[0], `${runs[0]} ${runs[2]}`);
  ringRuns(-1000, -1000, 1000, 1000, runs, 0);
  ok('ringRuns: a 2 km box = everything incl. the skirt, one run', runs[0] === 1 && runs[2] === rs[5] - rs[0]);
  ringRuns(40, 40, 60, 60, runs, 0);
  ok('ringRuns: a box in ring 2 only skips rings 0, 1, 3 and the skirt', runs[0] === 1 && runs[1] === rs[2] && runs[2] === rs[3] - rs[2], `${runs[0]} ${runs[1]} ${runs[2]}`);
  ringRuns(150, 150, 170, 170, runs, 0);
  ok('ringRuns: a box outside ring 3 = the skirt only', runs[0] === 1 && runs[1] === rs[4] && runs[2] === rs[5] - rs[4]);
}

// ---- 7. mock device: static buffers once, nothing per frame ----
{
  const mock = makeMockGpuDevice();
  const layer = new WaterLayer(mock.device);
  const clip = layer.clipmap();
  const afterBuild = mock.createCount;
  ok('WaterLayer: clipmap = one vertex buffer + one index buffer, built once', afterBuild === 2 && clip.vertexBuffer && clip.indexBuffer && clip.indexType === 'u16');
  layer.resize(160, 60);
  const afterResize = mock.createCount;
  ok('WaterLayer: WATER target + composite target = 3 + 3 handles (US-055a2b adds compFg/compBg/compTarget)', afterResize === afterBuild + 6, `${afterResize - afterBuild}`);
  for (let f = 0; f < 200; f++) { layer.clipmap(); layer.resize(160, 60); }
  ok('mock device: no buffer / texture / target created per frame', mock.createCount === afterResize && mock.writeCount === 0);
  layer.resize(200, 80);
  ok('WaterLayer: a grid resize re-creates both targets (6) and frees the old ones', mock.createCount === afterResize + 6 && mock.liveCount() === 2 + 6);
  layer.dispose();
  ok('WaterLayer: dispose frees everything', mock.liveCount() === 0);
}

// ---- 8. zero allocation ----
{
  const world = mkWorld([rect('sea', [-300, -300, 300, 300], 0), circ('pond', [40, 40], 9, 0.3)]);
  const cam = { x: 3, y: 4, z: 9, yawDeg: 25, pitchDeg: -12 };
  const fb = frame(cam);
  const sel = createWaterSelection();
  const run = (n) => { for (let i = 0; i < n; i++) { selectWater(world, cam, planes, sel); renderWaterJS(fb, world, cam, M, planes, false); } };
  run(1500); // warm the JIT first (tier-up boxes doubles for a while)
  if (globalThis.gc) {
    let grown = Infinity;
    for (let r = 0; r < 3; r++) {
      globalThis.gc();
      const m0 = process.memoryUsage().heapUsed;
      run(100);
      grown = Math.min(grown, process.memoryUsage().heapUsed - m0);
    }
    ok('zero allocation: 100 select + JS-twin frames grow the heap < 64 KB', grown < 65536, `${grown} B`);
  } else console.log('(run with --expose-gc for the allocation check)');
  const t0 = process.hrtime.bigint();
  run(20);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  console.log(`perf: select + JS twin, 160x60, 2 regions: ${ms.toFixed(2)} ms/frame`);
  if (ms > 2) console.warn(`WARN JS twin ${ms.toFixed(2)} ms > 2 ms (warn-only, 35.9)`);
}

// ---- 9. the vertex / fragment twins (exported JS) and the GLSL sources ----
{
  const sel = createWaterSelection();
  const world = mkWorld([rect('r', [10, 20, 14, 26], 2.5), circ('c', [-30, 5], 4, 1)]);
  const cam = { x: 12, y: 23, z: 5, yawDeg: 0, pitchDeg: -30 };
  frame(cam);
  selectWater(world, cam, planes, sel);
  const out3 = new Float64Array(3);
  const slotOf = (i) => { for (let s = 0; s < sel.count; s++) if (sel.region[s] === i) return s * 16; return -1; };
  const b = slotOf(0);
  if (b >= 0) {
    waterVertexJS(sel.u, b, -1000, 1000, out3);
    ok('vertex twin: clamps to the grown AABB (+-0.5 m), z = the region z', out3[0] === 10 - 0.5 - sel.O[0] && out3[1] === 26.5 - sel.O[1] && out3[2] === 2.5, `${out3}`);
    waterVertexJS(sel.u, b, 11 - sel.O[0], 21 - sel.O[1], out3);
    ok('vertex twin: a vertex inside the AABB is untouched', out3[0] === 11 - sel.O[0] && out3[1] === 21 - sel.O[1]);
    ok('fragment twin: rect is half-open [x0,x1)', waterInsideJS(sel.u, b, 10 - sel.O[0], 20 - sel.O[1]) && !waterInsideJS(sel.u, b, 14 - sel.O[0], 22 - sel.O[1]) && !waterInsideJS(sel.u, b, 9.99 - sel.O[0], 22 - sel.O[1]));
  } else ok('twin fixture selects the rect', false);
}

console.log(`water.layer.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
