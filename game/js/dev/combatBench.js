// COMBAT-BENCH-01 (M3 exit "?bench=1 with 4 enemies"): `?bench=combat` / `?bench=1&enemies=4`.
// Pure parts (Node-tested): buildCombatScene(seed), evalBudget(samples, limits). `runCombatBench(ctx)` is the
// browser runner: it moves 4 of the world's real boars (through the real beastSim) into a ring around the
// player, plays the script as combat:hit events (sparks + hurt FX run) and times 600 frames.

// OWNER: budget pending (PO proposal: 16.7/12/8/8 low/med/high/ultra)
export const BUDGET_MS = 8; // flat default; `?budget=<ms>` overrides
export const FRAMES = 600;
export const RING_R = 7;
const SWING_GAP_MS = 500;

function lcg(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Pure + deterministic. Positions are relative to the player (centre 0,0); the runner adds the offset. */
export function buildCombatScene(seed = 1) {
  const r = lcg(seed);
  const phase = r() * Math.PI * 2;
  const beasts = [];
  for (let k = 0; k < 4; k++) {
    const a = phase + k * Math.PI / 2;
    const x = Math.round(Math.cos(a) * RING_R * 1000) / 1000, z = Math.round(Math.sin(a) * RING_R * 1000) / 1000;
    beasts.push({ x, z, homeX: x, homeZ: z });
  }
  const script = [{ tMs: 0, action: 'face' }];
  let t = 500;
  for (let i = 0; i < 3; i++, t += SWING_GAP_MS) script.push({ tMs: t, action: 'swing' });
  script.push({ tMs: t, action: 'backstep' }); t += SWING_GAP_MS;
  for (let i = 0; i < 2; i++, t += SWING_GAP_MS) script.push({ tMs: t, action: 'swing' });
  return { player: { x: 0, y: 0, z: 0, yaw: Math.round(phase * 1000) / 1000 }, beasts, script };
}

/** p50/p95/avg of frame times (nearest-rank on the sorted copy, same rule as perfBench) + PASS/FAIL. */
export function evalBudget(samplesMs, { p95Max = BUDGET_MS, avgMax = BUDGET_MS } = {}) {
  const n = samplesMs.length;
  if (!n) return { pass: false, p50: NaN, p95: NaN, avg: NaN };
  const s = Array.from(samplesMs).sort((a, b) => a - b);
  const at = (q) => s[Math.min(n - 1, Math.floor(n * q))];
  const avg = s.reduce((a, b) => a + b, 0) / n;
  const p50 = at(0.5), p95 = at(0.95);
  return { pass: p95 <= p95Max && avg <= avgMax, p50, p95, avg };
}

export function formatLine(res, budget) {
  const f = (v) => v.toFixed(2);
  return `combat bench: p50 ${f(res.p50)} p95 ${f(res.p95)} avg ${f(res.avg)} ${res.pass ? 'PASS' : 'FAIL'} (budget ${budget} ms)`;
}

/** Pads the world to 4 beasts (world_m1 has 2) by cloning boar1's components; call BEFORE createBeastSim. */
export function ensureBenchBoars(world) {
  const found = [];
  world.forEachEntity((e) => { if (e.components && e.components.brain && e.components.brain.kind === 'beast') found.push(e); });
  if (!found.length) return;
  const src = found[0];
  for (let n = found.length; n < 4; n++) {
    const t = src.transform, x = t.x + 3 * n, y = t.y;
    world.spawn(src.type, { ...t, x, y }, JSON.parse(JSON.stringify(src.components)), `benchBoar${n}`);
  }
}

/** Browser runner. Needs window.__debug (beasts, playerHandle, loop) from runGame('world'). */
export function runCombatBench(ctx) {
  const params = ctx.params;
  const budget = Number(params.get('budget')) > 0 ? Number(params.get('budget')) : BUDGET_MS;
  const scene = buildCombatScene(Number(params.get('seed')) || 1);
  const dbg = window.__debug;
  let frame = 0, started = false, t0 = 0, scriptI = 0, centre = null;
  const samples = [];
  const hit = { source: 'player', target: '', damage: 0.5, heavy: false, x: 0, y: 0, z: 0, dirX: 0, dirY: 1, dirZ: 0 };

  function setup() {
    const b = dbg.beasts, ph = dbg.playerHandle;
    if (!b || !ph || b.count < 4) return false;
    centre = { x: b.entities[0].transform.x, y: b.entities[0].transform.y, z: b.entities[0].transform.z };
    const pt = ph.data.transform;
    pt.x = centre.x; pt.y = centre.y; pt.z = centre.z; pt.yawDeg = scene.player.yaw * 180 / Math.PI;
    for (let i = 0; i < 4; i++) {
      const e = b.entities[i], sb = scene.beasts[i];
      const x = centre.x + sb.x, y = centre.y + sb.z;
      e.transform.x = x; e.transform.y = y; e.transform.z = centre.z;
      b.steer.x[i] = x; b.steer.y[i] = y; b.homeX[i] = x; b.homeY[i] = y; b.homeZ[i] = centre.z;
    }
    return true;
  }

  function playScript(tMs) {
    while (scriptI < scene.script.length && scene.script[scriptI].tMs <= tMs) {
      const a = scene.script[scriptI++].action;
      if (a !== 'swing') continue;
      let best = 0, bd = Infinity;
      for (let i = 0; i < 4; i++) { const b = scene.beasts[i], d = b.x * b.x + b.z * b.z; if (d < bd) { bd = d; best = i; } }
      const e = dbg.beasts.entities[best];
      hit.target = e.id; hit.x = e.transform.x; hit.y = e.transform.y; hit.z = e.transform.z + 0.6;
      dbg.engine.events.emit('combat:hit', hit);
    }
  }

  function tick() {
    if (!started) { if (setup()) { started = true; t0 = performance.now(); } requestAnimationFrame(tick); return; }
    const ph = dbg.playerHandle.data.transform; // pin the player at the ring centre
    ph.x = centre.x; ph.y = centre.y;
    if (frame > 0) samples.push(dbg.loop.stats.jsMs);
    playScript(performance.now() - t0);
    if (++frame <= FRAMES) { requestAnimationFrame(tick); return; }
    const res = evalBudget(samples, { p95Max: budget, avgMax: budget });
    const line = formatLine(res, budget);
    const gp = ctx.wgPipeline && ctx.wgPipeline.stats && ctx.wgPipeline.stats.passMsP50;
    const table = gp ? ` | wg passMsP50 ${Array.from(gp, (v) => v.toFixed(2)).join(' ')}` : '';
    window.__combatBench = { ...res, budget, line };
    console.log(line + table);
    ctx.overlay.visible = true; ctx.overlay.el.style.display = 'block'; ctx.overlay.el.textContent = line + table;
  }
  requestAnimationFrame(tick);
}
