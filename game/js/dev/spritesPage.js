// game/js/dev/spritesPage.js (US-030c): compact bootstrap for game/sprites.html
// - the US-030c dev/verification page. Mirrors main.js's bootstrap (grid,
// pipeline gate, world loop) in ~100 lines so the sprite pass could be built
// and verified while US-030a rewrites main.js in parallel; once main.js is
// wired (4 lines, see spriteDev.js header) this page becomes redundant.
// Imports only engine/index.js (check-deps rule 3), plus engine/dev.js for
// PlayerLook (US-047 - game/js/dev/** is an allowed engine/dev.js importer).
import {
  AssetRegistry, createEngine, GBuffer, bindShading, bindLevel, DebugOverlay,
  integrate, Camera, renderWorld, GpuCellPipeline, ambientL, World, drawSprites,
} from '../../../engine/index.js';
import { PlayerLook } from '../../../engine/dev.js';
import { POSES } from '../../../tools/bench-poses.js';
import { createSpriteSystem, spawnTestSprites, runSpriteCompareMode } from './spriteDev.js';

const params = new URLSearchParams(window.location.search);
const canvas = document.getElementById('screen');
const assets = AssetRegistry.fromGlobals(window.ASSETS);
const isCompare = params.get('spritecompare') === '1';
const gridParam = /^(\d+)x(\d+)$/.exec(params.get('grid') || '');
const engine = createEngine({
  canvas, assets,
  cols: isCompare ? 160 : (gridParam ? Number(gridParam[1]) : 160), rows: isCompare ? 60 : (gridParam ? Number(gridParam[2]) : 60),
  force2d: params.get('force2d') === '1', gpu: params.get('gpu') !== '0',
});
const { renderTarget: rt, depthBuffer, openSpans, input } = engine;
const overlay = new DebugOverlay(document.body);
const matTable = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
const detailPass = params.get('detail') !== '0' ? assets.detailPass : null;
const gbuf = new GBuffer(rt.cols, rt.rows);
console.log(`[RenderTarget] back-end: ${rt.backend} ${rt.cols}x${rt.rows}`);

let gpuPipeline = null;
if (rt.backend === 'gl2' && params.get('gpu') !== '0' && detailPass && matTable.allV2) {
  const candidate = new GpuCellPipeline(rt);
  if (candidate.ready) { candidate.bind(matTable, assets.palette); gpuPipeline = candidate; }
}
console.log(`[GpuCellPipeline] ${gpuPipeline ? 'active (' + gpuPipeline.rendererString + ')' : 'inactive - JS shading'}`);

const sprites = createSpriteSystem({ assets, rt, gpuPipeline });
window.__debug = { input, overlay, rt, engine, gpuPipeline, sprites };

const fb = {
  rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, lights: null, timeSec: 0,
  gbuf, matTable, detailPass, gpuDda: false,
};

// `?source=upload`: US-029 path (CPU cast + G-buffer upload, GPU shade/edge/sprites) - see runWorld/runCompare.
const upload = params.get('source') === 'upload';
if (upload && gpuPipeline) gpuPipeline.setSource('upload');

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
      // `?source=upload`: US-029 path (CPU cast + G-buffer upload, GPU shade/edge/sprites).
      fb.gpuDda = !!gpuPipeline && !upload;
      renderWorld(fb, world, cam);
      sprites.render(fb, world, cam); // US-030c: after the surfaces, before present()
      if (gpuPipeline) { if (upload) gpuPipeline.frame(fb, ambientL); else gpuPipeline.frame(fb, ambientL, cam, world); }
      rt.present();
      const t = playerHandle.data.transform;
      overlay.update(engine.loop.fps, engine.loop.frameMs,
        `grid draw: ${(performance.now() - t0).toFixed(2)} ms\ncells: ${rt.cols}x${rt.rows}  backend: ${rt.backend}  shade: ${rt.gpuActive ? 'gpu' : 'cpu'}` +
        (gpuPipeline ? `  upload ${gpuPipeline.stats.uploadMs.toFixed(2)}ms  gpu ${Number.isNaN(gpuPipeline.stats.gpuMsP50) ? 'n/a' : gpuPipeline.stats.gpuMsP50.toFixed(2) + 'ms'}` : '') +
        `\n${sprites.overlayLine()}\nworld (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}) yaw ${look.yawDeg.toFixed(0)} pitch ${look.pitchDeg.toFixed(0)}${look.locked ? '' : ' [unlocked - click to look]'}`);
    },
  });
  window.__debug.world = world; window.__debug.playerHandle = playerHandle;
}

// `?spritecompare=1`: both paths render test_room as a World from the bench
// poses; the CPU frame (`fb.gpuDda = false`) is the oracle, then the GPU
// frame (`gpuDda = true` + pipeline.frame + present, sprite pass inside).
function runCompare() {
  if (!gpuPipeline || !sprites.pass) {
    overlay.visible = true; overlay.el.style.display = 'block';
    overlay.el.textContent = `[spritecompare] needs an active GpuCellPipeline + GpuSpritePass (pipeline ${gpuPipeline ? 'ok' : 'inactive'}, sprite pass ${sprites.pass ? 'ok' : 'inactive'})`;
    console.error(overlay.el.textContent);
    return;
  }
  const world = World.load({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  for (const s of world.structures) bindLevel(matTable, s.level);
  // `?source=upload`: the US-029 path (CPU cast -> G-buffer upload -> GPU
  // shade/edge -> sprite pass) - the sprite pass only shares the DEPTH texture
  // with the caster, so its parity can be measured independently of the
  // US-030a DDA state. Default: the DDA path (`gpuDda`, pipeline.frame with cam/world).
  runSpriteCompareMode({
    sprites, fb, poses: POSES, overlay, rendererString: `${gpuPipeline.rendererString} (source: ${upload ? 'upload' : 'dda'})`,
    renderCpu(cam) { fb.gpuDda = false; renderWorld(fb, world, cam); },
    renderGpu(cam) {
      if (upload) {
        gpuPipeline.frame(fb, ambientL); // fb.gbuf/depth still hold the CPU cast of this very pose
      } else {
        fb.gpuDda = true;
        renderWorld(fb, world, cam); // no-op on the DDA path
        gpuPipeline.frame(fb, ambientL, cam, world);
      }
      rt.present(); // cell pass + sprite pass
      return gpuPipeline.readback();
    },
  });
}

window.addEventListener('resize', () => rt.resize());
drawSprites; // referenced so the JS reference is reachable from the console via __debug if needed
