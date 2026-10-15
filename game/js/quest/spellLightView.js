// game/js/quest/spellLightView.js (SPELL-05b). Presentation of the Light branch: Spark (bolt) and Light Orb. Mirrors fireballView:
//  - lights are bound ONCE per world load (`bind`), never removed (2 bolt + 1 hit flash + 1 orb = 4 lights, fewer if the cap is tight);
//  - particles are driven SIM side from `stepFx` (the particle sim is hashed): one comet trail per Spark slot, a hit flash on
//    `spark:end`, and for the Orb a persistent `o` core emitter + a slow shimmer emitter, faded in/out by a step counter;
//  - `present(a)` only moves/dims the lights before `lightSet.update` (0 allocation per step/frame).
// Colours: palette keys from spellDefs (BRANCH_COLOR.light = aether); the Orb core uses flameCore / lanternWarm (pale warm white,
// closest existing keys to "warm white"; no new palette keys). No sprite art: the glyphs are particle glyphs.
// main.js passes `particles: null` and no light set in capture/bench so nothing is drawn there.
import { SIM_STEP, MAX_LIGHTS } from '../../../engine/index.js';
import { SPELL_DEFS } from './spellDefs.js';

const N_BOLT = 2, FADE_IN = 18, FADE_OUT = 30, FLASH_STEPS = 9;
const _prm = { intensity: 0, radius: 0 };

function defs(palette) {
  const rgb = palette.rgb, c = (k) => rgb[k] || rgb.white || [255, 255, 255], D = [0, 0, 0];
  return {
    // small fast bolt tail: bright `* + - .` cooling aetherCore -> aether, short life so it reads as a streak
    sparkTrail: { rate: 0, burst: 1, life: [0.12, 0.22], speed: [0.2, 0.8], dir: [0, 0, 1], spreadDeg: 30, box: [0.04, 0.04, 0.04],
      accelZ: 0, drag: 3, wind: 0, maxLive: 48, sizeM: 0.07, emissive: true, emissiveFog: 0.1,
      glyphs: '*+-.', colors: [c('aetherCore'), c('aetherLight'), c('aether'), c('aetherMid')] },
    sparkHit: { rate: 0, burst: 10, life: [0.15, 0.35], speed: [2, 5], dir: [0, 0, 1], spreadDeg: 80, box: [0.05, 0.05, 0.05],
      accelZ: -3, drag: 1.8, wind: 0, maxLive: 32, sizeM: 0.07, emissive: true, emissiveFog: 0.1,
      glyphs: '*+".', colors: [c('aetherCore'), c('aetherLight'), c('aether'), c('aetherMid')] },
    // the floating `o`: a few overlapping short-lived glyphs standing still at the orb position
    orbCore: { rate: 14, burst: 0, life: [0.25, 0.4], speed: [0, 0.05], dir: [0, 0, 1], spreadDeg: 85, box: [0.02, 0.02, 0.02],
      accelZ: 0, drag: 2, wind: 0, maxLive: 8, sizeM: 0.16, emissive: true, emissiveFog: 0,
      glyphs: 'ooOo', colors: [c('flameCore'), c('white'), c('flameCore'), c('lanternWarm')] },
    // slow faint shimmer around it
    orbShimmer: { rate: 5, burst: 0, life: [0.8, 1.4], speed: [0.05, 0.25], dir: [0, 0, 1], spreadDeg: 85, box: [0.35, 0.35, 0.35],
      accelZ: 0.05, drag: 0.8, wind: 0.02, maxLive: 16, sizeM: 0.06, emissive: true, emissiveFog: 0,
      glyphs: '.+.', colors: [D, c('lanternWarm'), c('flameCore'), c('lanternWarm'), D] },
  };
}

/** @param {{particles:any, palette:any, events:any}} o  particles may be null (lights only) */
export function createSpellLightView(o) {
  const { particles, palette, events } = o;
  const hueSpark = palette.hue[SPELL_DEFS.spark.color] || [0.2, 0.9, 0.8];
  const hueFlash = palette.hue.aetherLight || hueSpark, hueOrb = palette.hue.flameCore || [1, 0.95, 0.65];
  let dId = null;
  if (particles) {
    const d = defs(palette);
    dId = {};
    for (const k of Object.keys(d)) {
      let id = particles.defIdOf(k);
      if (id < 0) { try { id = particles.defineEmitter(k, d[k]); } catch (e) { id = -1; } }
      dId[k] = id;
    }
  }
  const trail = new Int32Array(N_BOLT).fill(-1), trailSerial = new Int32Array(N_BOLT);
  const boltL = new Int32Array(N_BOLT).fill(-1);
  let flashL = -1, orbL = -1, coreH = -1, shimH = -1;
  const flash = { x: 0, y: 0, z: 0, tick: -1e9, on: 0, pend: 0 };
  let level = 0, orbWant = 0, orbR = 8, sparkSim = null, orbSim = null, lights = null, off = null, tickF = 0;
  const stats = { boundLights: 0, casts: 0, ends: 0, orbCasts: 0, orbEnds: 0 };

  const mk = (hue, intensity, radius, key, flicker) => lights.add({ x: 0, y: 0, z: 0, hue, intensity, radius, flicker: flicker || null, on: false, key });
  function releaseAll() {
    if (!particles) return;
    for (let i = 0; i < N_BOLT; i++) if (trail[i] >= 0) particles.release(trail[i]);
    if (coreH >= 0) particles.release(coreH);
    if (shimH >= 0) particles.release(shimH);
  }
  const view = {
    stats, flash, get boltLights() { return boltL; }, get flashLight() { return flashL; }, get orbLight() { return orbL; },
    get orbLevel() { return level; }, get trailHandles() { return trail; }, get coreHandle() { return coreH; },

    /** On every 'world:loaded' after the sims and the light set exist (either sim may be null). */
    bind(spark, orb, lightSet) {
      if (off) { for (const f of off) f(); off = null; }
      releaseAll();
      trail.fill(-1); trailSerial.fill(0); boltL.fill(-1); flashL = orbL = coreH = shimH = -1;
      level = 0; orbWant = 0; flash.on = 0; flash.pend = 0; flash.tick = -1e9; stats.boundLights = 0;
      sparkSim = spark; orbSim = orb; lights = lightSet;
      off = [];
      if (sparkSim) {
        off.push(events.on('spark:end', (p) => { stats.ends++; flash.x = p.x; flash.y = p.y; flash.z = p.z; flash.pend = 1; })); // payload is reused: copy now
        off.push(events.on('spark:cast', () => { stats.casts++; }));
      }
      if (orbSim) {
        off.push(events.on('lightOrb:cast', (p) => { stats.orbCasts++; orbWant = 1; orbR = p.radius; }));
        off.push(events.on('lightOrb:end', () => { stats.orbEnds++; orbWant = 0; }));
      }
      if (!lights) return;
      let room = MAX_LIGHTS - lights.count;
      if (sparkSim) {
        for (let i = 0; i < N_BOLT && room > 0; i++, room--) { boltL[i] = mk(hueSpark, 0.8, 4, `spark.bolt.${i}`); stats.boundLights++; }
        if (room > 0) { flashL = mk(hueFlash, 1.4, 5, 'spark.flash'); room--; stats.boundLights++; }
      }
      if (orbSim && room > 0) { orbL = mk(hueOrb, 0.9, 12, 'lightOrb.light', { hzMin: 3, hzMax: 6, amount: 0.05, jitter: 0.01 }); room--; stats.boundLights++; }
    },

    /** SIM side, right after the sims' step: trail emitters, hit flash particles, orb glyph emitters + fade level. */
    stepFx() {
      if (sparkSim) {
        const sl = sparkSim.slots;
        for (let s = 0; s < N_BOLT && s < sl.n; s++) {
          if (sl.alive[s] === 1) {
            if (particles && dId.sparkTrail >= 0) {
              if (trailSerial[s] !== sl.serial[s]) {
                if (trail[s] >= 0) particles.release(trail[s]);
                trail[s] = particles.createEmitter(dId.sparkTrail, sl.x[s], sl.y[s], sl.z[s]); trailSerial[s] = sl.serial[s];
              }
              const h = trail[s];
              if (h >= 0) { particles.setEmitterPos(h, sl.x[s], sl.y[s], sl.z[s]); particles.setEmitterDir(h, -sl.dx[s], -sl.dy[s], -sl.dz[s]); particles.burst(h, 1); }
            }
          } else if (trailSerial[s] !== 0) {
            if (trail[s] >= 0 && particles) particles.release(trail[s]);
            trail[s] = -1; trailSerial[s] = 0;
          }
        }
        if (flash.pend) {
          flash.pend = 0; flash.tick = sparkSim.tick; flash.on = 1;
          if (particles && dId.sparkHit >= 0) particles.burstAt(dId.sparkHit, flash.x, flash.y, flash.z, 10, 0, 0, 1);
        }
      }
      if (orbSim) {
        const t = orbWant;
        level += level < t ? Math.min(1 / FADE_IN, t - level) : -Math.min(1 / FADE_OUT, level - t);
        const o = orbSim.orb;
        if (particles && dId.orbCore >= 0 && dId.orbShimmer >= 0) {
          if (level > 0 && coreH < 0) { coreH = particles.createEmitter(dId.orbCore, o.x, o.y, o.z); shimH = particles.createEmitter(dId.orbShimmer, o.x, o.y, o.z); }
          if (coreH >= 0) {
            if (level <= 0) { particles.release(coreH); particles.release(shimH); coreH = shimH = -1; }
            else {
              particles.setEmitterPos(coreH, o.x, o.y, o.z); particles.setEmitterPos(shimH, o.x, o.y, o.z);
              const on = orbWant === 1 && level > 0.3; // fading out: spawns stop, live glyphs die in <1.4 s
              particles.setOn(coreH, on); particles.setOn(shimH, on);
            }
          }
        }
      }
    },

    /** Per rendered frame BEFORE `lightSet.update`. */
    present(a) {
      if (!lights) return;
      if (sparkSim) {
        tickF = sparkSim.tick - 1 + a;
        const sl = sparkSim.slots, back = (1 - a) * SIM_STEP;
        for (let s = 0; s < N_BOLT; s++) {
          const h = boltL[s];
          if (h < 0) continue;
          if (sl.alive[s] === 0) { lights.setOn(h, false); continue; }
          const d = sl.speed[s] * back;
          lights.move(h, sl.x[s] - sl.dx[s] * d, sl.y[s] - sl.dy[s] * d, sl.z[s] - sl.dz[s] * d);
          lights.setOn(h, true);
        }
        if (flashL >= 0 && flash.on) {
          const age = tickF - flash.tick;
          if (age >= FLASH_STEPS) { lights.setOn(flashL, false); flash.on = 0; }
          else {
            const k = 1 - (age < 0 ? 0 : age) / FLASH_STEPS;
            _prm.intensity = 1.4 * k * k; _prm.radius = 5;
            lights.move(flashL, flash.x, flash.y, flash.z); lights.setParams(flashL, _prm); lights.setOn(flashL, true);
          }
        }
      }
      if (orbSim && orbL >= 0) {
        if (level <= 0) lights.setOn(orbL, false);
        else {
          const o = orbSim.orb;
          lights.move(orbL, o.x, o.y, o.z);
          _prm.intensity = 0.9 * level; _prm.radius = orbR;
          lights.setParams(orbL, _prm);
          lights.setOn(orbL, true);
        }
      }
    },
    dispose() { if (off) { for (const f of off) f(); off = null; } releaseAll(); },
  };
  return view;
}
