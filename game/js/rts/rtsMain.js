// game/js/rts/rtsMain.js - RTS-01a dev bootstrap (docs/architecture.md 28.8), loaded by game/rts-test.html.
// Own loop, NOT main.js: builds the AssetRegistry the same way main.js does (2 lines), forces the mesh renderer,
// loads world_m1 (the tower stays as a terrain landmark), places ~200 team-coloured units (sim/), draws them as
// `engine.instances` (ui/unitsView.js), and runs the pitched RTS camera + selection (ui/input.js, ui/select.js).
// Params: ?n=20..500 units (default 200), ?grid=400x150 (default) | 240x90, ?f3=1 stats at start.
// Imports only engine/index.js (check-deps rule 3).
import {
  AssetRegistry, loadContentPack, createEngine, clampGrid, bindShading, bindLevel, repackMaterials, GBuffer,
  createRenderer, VoxelPool, buildLightSet, makeLightBuffer,
  createRtsCamera, updateRtsCamera, createPitchedTerms, pitchedTerms, screenRay, pickNearest, selectInRect, worldToCell, rayTerrain,
  WG_PASS_NAMES,
} from '../../../engine/index.js';
import { createSpriteSystem } from '../dev/spriteDev.js'; // atlas + pool the WG sprite/overlay passes bind to (stays empty here)
import { prebuildTerrainMesh } from '../dev/terrainPrebuild.js'; // load-time terrain mesh build (engine/dev.js stays in game/js/dev)
import { UNIT_MODEL_KEY, makeUnitModelDef, RTS_TEAM_SPEC } from './unitModel.js';
import { createUnits, TEAM_OWN, TEAM_ENEMY, UNIT_HEIGHT } from './sim/units.js';
import { simStep, createSim, CMD_MOVE, PLAYER_1, POS_SCALE } from './sim/tick.js';
import { buildNavGrid, PLAY_AREA } from './sim/navSetup.js';
import { placeUnits } from './sim/place.js';
import { createRtsInput, ACT_NONE, ACT_CLICK, ACT_BOX, ACT_MOVE } from './ui/input.js';
import { createSelection, selectClick, selectBox, selectedIds } from './ui/select.js';
import { createUnitsView } from './ui/unitsView.js';
import { createHud, createStatRing } from './ui/hud.js';

const params = new URLSearchParams(window.location.search);
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('screen'));
const N_UNITS = Math.max(20, Math.min(500, parseInt(params.get('n') || '200', 10) || 200));
const SEED = 0x5eed;
const PLACE = { cx: 1452, cy: 1040, radius: 40, minDist: 1.1 }; // hillside west of the tower
const WIDTH_M = 30;                                              // ground width across the screen at default zoom

function fail(msg) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#f88;background:#000;font:16px monospace;padding:2em;text-align:center';
  d.textContent = msg;
  document.body.append(d);
  throw new Error(msg);
}

// ---- content (same as main.js) + the placeholder unit model -------------------------------------------------
const bundle = await loadContentPack('../content/manifest.json');
const assets = AssetRegistry.fromJSON(bundle, window.ASSETS);
assets.add('model', UNIT_MODEL_KEY, makeUnitModelDef());

// ---- engine + GPU mesh pipeline -----------------------------------------------------------------------------
const gridM = /^(\d+)x(\d+)$/i.exec((params.get('grid') || '400x150').trim());
const grid = clampGrid(gridM ? Number(gridM[1]) : 400, gridM ? Number(gridM[2]) : 150);
// RTS-WG-01: WebGPU only (WebGL2 is gone). createRenderer builds the webgpu target + WgCellPipeline (wgPipeline); on failure
// it falls back to webgl2, which this page cannot use, so fail loudly.
const built = await createRenderer({ canvas, cols: grid.cols, rows: grid.rows, backend: 'webgpu', gpu: true, rays: 2, terrainEnabled: true,
  shadows: { sun: 'map' } /* ME-19c2: sun DDA retired, shadow map */ });
const rt0 = built.rt, wgPipeline = built.pipeline;
if (rt0.backend !== 'webgpu' || !wgPipeline || !wgPipeline.ready) fail('RTS page needs WebGPU (WgCellPipeline not ready; ' + built.info.label + ')');
const engine = createEngine({ canvas, assets, cols: grid.cols, rows: grid.rows, rays: 2, gpu: true,
  renderTarget: rt0, renderPipeline: wgPipeline,
  uiGrid: (assets.uiStyle && assets.uiStyle.uiGrid) || { cols: 160, rows: 60 } });
const rt = engine.renderTarget;
// The UI layer starts opaque and is drawn over the scene by rt.present(); the RTS page draws no UI
// cells (HUD is DOM), so clear it once - otherwise the whole canvas presents black (main.js clears per frame).
engine.ui.clear();
const P = assets.palette;
const matTable = bindShading(P, assets.detailPass, rt.pxCellH / rt.pxCellW);
if (!matTable.allV2) fail('material table not V2 (missingV2: ' + (matTable.missingV2 || []).join(',') + ')');
wgPipeline.bind(matTable, P);
wgPipeline.setWaterLooks(window.ASSETS.waterLooks);
const voxelPool = new VoxelPool();
voxelPool.bind(assets, matTable);
voxelPool.renderer = 'mesh'; engine.overlay.renderer = 'mesh';
wgPipeline.bindVoxels(voxelPool);
engine.attachMaterialTable(matTable);
engine.instances.bindPool(voxelPool);
wgPipeline.bindInstances(engine.instances);
wgPipeline.bindViewModel(engine.viewModel);
const sprites = createSpriteSystem({ assets, rt, gpuPipeline: null, wgPipeline });
wgPipeline.bindSprites({ pool: sprites.pool, atlas: sprites.atlas, palette: P, particleLayer: engine.particleLayer, overlay: engine.overlay });
if (wgPipeline.spritesCompiled) await wgPipeline.spritesCompiled;
if (!wgPipeline.frameComplete) fail('WgCellPipeline frame not complete (sprites/overlay/water/shadow passes)');
if (rt.cols !== grid.cols || rt.rows !== grid.rows) { engine.setGrid(grid.cols, grid.rows, { immediate: true }); wgPipeline.bind(matTable, P); } // createRenderer builds at the CPU grid
const gbuf = new GBuffer(rt.cols, rt.rows);
engine.setTeamMaterials(RTS_TEAM_SPEC);

// ---- world, nav, sim ------------------------------------------------------------------------------------------
const world = engine.loadWorld(assets.world('world_m1'));
for (const s of world.structures) { if (s.kind === 'mesh') continue; bindLevel(matTable, s.level); repackMaterials(s.packed, s.level, matTable); }
const lightSet = buildLightSet(world, P);
const terrain = world.terrain;
const groundAt = (x, y) => terrain.groundAt(x, y);
terrain.bakeFarSync(); // the spike has no streaming budget to hide the far bake: do it once at load
const tmesh0 = performance.now();
prebuildTerrainMesh(terrain); // near band + far tiles now, not over the first seconds
console.log(`[rts] terrain mesh prebuilt in ${(performance.now() - tmesh0).toFixed(0)} ms`);
const nav = buildNavGrid(world);
const units = createUnits(N_UNITS);
const placed = placeUnits(units, N_UNITS, SEED, nav, PLACE);
if (placed < N_UNITS) console.warn(`[rts] placed ${placed}/${N_UNITS} units (area too crowded)`);
const sim = createSim(units, nav); // steer + command queue + flow fields (sim/tick.js)

// ---- presentation: camera, units view, selection, overlay ---------------------------------------------------
const rts = createRtsCamera({
  bounds: { x0: PLAY_AREA.x0 + 15, y0: PLAY_AREA.y0 + 15, x1: PLAY_AREA.x0 + PLAY_AREA.w - 15, y1: PLAY_AREA.y0 + PLAY_AREA.h - 15 },
  widthM: WIDTH_M, pitchDeg: -58, yawDeg: 0, heightFn: groundAt,
});
rts.focusX = PLACE.cx; rts.focusY = PLACE.cy; rts.focusZ = groundAt(PLACE.cx, PLACE.cy);
const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, projection: 'pitched', vfovDeg: 36, focusX: 0, focusY: 0, focusZ: 0 };
const terms = createPitchedTerms();
const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
const view = createUnitsView(engine, world, units, UNIT_MODEL_KEY);
const sel = createSelection(units.max);
const idsScratch = new Int32Array(units.max);
const rayHit = { x: 0, y: 0, z: 0, t: 0, hit: false };
const marker = { t: -1, x: 0, y: 0 }; // right-click target marker (presentation only)
const MARKER_SEC = 0.5;
const input = createRtsInput(canvas, rt);
const ov = engine.overlay;
ov.setStyles({
  select: { glyphs: '-|\\/', fg: [255, 232, 90] },
  hover: { glyph: '.', fg: [255, 255, 255] },
  hoverEnemy: { glyph: '.', fg: [255, 120, 120] },
  barFill: { glyph: '=', fg: [70, 235, 70] },
  barEmpty: { glyph: '.', fg: [90, 90, 90] },
  box: { glyphs: '-|++', fg: [255, 255, 255] },
  marker: { glyphs: '-|\\/', fg: [120, 255, 255] },
});
const S_SELECT = ov.styleId('select'), S_HOVER = ov.styleId('hover'), S_HOVER_ENEMY = ov.styleId('hoverEnemy');
const S_FILL = ov.styleId('barFill'), S_EMPTY = ov.styleId('barEmpty'), S_BOX = ov.styleId('box'), S_MARKER = ov.styleId('marker');
ov.setGroundFn(groundAt);

const fb = {
  rt, depth: engine.depthBuffer, palette: P, lights: lightSet,
  light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0, gbuf, matTable, detailPass: assets.detailPass,
  voxelPool, instances: engine.instances, viewModel: engine.viewModel, gpu: true, renderer: 'mesh', cpuLightCap: false, sceneFade: 1, terrainEnabled: true,
};

// ---- HUD / stats ------------------------------------------------------------------------------------------------
const hud = createHud(params.get('f3') === '1');
const simRing = createStatRing(), jsRing = createStatRing();
// BUG-RTS-002 bench hook (`?bench=1`, "if cheap"): cheap warmup+measure pass over the current camera focus (RTS
// has one fixed view, unlike main.js's 3-pose ?bench=1 - no teleporting needed). RE-15d compares two separate
// page loads (`?lod=8` vs `?lod=0`, matching RE-15c's own `?bench=1&units=200&lod=8` precedent) against each
// run's own `voxel` raster-pass p50 for the delta AC, plus the RE-15 instance stats (drawn/culled/lod1).
const BENCH = params.get('bench') === '1';
const BENCH_WARMUP = 90, BENCH_MEASURE = 300;
let benchFrame = 0;
const benchGpuRing = BENCH ? createStatRing() : null;
if (BENCH) wgPipeline.setPassTiming(true); // force pass timing on even with no HUD (perfBench.js's own precedent)
let snapReq = null; // dev: one-shot readback request (tools/capture-rts.mjs)
const lastBox = { k: -1, c0: 0, r0: 0, c1: 0, r1: 0 }; // dev: last resolved box (read by tools/capture-rts.mjs)
let simAcc = 0, hoverId = -1, onScreen = 0, lastHudMs = 0, simTime = 0, lastFrameT = performance.now(), prevJsMs = 0;

const scr = new Float64Array(3);
function countOnScreen(n) {
  let c = 0;
  for (let i = 0; i < n; i++) {
    worldToCell(terms, view.pos[i * 3], view.pos[i * 3 + 1], view.pos[i * 3 + 2], scr);
    if (scr[2] > 0 && scr[0] >= 0 && scr[0] < rt.cols && scr[1] >= 0 && scr[1] < rt.rows) c++;
  }
  return c;
}
/** Right click: target = the picked unit's position (b3: enemy or own, no attack) or the terrain under the cursor. */
function issueMove(col, row, n) {
  const k = selectedIds(sel, n, idsScratch);
  if (!k) return;
  screenRay(terms, col, row, ray);
  const hit = pickNearest(ray, view.pos, view.radii, view.heights, n);
  let x, y;
  if (hit >= 0) { x = view.pos[hit * 3]; y = view.pos[hit * 3 + 1]; }
  else {
    rayTerrain(terrain, ray, rayHit);
    if (!rayHit.hit) return;
    x = rayHit.x; y = rayHit.y;
  }
  sim.q.issue(PLAYER_1, CMD_MOVE, idsScratch, k, Math.round(x * POS_SCALE), Math.round(y * POS_SCALE));
  marker.t = 0; marker.x = x; marker.y = y;
}
const f2 = (v) => (Number.isNaN(v) ? 'n/a' : v.toFixed(2));
function hudText(n) {
  onScreen = countOnScreen(n);
  const ps = wgPipeline.stats, st = engine.loop.stats;
  let own = 0; for (let i = 0; i < n; i++) if (units.team[i] === TEAM_OWN) own++;
  hud.setF3Text(
    `RTS-01b  grid ${rt.cols}x${rt.rows}  renderer mesh  fps ${engine.loop.fps.toFixed(0)}  zoom ${rts.zoom.toFixed(2)}\n` +
    `units ${n} (own ${own})  on screen ${onScreen}  selected ${sel.count}  moving ${sim.moving}  hover ${hoverId}\n` +
    `instancedDraws ${ps.instancedDraws}  instances ${ps.instances}  voxelDraws ${ps.voxelDraws}\n` +
    `sim ms p50/p95 ${f2(simRing.pct(0.5))}/${f2(simRing.pct(0.95))}  JS ms p50/p95 ${f2(jsRing.pct(0.5))}/${f2(jsRing.pct(0.95))}  over25 ${st.over25}/${st.frames}\n` +
    `GPU ms p50/p95 ${f2(ps.gpuMsP50)}/${f2(ps.gpuMsP95)}\n` +
    `overlay ops ${ov.stats.ops} dropped ${ov.stats.dropped} cells ${ov.stats.cells}\n` +
    'wg pass ms p50: ' + WG_PASS_NAMES.map((nm, i) => `${nm} ${f2(ps.wgPassMsP50[i])}`).join('  '));
}

engine.run({
  update() {
    const t0 = performance.now();
    simStep(sim);
    simAcc += performance.now() - t0;
  },
  render(alpha) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrameT) / 1000);
    lastFrameT = now;
    simTime += dt;
    if (input.f3Pressed) { input.f3Pressed = false; hud.toggleF3(); }

    // camera (presentation: frame dt), then the unit view at the same instant
    const camIn = input.beginFrame();
    rts.opts.edgePx = input.edgePx; // 2 cells, css px (the input is in css px too)
    updateRtsCamera(rts, dt, camIn, rt, cam);
    view.update(alpha, dt);
    pitchedTerms(cam, rt, terms);
    const n = units.count;

    // hover (not while dragging a box / panning)
    hoverId = -1;
    if (input.hasMouse && !input.boxActive && input.panButton < 0) {
      screenRay(terms, input.cellCol, input.cellRow, ray);
      hoverId = pickNearest(ray, view.pos, view.radii, view.heights, n);
    }
    // pending click / box (resolved against this frame's camera)
    if (input.act !== ACT_NONE) {
      if (input.act === ACT_CLICK) {
        screenRay(terms, input.actCol, input.actRow, ray);
        selectClick(sel, units.team, pickNearest(ray, view.pos, view.radii, view.heights, n), input.actShift, TEAM_OWN);
      } else if (input.act === ACT_BOX) {
        const k = selectInRect(terms, input.actC0, input.actR0, input.actC1, input.actR1, view.posBody, n, idsScratch);
        selectBox(sel, units.team, idsScratch, k, input.actShift, TEAM_OWN);
        lastBox.k = k; lastBox.c0 = input.actC0; lastBox.r0 = input.actR0; lastBox.c1 = input.actC1; lastBox.r1 = input.actR1;
      }
      else if (input.act === ACT_MOVE) issueMove(input.actCol, input.actRow, n);
      input.act = ACT_NONE;
    }

    // overlay ops: rings + bars for the selection, hover ring, box rect
    ov.clear();
    if (sel.count) {
      const pos = view.pos, f = sel.flags;
      for (let i = 0; i < n; i++) {
        if (!f[i]) continue;
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        ov.ring(x, y, z, 0.75, S_SELECT);
        ov.bar(x, y, z + UNIT_HEIGHT + 0.3, 1, 5, S_FILL, S_EMPTY);
      }
    }
    if (hoverId >= 0) {
      const pos = view.pos;
      ov.ring(pos[hoverId * 3], pos[hoverId * 3 + 1], pos[hoverId * 3 + 2], 0.9, units.team[hoverId] === TEAM_ENEMY ? S_HOVER_ENEMY : S_HOVER);
    }
    if (marker.t >= 0) { // move marker: a shrinking ground ring for MARKER_SEC
      const f = marker.t / MARKER_SEC;
      if (f >= 1) marker.t = -1;
      else { ov.ring(marker.x, marker.y, groundAt(marker.x, marker.y), 1.4 - 0.9 * f, S_MARKER); marker.t += dt; }
    }
    if (input.boxActive) ov.rect(input.boxC0, input.boxR0, input.boxC1, input.boxR1, S_BOX);

    // frame
    fb.timeSec = simTime;
    lightSet.update(simTime, world);
    ov.flush(cam);
    fb.gpu = rt.gpuActive;
    wgPipeline.frame(fb, lightSet, cam, world);
    rt.present();
    if (snapReq) { const cb = snapReq; snapReq = null; wgPipeline.readbackCells().then((c) => { if (!c) console.warn('[rts] readbackCells returned null (frame not shaded yet)'); cb(c); }); } // dev: cell readback right after present (async on WebGPU)

    // stats
    simRing.push(simAcc); simAcc = 0;
    jsRing.push(prevJsMs); prevJsMs = engine.loop.stats.jsMs;
    const showHud = hud.f3Visible;
    if (!BENCH) wgPipeline.setPassTiming(showHud);
    if (showHud && now - lastHudMs > 250) { lastHudMs = now; hudText(n); }

    if (BENCH) {
      benchFrame++;
      if (benchFrame > BENCH_WARMUP && benchFrame <= BENCH_WARMUP + BENCH_MEASURE) {
        benchGpuRing.push(wgPipeline.stats.gpuMsP50);
      } else if (benchFrame === BENCH_WARMUP + BENCH_MEASURE + 1) {
        const ps = wgPipeline.stats;
        // Primary metric: total GPU ms/frame (gpuMsP50/P95), ring-averaged over the measured window - this is
        // what's populated every frame. `passMs` is a best-effort final-frame snapshot of the per-pass timers
        // (WG_PASS_NAMES order) for extra detail only - some entries read null in this scene (that pass's GPU timer
        // query did not resolve this particular frame), so RE-15d should treat it as informational, not load the
        // RE-15d raster-delta AC onto a specific pass index without checking it is non-null first.
        const result = {
          frames: BENCH_MEASURE, grid: `${rt.cols}x${rt.rows}`, units: n,
          gpuMsP50: benchGpuRing.pct(0.5), gpuMsP95: benchGpuRing.pct(0.95),
          passNames: WG_PASS_NAMES, passMs: Array.from(ps.wgPassMsP50),
          instances: ps.instances, instancesCulled: ps.instancesCulled, instancesLod1: ps.instancesLod1,
        };
        window.__rtsBench = result;
        console.log(`RTS BENCH (${result.frames} frames, ${result.grid}, units ${result.units})\n` +
          `gpu total p50 ${result.gpuMsP50.toFixed(3)} ms  p95 ${result.gpuMsP95.toFixed(3)} ms\n` +
          `per-pass (final frame, null = no query this frame): ${WG_PASS_NAMES.map((nm, i) => `${nm} ${result.passMs[i] == null ? 'n/a' : result.passMs[i].toFixed(3)}`).join('  ')}\n` +
          `instances ${result.instances}  culled ${result.instancesCulled}  lod1 ${result.instancesLod1}`);
        engine.loop.stop();
      }
    }
  },
});

// dev/test hook (headless checks drive the page through real mouse events; this only reads state)
window.__rts = {
  engine, rt, rts, cam, terms, units, sim, view, sel, input, wgPipeline, gpuPipeline: wgPipeline /* capture-rts alias */, hud, nav, world, ov, lastBox,
  /** dev: resolves to a PNG dataURL (per cell 4x4 px: left half bg, right half fg colour) of the next presented frame */
  snap: () => new Promise((res) => { snapReq = (cells) => { if (!cells) { res(null); return; } const { fg, bg } = cells;
    const c = document.createElement('canvas'); c.width = rt.cols * 4; c.height = rt.rows * 4;
    const g = c.getContext('2d'); const im = g.createImageData(c.width, c.height);
    for (let r = 0; r < rt.rows; r++) for (let q = 0; q < rt.cols; q++) { const i = (r * rt.cols + q) * 4; // WebGPU readback is memory-row order (no GL flip)
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const o = ((r * 4 + y) * c.width + q * 4 + x) * 4, src = x < 2 ? bg : fg;
        im.data[o] = src[i]; im.data[o + 1] = src[i + 1]; im.data[o + 2] = src[i + 2]; im.data[o + 3] = 255; } }
    g.putImageData(im, 0, 0); res(c.toDataURL('image/png')); }; }),
  projectBody: (i, out) => worldToCell(terms, view.posBody[i * 3], view.posBody[i * 3 + 1], view.posBody[i * 3 + 2], out),
  /** dev: selects the k own units nearest the camera focus (headless perf pass needs a 60-unit group) */
  selectNear: (k) => {
    const ids = []; for (let i = 0; i < units.count; i++) if (units.team[i] === TEAM_OWN) ids.push(i);
    const d = (i) => Math.hypot(units.x[i] - rts.focusX, units.y[i] - rts.focusY);
    ids.sort((a, b) => d(a) - d(b) || a - b);
    for (let i = 0; i < units.count; i++) sel.flags[i] = 0; sel.count = 0;
    for (const i of ids.slice(0, k)) { sel.flags[i] = 1; sel.count++; }
    return sel.count;
  },
  /** dev: state of the selected group (headless move check): min pair distance, units in blocked nav cells, centroid, spread */
  moveProbe: () => {
    let k = 0, cx = 0, cy = 0, inBlocked = 0, minD = 1e9, maxR = 0, moving = 0;
    const ids = []; for (let i = 0; i < units.count; i++) if (sel.flags[i]) ids.push(i);
    for (const i of ids) {
      cx += units.x[i]; cy += units.y[i]; k++;
      const ccx = nav.cellX(units.x[i]), ccy = nav.cellY(units.y[i]);
      if (!nav.inBounds(ccx, ccy) || nav.cost[nav.index(ccx, ccy)] === 0) inBlocked++;
      if (units.state[i] === 1) moving++;
    }
    if (k) { cx /= k; cy /= k; }
    for (let a = 0; a < ids.length; a++) {
      maxR = Math.max(maxR, Math.hypot(units.x[ids[a]] - cx, units.y[ids[a]] - cy));
      for (let b = 0; b < a; b++) minD = Math.min(minD, Math.hypot(units.x[ids[a]] - units.x[ids[b]], units.y[ids[a]] - units.y[ids[b]]));
    }
    const tgt = k ? { x: units.tx[ids[0]], y: units.ty[ids[0]] } : null;
    return { n: k, moving, cx, cy, inBlocked, minD: k > 1 ? minD : null, maxR, target: tgt, simTick: units.tick };
  },
  stats: () => ({ moving: sim.moving, onScreen: countOnScreen(units.count), selected: sel.count, hoverId, simP95: simRing.pct(0.95), jsP95: jsRing.pct(0.95) }),
};
console.log(`[rts] ${placed} units, grid ${rt.cols}x${rt.rows}, GPU ${wgPipeline.rendererString}`);
