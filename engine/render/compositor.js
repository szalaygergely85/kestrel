// engine/render/compositor.js (US-025, docs/architecture.md 7.3/8). The
// world-level frame pipeline: sorts placed structures near-to-far, casts
// each into the shared FrameBuffers, then the terrain, then the deferred
// shading passes (US-028) and finally the sky - replacing the manual
// beginFrame/castSectors/.../fillSky sequence main.js used to write out by
// hand for a single bare level (US-024).
import { beginFrame, castSectors, fillSky, ambientL, primeAmbientLight } from './sectorCaster.js';
import { castTerrain } from './terrainCaster.js';
import { computeDerivatives, shadeSurfaces } from './detailShade.js';
import { edgePass } from './edgePass.js';

const MAX_STRUCTS = 8; // structSeq is a 3-bit field (arch 7.2) - never exceeded, never wrapped.
// Preallocated (architecture.md section 9: no per-frame allocation in renderWorld).
const order = new Int8Array(MAX_STRUCTS);
const distScratch = new Float32Array(MAX_STRUCTS);

function bboxDist(cam, bbox) {
  const cx = Math.min(Math.max(cam.x, bbox.x0), bbox.x1);
  const cy = Math.min(Math.max(cam.y, bbox.y0), bbox.y1);
  const dx = cam.x - cx, dy = cam.y - cy;
  return Math.hypot(dx, dy); // 0 when the camera is inside the footprint
}

/**
 * @param {Object} fb - FrameBuffers ({ rt, depth, spans, palette, gbuf?, matTable?, detailPass?, lights, timeSec, loop? })
 * @param {import('../world/World.js').World} world
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
 */
export function renderWorld(fb, world, cam) {
  // US-030a AC "the CPU caster no longer runs on the gl2 path": when a
  // ready GPU pipeline owns this frame's cast (`fb.gpuDda`, set by
  // main.js), skip the entire CPU cast/derivative/shade/edge/sky sequence
  // below - `GpuCellPipeline.js`'s present hook does all of it itself
  // (`_passCast`/`_passDeriv`/`_passShade`/`_passEdgeOrDebug`), fed by
  // `world`/`cam` via `pipeline.frame(fb, light, cam, world)` (main.js).
  // The legacy CPU sequence stays exactly as-is for the JS oracle/fallback
  // (`fb.gpuDda` unset - `?gpu=0`, `?force2d=1`, no WebGL2, or the
  // `?gpucompare=shade` test's own separate `fbCompare`).
  //
  // Bug fix (US-030a, "colour blocks, no glyphs" on the GPU path): the
  // per-frame ambient light `ambientL` (sectorCaster.js) used to be primed
  // only inside `castScene`, i.e. only by the CPU caster this early-out
  // skips - so on the GPU path it stayed [0,0,0], `uLight` was zero and the
  // shade pass resolved every cell to glyph 0. Prime it here, once per
  // frame, from the live palette - same call, same source of truth.
  if (fb.gpuDda) {
    if (fb.palette) primeAmbientLight(fb.palette);
    return;
  }

  beginFrame(fb);

  const structs = world.structures;
  const fogFar = (fb.palette && fb.palette.fog && fb.palette.fog.far) || 2000;
  let count = 0;

  for (let i = 0; i < structs.length; i++) {
    const d = bboxDist(cam, structs[i].bbox);
    if (d > fogFar) continue; // too far to matter this frame
    if (count < MAX_STRUCTS) {
      order[count] = i;
      distScratch[count] = d;
      count++;
    } else {
      let worst = 0, worstD = distScratch[0];
      for (let k = 1; k < MAX_STRUCTS; k++) {
        if (distScratch[k] > worstD) { worstD = distScratch[k]; worst = k; }
      }
      if (d < worstD) { order[worst] = i; distScratch[worst] = d; }
      if (fb.loop && fb.loop.stats) fb.loop.stats.structuresCulled = (fb.loop.stats.structuresCulled || 0) + 1;
    }
  }

  // Insertion sort near -> far (count <= 8, so this is cheap and allocation-free).
  for (let i = 1; i < count; i++) {
    const oi = order[i], di = distScratch[i];
    let j = i - 1;
    while (j >= 0 && distScratch[j] > di) {
      order[j + 1] = order[j];
      distScratch[j + 1] = distScratch[j];
      j--;
    }
    order[j + 1] = oi;
    distScratch[j + 1] = di;
  }

  for (let k = 0; k < count; k++) {
    const s = structs[order[k]];
    castSectors(fb, s.level, cam, s.origin);
  }

  castTerrain(fb, world.terrain, cam); // US-016: still a no-op stub until then

  if (fb.gbuf) {
    computeDerivatives(fb.gbuf, fb.depth.depth);
    shadeSurfaces(fb, fb.gbuf, fb.matTable, fb.detailPass, ambientL);
    if (fb.detailPass) edgePass(fb.gbuf, fb.depth.depth, fb.rt, fb.detailPass.edges);
  }

  fillSky(fb, cam);
}
