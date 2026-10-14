// ENV-03c: per-world glue between the ENV-03a driver (camera biome -> weights) and the engine atmosphere (fog/haze/grade, 38.65).
// createAtmosRuntime(biomeLook, palette, world) -> { state, step(t, hour, dt), apply(fb) } or null (no BIOME_LOOK / atmosMap / terrain blend).
// step: call per frame with the player transform; the table is re-mixed + the palette fog bumped only when the driver version moved (<= 1/256).
// apply: right after sprites.render (before any UI cell): JS path grades rt.cells, GPU path hands the state to the sprite pass via fb.atmos.
import { createAtmosState, mixAtmos, applyAtmosToPalette, applyAtmosGrade } from '../../../engine/index.js';
import { buildAtmosConfig } from './atmosConfig.js';
import { createAtmosDriver } from './atmosDriver.js';

export function createAtmosRuntime(biomeLook, P, world, disabled) {
  applyAtmosToPalette(P, null); // reset: a previous world's biome fog must never leak into this one (also when off / no terrain)
  if (disabled) return null;
  const util = world && world.terrain && world.terrain.util;
  if (!biomeLook || !biomeLook.atmosMap || !util || typeof util.biomeBlend !== 'function' || !P.fog || !P.fog.far || !P.daySchedule) return null;
  let cfg;
  try { cfg = buildAtmosConfig(biomeLook); } catch (e) { console.warn('[atmos] off: ' + e.message); return null; }
  const f = P.fog.farBase || P.fog.far;
  const base = { nearRGB: P.rgb[f.color], farRGB: P.rgb[f.colorFar], start: f.start, full: f.full, curve: f.curve };
  const drv = createAtmosDriver({ nEntries: cfg.n, biomeToEntry: cfg.biomeToEntry, biomeBlend: util.biomeBlend, schedule: P.daySchedule, slotOf: cfg.slotOf, defaultTime: cfg.defaultTime });
  const state = createAtmosState();
  let seen = -1;
  drv.snap(); // first frame jumps straight to the target (camera jumps > 50 m snap inside the driver)
  return {
    state,
    step(t, hour, dt) {
      // outdoor = camera outside every sector (same rule as meshOutdoorFog, OB-089): towers/buildings/dungeons -> target 'none'
      drv.step(t.x, t.y, hour, dt, !(typeof world.sectorAt === 'function' && world.sectorAt(t.x, t.y)));
      if (drv.version === seen) return;
      seen = drv.version;
      mixAtmos(cfg, drv, base, state);
      applyAtmosToPalette(P, state);
    },
    dispose() { applyAtmosToPalette(P, null); },
    apply(fb) { if (fb.gpu) fb.atmos = state; else applyAtmosGrade(fb.rt, state); },
  };
}
