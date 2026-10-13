// S8-B1-18 (closes US-019; ARCH: US-053d `motes` preset, docs/sprints/sprint-8-queue.md:145-151).
// Ambient dust motes drifting in sunbeams around the player. Reuses the existing
// particle system end to end (engine/fx/particles.js + emitterDef.js; drawn by the
// sprites pass via engine/render/particleLayer.js) as a preset + one emitter
// placement, same shape as createWaterfallHooks in ./waterfallHooks.js. No new
// render code and no Math.random: particle motion/positions come entirely from
// the particle system's own seeded sim (createParticles({ seed })).
import { sunVisible, sunFromWorld } from '../../../engine/index.js';

export const MOTES_PRESET = 'motes';
export const MOTES_COUNT = 60; // also the emitter's maxLive, which clamps the pool usage

/** US-053d preset: slow, near-isotropic drift, long life, a single faint glyph. */
export function motesEmitterDef(rgb) {
  const col = Array.isArray(rgb) && Array.isArray(rgb[0]) ? rgb[0] : [255, 244, 214];
  return {
    rate: 6, maxLive: MOTES_COUNT, burst: 0,
    life: [14, 22], speed: [0.03, 0.12],
    dir: [0, 0, 1], spreadDeg: 85, // near-isotropic: motes drift in every direction, not a jet
    box: [3.5, 3.5, 2], // emission volume half-extents around the emitter (follows the player)
    accelZ: 0, drag: 0.15, wind: 0.08,
    sizeM: 0.015, emissive: false, emissiveFog: 0,
    glyphs: '.', colors: [col],
  };
}

// Reused across steps - 0 alloc after warm-up (see ambient.test.js).
const sunUniform = { dirX: 0, dirY: 0, dirZ: 0, ambientI: 0, sunI: 0 };
const dirScratch = new Float64Array(3);

/**
 * One ambient-motes emitter that follows the player and is switched off when
 * the player isn't sunlit, using the engine's own public helpers end to end:
 * `sunFromWorld(world, palette, out)` (engine/render/lighting.js:1280, the
 * same per-frame sun uniform source terrainCaster/buildLightSet use) for the
 * sun direction, and `sunVisible` for the per-point query - both re-exported
 * from engine/index.js. If no `palette` is supplied (e.g. a plain test world)
 * the sunlit gate is skipped and the motes simply stay on (documented
 * fallback, not a silent bug): see the S8-B1-18 lane entry in docs/lanes/pc-b1.md.
 * @param {object} world engine world (may be null in tests; passed through to sunFromWorld/sunVisible)
 * @param {object} particles engine particles system instance (createParticles())
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true] off with ?ambient=0 and on the Low preset
 * @param {Array} [opts.rgb] palette.rgb; used to colour the preset on first registration
 * @param {object} [opts.palette] assets.palette; required for the sunlit gate (sunFromWorld's timeOfDay table)
 * @param {number} [opts.recheckEvery=15] frames between sunlit re-checks (perf only; sim stays deterministic)
 */
export function createAmbientMotes(world, particles, opts = {}) {
  const enabled = opts.enabled !== false;
  if (!enabled || !particles) return { step() {}, dispose() {} };
  if (particles.defIdOf(MOTES_PRESET) < 0) particles.defineEmitter(MOTES_PRESET, motesEmitterDef(opts.rgb));
  const defId = particles.defIdOf(MOTES_PRESET);
  if (defId < 0) return { step() {}, dispose() {} };
  const recheckEvery = Math.max(1, opts.recheckEvery || 15);
  const palette = opts.palette || null;
  const handle = particles.createEmitter(defId, 0, 0, 0);
  let disposed = false, frame = 0, lastLit = true;
  if (handle >= 0) particles.setOn(handle, true);
  return {
    handle,
    step(px, py, pz) {
      if (disposed || handle < 0 || !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return; // never park the emitter at NaN
      particles.setEmitterPos(handle, px, py, pz);
      if ((frame % recheckEvery) === 0) {
        let lit = true;
        if (world && palette) {
          sunFromWorld(world, palette, sunUniform);
          dirScratch[0] = sunUniform.dirX; dirScratch[1] = sunUniform.dirY; dirScratch[2] = sunUniform.dirZ;
          lit = sunVisible(world, px, py, pz + 1.2, dirScratch);
        }
        if (lit !== lastLit) { particles.setOn(handle, lit); lastLit = lit; }
      }
      frame++;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (handle >= 0) particles.release(handle);
    },
  };
}
