// game/js/audio/undergroundAmbience.js (UNDER-08, EP-UNDER)
//
// Two quiet beds beside forestAmbience.js, one bed at a time:
//  - CEMETERY: within CEMETERY_RADIUS of an anchor (cemetery1, supplied by main
//    from world data): low wind, rare crow caw, at night a faint distant bell
//    or creak every 20-40 s.
//  - UNDERGROUND: scene is 'interior' AND level meta ambience is 'cave'|'crypt':
//    room tone, water drips (1-5 s, random pan, 3 pitches); crypt adds a faint
//    distant scrape now and then.
// When either is active the forest bed is suppressed (setForestSuppressed), so
// the beds crossfade (~1.5 s, setTargetAtTime tc 0.5). Synth only (D-004), all
// persistent nodes built once; one-shots only at event rate. Master/mute via synth.js.
// No footstep reverb: sfx.js footsteps have no send bus (skipped, AC allows).
import { getCtx, getMaster, isMuted } from './synth.js';
import { setForestSuppressed } from './forestAmbience.js';

export const CEMETERY_RADIUS = 40;
export const DEFAULT_CEMETERY = { x: 1644, y: 1372 }; // fallback only; main passes world anchors
export const CEM_WIND_PEAK = 0.03, CEM_CROW_PEAK = 0.04, CEM_BELL_PEAK = 0.03;
export const TONE_PEAK = 0.025, DRIP_PEAK = 0.05, SCRAPE_PEAK = 0.02;
export const DRIP_MIN_S = 1, DRIP_MAX_S = 5;
export const BELL_MIN_S = 20, BELL_MAX_S = 40;
const FADE_TC = 0.5;            // ~95% in 1.5 s
const NIGHT_START_H = 20, NIGHT_END_H = 5.5;
const DRIP_PITCH = [1400, 1900, 2500];

const src = { anchors: null, sceneOf: null, ambienceAt: null, hour: null };
/** anchors: [{x,y}] (cemetery1 ...); sceneOf(x,y,z)->'interior'|...; ambienceAt(x,y,z)->'cave'|'crypt'|...|null; hour()->0..24. */
export function setUndergroundSources({ anchors = null, sceneOf = null, ambienceAt = null, hour = null } = {}) {
  src.anchors = anchors; src.sceneOf = sceneOf; src.ambienceAt = ambienceAt; src.hour = hour;
}

export function nearAnchor(anchors, x, y, r = CEMETERY_RADIUS) {
  for (let i = 0; i < anchors.length; i++) { const dx = x - anchors[i].x, dy = y - anchors[i].y; if (dx * dx + dy * dy <= r * r) return true; }
  return false;
}
const DEFAULT_ANCHORS = [DEFAULT_CEMETERY];
/** 0 none, 1 cemetery, 2 cave, 3 crypt. Underground wins over cemetery. */
export function pickBed(tr) {
  if (src.sceneOf && src.ambienceAt && src.sceneOf(tr.x, tr.y, tr.z) === 'interior') {
    const a = src.ambienceAt(tr.x, tr.y, tr.z);
    if (a === 'cave') return 2;
    if (a === 'crypt') return 3;
  }
  return nearAnchor(src.anchors || DEFAULT_ANCHORS, tr.x, tr.y) ? 1 : 0;
}
const isNight = (h) => h >= NIGHT_START_H || h < NIGHT_END_H;

let g = null;
let nextDrip = 0, nextCrow = 0, nextBell = 0, nextScrape = 0;
let lastBed = -1, lastNight = -1;

function noiseSource(ctx, seconds) {
  const n = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  return s;
}
function build(ctx, master) {
  const wind = noiseSource(ctx, 4);
  const windF = ctx.createBiquadFilter(); windF.type = 'lowpass'; windF.frequency.value = 320; windF.Q.value = 0.7;
  const windG = ctx.createGain(); windG.gain.value = 0;
  const gust = ctx.createGain(); gust.gain.value = 1;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07 + Math.random() * 0.05;
  const lfoD = ctx.createGain(); lfoD.gain.value = 0.45;
  lfo.connect(lfoD); lfoD.connect(gust.gain);
  wind.connect(windF); windF.connect(windG); windG.connect(gust); gust.connect(master);
  const tone = ctx.createOscillator(); tone.type = 'sine'; tone.frequency.value = 62;   // room tone
  const toneG = ctx.createGain(); toneG.gain.value = 0;
  tone.connect(toneG); toneG.connect(master);
  const cemBus = ctx.createGain(); cemBus.gain.value = 0; cemBus.connect(master);       // crow
  const nightBus = ctx.createGain(); nightBus.gain.value = 0; nightBus.connect(master); // bell / creak
  const ugBus = ctx.createGain(); ugBus.gain.value = 0; ugBus.connect(master);          // drips, scrape
  wind.start(); lfo.start(); tone.start();
  const nodes = [wind, windF, windG, gust, lfo, lfoD, tone, toneG, cemBus, nightBus, ugBus];
  return { ctx, master, windG, toneG, cemBus, nightBus, ugBus, nodes };
}
function pannerFor(ctx, bus) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = Math.random() * 2 - 1; p.connect(bus); return p; }
  return bus;
}
function voice(ctx, out, t0, type, f0, f1, att, dur, peak) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0, t0);
  gn.gain.linearRampToValueAtTime(peak, t0 + att);
  gn.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(gn); gn.connect(out);
  o.start(t0); o.stop(t0 + dur + 0.02);
  o.onended = () => { o.disconnect(); gn.disconnect(); };
}
const rnd = (a, b) => a + Math.random() * (b - a);
export const nextDripDelay = (r = Math.random) => DRIP_MIN_S + r() * (DRIP_MAX_S - DRIP_MIN_S);
export const nextBellDelay = (r = Math.random) => BELL_MIN_S + r() * (BELL_MAX_S - BELL_MIN_S);

function drip(ctx, bus, t) {
  const f = DRIP_PITCH[(Math.random() * 3) | 0] * rnd(0.95, 1.05);
  const out = pannerFor(ctx, bus);
  voice(ctx, out, t, 'sine', f * 1.3, f * 0.8, 0.004, 0.12, DRIP_PEAK);
  voice(ctx, out, t + 0.11, 'sine', f * 1.3, f * 0.8, 0.004, 0.2, DRIP_PEAK * 0.3); // tiny echo
}
function crow(ctx, bus, t) {
  const out = pannerFor(ctx, bus), n = 2 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) voice(ctx, out, t + i * 0.3, 'sawtooth', 700, 380, 0.03, 0.22, CEM_CROW_PEAK);
}
function bell(ctx, bus, t) {
  const out = pannerFor(ctx, bus);
  if (Math.random() < 0.5) { voice(ctx, out, t, 'sine', 330, 328, 0.01, 2.2, CEM_BELL_PEAK); voice(ctx, out, t, 'sine', 497, 495, 0.01, 1.4, CEM_BELL_PEAK * 0.5); }
  else voice(ctx, out, t, 'sawtooth', 160, 90, 0.2, 0.9, CEM_BELL_PEAK * 0.6); // creak
}
function scrape(ctx, bus, t) { voice(ctx, pannerFor(ctx, bus), t, 'sawtooth', 90, 60, 0.5, 1.6, SCRAPE_PEAK); }

function teardown() {
  if (!g) return;
  for (const n of g.nodes) { try { n.stop && n.stop(); } catch (e) { /* not a source */ } try { n.disconnect(); } catch (e) { /* fine */ } }
  g = null;
}
export function resetUndergroundAmbience() {
  teardown(); setForestSuppressed(false);
  nextDrip = nextCrow = nextBell = nextScrape = 0; lastBed = lastNight = -1;
}

/** Per fixed step; call BEFORE stepForestAmbience. No-ops until the AudioContext exists. */
export function stepUndergroundAmbience(playerEntity) {
  const ctx = getCtx(), master = getMaster();
  if (!ctx || !master || !playerEntity || !playerEntity.transform) return;
  if (!g) g = build(ctx, master);
  const tr = playerEntity.transform, now = ctx.currentTime;
  const bed = pickBed(tr);
  const night = src.hour && isNight(src.hour()) ? 1 : 0;
  if (bed !== lastBed || night !== lastNight) {
    if (bed !== lastBed) {
      setForestSuppressed(bed !== 0);
      nextDrip = now + nextDripDelay(); nextCrow = now + rnd(8, 25); nextBell = now + nextBellDelay(); nextScrape = now + rnd(12, 30);
    }
    lastBed = bed; lastNight = night;
    const cem = bed === 1, under = bed >= 2;
    g.windG.gain.setTargetAtTime(cem ? CEM_WIND_PEAK : 0, now, FADE_TC);
    g.cemBus.gain.setTargetAtTime(cem ? 1 : 0, now, FADE_TC);
    g.nightBus.gain.setTargetAtTime(cem && night ? 1 : 0, now, FADE_TC);
    g.toneG.gain.setTargetAtTime(under ? TONE_PEAK : 0, now, FADE_TC);
    g.ugBus.gain.setTargetAtTime(under ? 1 : 0, now, FADE_TC);
  }
  if (!bed || isMuted()) return;
  if (bed === 1) {
    if (now >= nextCrow) { crow(ctx, g.cemBus, now); nextCrow = now + rnd(8, 25); }
    if (night && now >= nextBell) { bell(ctx, g.nightBus, now); nextBell = now + nextBellDelay(); }
  } else {
    if (now >= nextDrip) { drip(ctx, g.ugBus, now); nextDrip = now + nextDripDelay(); }
    if (bed === 3 && now >= nextScrape) { scrape(ctx, g.ugBus, now); nextScrape = now + rnd(12, 30); }
  }
}
export function __test_state() { return { built: !!g, bed: lastBed, nextDrip, nextBell, nodeCount: g ? g.nodes.length : 0 }; }
