// game/js/dev/spritesPage.js (US-030c): compact bootstrap for game/sprites.html
// - the US-030c dev/verification page. Mirrors main.js's bootstrap (grid,
// pipeline gate, world loop) in ~100 lines so the sprite pass could be built
// and verified while US-030a rewrites main.js in parallel; once main.js is
// wired (4 lines, see spriteDev.js header) this page becomes redundant.
// Imports only engine/index.js (check-deps rule 3), plus engine/dev.js for
// PlayerLook (US-047 - game/js/dev/** is an allowed engine/dev.js importer).
import {
  AssetRegistry, createEngine, GBuffer, bindShading, bindLevel, DebugOverlay,
  integrate, Camera, renderWorld, World, drawSprites, createRenderer, ambientL,
} from '../../../engine/index.js';
import { PlayerLook } from '../../../engine/dev.js';
import { POSES } from '../../../tools/bench-poses.js';
import { createSpriteSystem, spawnTestSprites, runSpriteCompareMode } from './spriteDev.js';

const params = new URLSearchParams(window.location.search);
const canvas = document.getElementById('screen');
const assets = AssetRegistry.fromGlobals(window.ASSETS);
const isCompare = params.get('spritecompare') === '1';
const gridParam = /^(\d+)x(\d+)$/.exec(params.get('grid') || '');
const gridCols = isCompare ? 160 : (gridParam ? Number(gridParam[1]) : 160), gridRows = isCompare ? 60 : (gridParam ? Number(gridParam[2]) : 60);
// SPRITECOMPARE-WG-01: WebGPU renderer (createRenderer) + WgCellPipeline; force2d / gpu=0 keep the CPU-only world view.
const built = await createRenderer({ canvas, cols: gridCols, rows: gridRows, backend: 'webgpu', gpu: params.get('gpu') !== '0', rays: 2, terrainEnabled: false,
  force2d: params.get('force2d') === '1', shadows: { sun: 'map' } });
const wgPipeline = built.pipeline && built.pipeline.ready && built.rt.backend === 'webgpu' ? built.pipeline : null;
const engine = createEngine({
  canvas, assets, cols: gridCols, rows: gridRows,
  renderTarget: built.rt, renderPipeline: wgPipeline,
  force2d: params.get('force2d') === '1', gpu: params.get('gpu') !== '0',
});
const { renderTarget: rt, depthBuffer, input } = engine;
const overlay = new DebugOverlay(document.body);
const matTable = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
const detailPass = params.get('detail') !== '0' ? assets.detailPass : null;
const gbuf = new GBuffer(rt.cols, rt.rows);
console.log(`[RenderTarget] back-end: ${rt.backend} ${rt.cols}x${rt.rows}`);

const sprites = createSpriteSystem({ assets, rt, wgPipeline });
window.__debug = { input, overlay, rt, engine, sprites, wgPipeline };

const fb = {
  rt, depth: depthBuffer, palette: assets.palette, lights: null, timeSec: 0,
  gbuf, matTable, detailPass, gpu: false, renderer: 'mesh',
};

if (wgPipeline) {
  wgPipeline.bind(matTable, assets.palette);
  if (window.ASSETS.waterLooks) wgPipeline.setWaterLooks(window.ASSETS.waterLooks);
  wgPipeline.bindSprites({ pool: sprites.pool, atlas: sprites.atlas, palette: assets.palette, particleLayer: engine.particleLayer, overlay: engine.overlay });
  if (wgPipeline.spritesCompiled) await wgPipeline.spritesCompiled;
}
console.log(`[WgCellPipeline] ${wgPipeline ? 'active (' + wgPipeline.rendererString + ')' : 'inactive - JS shading'}`);

if (isCompare) runCompare(); else runWorld();

function runWorld() {
  if (params.get('debug') === '1') overlay.toggle();
  const levelName = params.get('level') || 'test_room';
  const worldDef = {
    name: `adhoc_${levelName}`, terrain: null,
    structures: [{ id: levelName, level: levelName, origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }],
    entities: [{ id: 'player', type: 'player', spawn: { structure: levelName, from: 'start' } }], state: {},
  };
  const world = engine.loadWorld(worldDef);
  for (const s of world.structures) bindLevel(matTable, s.level);
  if (wgPipeline) wgPipeline.bind(matTable, assets.palette); // re-pack shade data for the materials bindLevel just added
  const playerHandle = world.get('player');
  const startT = playerHandle.data.transform;
  Object.assign(playerHandle.data.components.body || (playerHandle.data.components.body = {}), {
    radius: engine.physics.radius, height: engine.physics.height, eyeH: engine.physics.eyeHeight,
    vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: startT.z,
  });
  if (params.get('sprite') === '1') spawnTestSprites(world, startT);
  const look = new PlayerLook(canvas, input, startT.yawDeg, startT.pitchDeg);
  const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0, pitchDeg: 0 };
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 };
  let simTime = 0;

  engine.run({
    update(dt) {
      simTime += dt;
      if (input.pressed('F3')) overlay.toggle();
      look.update(dt);
      controls.forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      controls.strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
      controls.run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      controls.jump = input.isDown('Space') || input.pressed('Space');
      controls.yawDeg = look.yawDeg; controls.pitchDeg = look.pitchDeg;
      integrate(playerHandle.data, dt, controls, world, engine.physics);
      world.flushEvents();
      input.endFrame();
    },
    render() {
      const t0 = performance.now();
      const eye = Camera.fromEntity(playerHandle.data);
      cam.x = eye.x; cam.y = eye.y; cam.z = eye.z; cam.yawDeg = eye.yawDeg; cam.pitchDeg = eye.pitchDeg;
      fb.timeSec = simTime;
      fb.gpu = !!wgPipeline && wgPipeline.frameComplete && rt.gpuActive;
      renderWorld(fb, world, cam);
      sprites.render(fb, world, cam); // US-030c: after the surfaces, before present()
      if (wgPipeline && wgPipeline.ready) wgPipeline.frame(fb, ambientL, cam, world);
      rt.present();
      const t = playerHandle.data.transform;
      overlay.update(engine.loop.fps, engine.loop.frameMs,
        `grid draw: ${(performance.now() - t0).toFixed(2)} ms\ncells: ${rt.cols}x${rt.rows}  backend: ${rt.backend}  shade: ${rt.gpuActive ? 'gpu' : 'cpu'}` +
        `\n${sprites.overlayLine()}\nworld (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}) yaw ${look.yawDeg.toFixed(0)} pitch ${look.pitchDeg.toFixed(0)}${look.locked ? '' : ' [unlocked - click to look]'}`);
    },
  });
  window.__debug.world = world; window.__debug.playerHandle = playerHandle;
}

// `?spritecompare=1`: both paths render test_room as a World from the bench poses; the CPU frame (`fb.gpu = false`)
// is the oracle, then the WebGPU frame (`fb.gpu = true` + wgPipeline.frame + present, sprite pass inside) is read back
// with `await wgPipeline.readbackCells()` and compared cell by cell (sprite cells: glyph exact, fg +-4).
async function runCompare() {
  if (!wgPipeline || !wgPipeline.frameComplete) {
    overlay.visible = true; overlay.el.style.display = 'block';
    overlay.el.textContent = `[spritecompare] needs an active WgCellPipeline with the sprite pass (pipeline ${wgPipeline ? 'ok' : 'inactive'}, frameComplete ${!!(wgPipeline && wgPipeline.frameComplete)})`;
    console.error(overlay.el.textContent);
    return;
  }
  const world = World.load({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  for (const s of world.structures) bindLevel(matTable, s.level);
  wgPipeline.bind(matTable, assets.palette);
  await runSpriteCompareMode({
    frameGate: false, // WebGPU scene shading (sun shadow map, light set) is judged by ?gpucompare=1; this page gates on the sprite cells (frame numbers stay informational)
    sprites, fb, poses: POSES, overlay, rendererString: wgPipeline.rendererString,
    renderCpu(cam) { fb.gpu = false; renderWorld(fb, world, cam); },
    async renderGpu(cam) {
      fb.gpu = true;
      renderWorld(fb, world, cam); // scene frame: prime ambient light only
      wgPipeline.frame(fb, ambientL, cam, world);
      rt.present(); // cell pass + sprite pass
      return await wgPipeline.readbackCells();
    },
  });
}

window.addEventListener('resize', () => rt.resize());
drawSprites; // referenced so the JS reference is reachable from the console via __debug if needed
