// game/js/audio/forestAmbience.js (OB-184 part 3: forest sounds, birds)
//
// Biome-aware ambience layer on top of ambient.js. In forest biomes (ids 1-3,
// the same biome ids the scatter uses) a quiet bed crossfades in over ~2-3 s:
// wind in leaves (filtered noise + slow LFO gusts), occasional bird chirps and
// a rare woodpecker knock by day; owl hoots + crickets at night (game clock).
// Meadows (biome 0) keep the existing bed: this layer just fades to silence.
//
// Synth only (D-004). Everything routes through synth.js's master gain, so
// mute / volume settings apply for free. Persistent graph (wind noise, gust
// LFO, cricket osc + AM LFO, three bed gains) is built ONCE; per frame there
// is only a biome lookup + setTargetAtTime. One-shot call nodes are created
// only at the (3-12 s) call events, never per frame.
import { getCtx, getMaster, isMuted } from './synth.js';

export const FOREST_BIOMES = [1, 2, 3];
export const FOREST_WIND_PEAK = 0.035;   // ambient.js WIND_BED_PEAK is 0.09; sfx are 0.3+
export const FOREST_BIRD_PEAK = 0.045;
export const FOREST_CRICKET_PEAK = 0.010;
export const FOREST_OWL_PEAK = 0.05;
export const CALL_MIN_S = 3, CALL_MAX_S = 12;
export const NIGHT_START_H = 20, NIGHT_END_H = 5.5;
const FADE_TC = 0.8;           // setTargetAtTime tc: ~90% in 1.8 s, ~95% in 2.4 s
const KNOCK_CHANCE = 0.12;     // of day call events

const src = { biomeAt: null, hour: null };
/** Wire the inputs. biomeAt(x,y)->id, hour()->0..24 (game clock). Called once from main (see lane entry). */
export function setForestAmbienceSources({ biomeAt = null, hour = null } = {}) { src.biomeAt = biomeAt; src.hour = hour; }

export function isForestBiome(id) { return id === 1 || id === 2 || id === 3; }
export function isNightHour(h) { return h >= NIGHT_START_H || h < NIGHT_END_H; }
/** Seconds to the next call, uniform in [CALL_MIN_S, CALL_MAX_S]. */
export function nextCallDelay(rand = Math.random) { return CALL_MIN_S + rand() * (CALL_MAX_S - CALL_MIN_S); }

let g = null;           // persistent graph
let nextCallAt = 0;     // ctx time
let lastForest = -1, lastNight = -1;

function noiseSource(ctx, seconds) {
  const n = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = true;
  return s;
}

function build(ctx, master) {
  const wind = noiseSource(ctx, 4);
  const windF = ctx.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 650; windF.Q.value = 0.5;
  const windG = ctx.createGain(); windG.gain.value = 0;      // forest-level target
  const gust = ctx.createGain(); gust.gain.value = 1;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.09 + Math.random() * 0.06;
  const lfoD = ctx.createGain(); lfoD.gain.value = 0.4;
  lfo.connect(lfoD); lfoD.connect(gust.gain);
  wind.connect(windF); windF.connect(windG); windG.connect(gust); gust.connect(master);
  const dayBus = ctx.createGain(); dayBus.gain.value = 0; dayBus.connect(master);     // birds + knock
  const nightBus = ctx.createGain(); nightBus.gain.value = 0; nightBus.connect(master); // owls + crickets
  const cr = ctx.createOscillator(); cr.type = 'sine'; cr.frequency.value = 4300;
  const crAm = ctx.createGain(); crAm.gain.value = 0.5;
  const crLfo = ctx.createOscillator(); crLfo.type = 'square'; crLfo.frequency.value = 6.5;
  const crD = ctx.createGain(); crD.gain.value = 0.5;
  crLfo.connect(crD); crD.connect(crAm.gain);
  const crLvl = ctx.createGain(); crLvl.gain.value = FOREST_CRICKET_PEAK;
  cr.connect(crAm); crAm.connect(crLvl); crLvl.connect(nightBus);
  wind.start(); lfo.start(); cr.start(); crLfo.start();
  const nodes = [wind, windF, windG, gust, lfo, lfoD, dayBus, nightBus, cr, crAm, crLvl, crLfo, crD];
  return { ctx, master, windG, dayBus, nightBus, nodes };
}

// ---- one-shot calls (event-rate, auto-disconnect) --------------------------
function pannerFor(ctx, bus) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = Math.random() * 2 - 1; p.connect(bus); return p; }
  return bus;
}
function chirp(ctx, out, t0, f0, f1, dur, peak) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0, t0);
  gn.gain.linearRampToValueAtTime(peak, t0 + 0.015);
  gn.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(gn); gn.connect(out);
  o.start(t0); o.stop(t0 + dur + 0.02);
  o.onended = () => { o.disconnect(); gn.disconnect(); };
}
/** 3 bird patterns: trill, two-note whistle, descending sweep. */
function birdCall(ctx, bus, t, rand = Math.random) {
  const out = pannerFor(ctx, bus);
  const base = 2200 + rand() * 1800, pk = FOREST_BIRD_PEAK * (0.6 + rand() * 0.4);
  const pat = (rand() * 3) | 0;
  if (pat === 0) for (let i = 0; i < 5; i++) chirp(ctx, out, t + i * 0.07, base, base * 1.25, 0.05, pk);
  else if (pat === 1) { chirp(ctx, out, t, base, base * 1.1, 0.18, pk); chirp(ctx, out, t + 0.26, base * 1.3, base * 1.2, 0.22, pk); }
  else chirp(ctx, out, t, base * 1.5, base * 0.8, 0.3, pk);
}
function woodpecker(ctx, bus, t) {
  const out = pannerFor(ctx, bus);
  const n = 4 + ((Math.random() * 4) | 0);
  for (let i = 0; i < n; i++) chirp(ctx, out, t + i * 0.075, 900, 500, 0.03, FOREST_BIRD_PEAK * 0.9);
}
function owlHoot(ctx, bus, t) {
  const out = pannerFor(ctx, bus);
  chirp(ctx, out, t, 400, 360, 0.35, FOREST_OWL_PEAK);
  chirp(ctx, out, t + 0.55, 380, 330, 0.5, FOREST_OWL_PEAK);
}

function teardown() {
  if (!g) return;
  for (const n of g.nodes) {
    try { n.stop && n.stop(); } catch (e) { /* not a source */ }
    try { n.disconnect(); } catch (e) { /* fine */ }
  }
  g = null;
}

export function resetForestAmbience() { teardown(); nextCallAt = 0; lastForest = lastNight = -1; }

/** Per fixed step (from sfx.js stepGameAudio). No-ops until the AudioContext exists. */
export function stepForestAmbience(playerEntity) {
  const ctx = getCtx(), master = getMaster();
  if (!ctx || !master || !src.biomeAt || !playerEntity || !playerEntity.transform) return;
  if (!g) { g = build(ctx, master); nextCallAt = ctx.currentTime + nextCallDelay(); }
  const tr = playerEntity.transform;
  const forest = isForestBiome(src.biomeAt(tr.x, tr.y)) ? 1 : 0;
  const night = src.hour && isNightHour(src.hour()) ? 1 : 0;
  const now = ctx.currentTime;
  if (forest !== lastForest || night !== lastNight) { // targets only change on a state switch: no per-frame param churn
    lastForest = forest; lastNight = night;
    g.windG.gain.setTargetAtTime(forest * FOREST_WIND_PEAK, now, FADE_TC);
    g.dayBus.gain.setTargetAtTime(forest && !night ? 1 : 0, now, FADE_TC);
    g.nightBus.gain.setTargetAtTime(forest && night ? 1 : 0, now, FADE_TC);
  }
  if (!forest || isMuted() || now < nextCallAt) return;
  if (night) { owlHoot(ctx, g.nightBus, now); }
  else if (Math.random() < KNOCK_CHANCE) woodpecker(ctx, g.dayBus, now);
  else birdCall(ctx, g.dayBus, now);
  nextCallAt = now + nextCallDelay();
}

export function __test_state() { return { built: !!g, nextCallAt, nodeCount: g ? g.nodes.length : 0 }; }
