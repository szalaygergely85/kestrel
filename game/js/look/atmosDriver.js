// ENV-03a (arch 38.65 point 1): camera-biome atmosphere weights, no pops, 0 alloc per step.
// createAtmosDriver({ nEntries, biomeToEntry, biomeBlend(x, y, out{a,b,w}), schedule [{h,key}], slotOf {key: slot}, fadeSec = 1.5, defaultTime })
// out.step(camX, camY, hour, dt, outdoor): hour = number (0..24) or a schedule key (frozen clock). The output record is `out` itself:
//   { w: F32(nEntries), wNone, tod: F32(3) day/dusk/night, version, on, step, snap }   sum(w) + wNone == 1.
// Rules: target re-sampled only after the camera moved > 2 m (strict, so +-1 m jitter never re-samples); all weights move together
// toward the target, the biggest by at most dt/fadeSec per step (sum stays 1, a full swap takes fadeSec); `version` bumps only when a
// weight or tod moved >= 1/256 since the last bump; `on` goes false at wNone >= 0.999 and true again below 0.995.
// First step and snap() jump straight to the target; a camera jump > 50 m snaps too. outdoor === false = target all "none".
export function createAtmosDriver(opts) {
  const n = opts.nEntries, b2e = opts.biomeToEntry, blendFn = opts.biomeBlend, fadeSec = opts.fadeSec || 1.5;
  const sched = opts.schedule, slotOf = opts.slotOf;
  const out = { w: new Float32Array(n), wNone: 1, tod: new Float32Array(3), version: 0, on: false, step: null, snap: null };
  const target = new Float64Array(n + 1), cur = new Float64Array(n + 1);   // last index = "none"
  cur[n] = 1;
  const lastW = new Float32Array(n), lastTod = new Float32Array(3);
  const blend = { a: 0, b: 0, w: 0 };
  const slots = sched.map(s => { const v = slotOf[s.key]; if (v === undefined) throw new Error('atmosDriver: no slot for ' + s.key); return v; });
  const frozenSlot = slotOf[opts.defaultTime || 'noon'] | 0;
  const sc = new Float64Array(3);   // [0] sx, [1] sy, [2] lastNone (typed array: no boxed closure doubles)
  sc[2] = 1;
  let sampled = false, lastOutdoor = true, snapPending = true;
  const STEP = 1 / 256;

  function entryOf(id) { const e = id >= 0 && id < b2e.length ? b2e[id] : -1; return e >= 0 && e < n ? e : n; }
  function sample(x, y, outdoor) {
    for (let i = 0; i <= n; i++) target[i] = 0;
    if (!outdoor) target[n] = 1;
    else { blendFn(x, y, blend); target[entryOf(blend.a)] += 1 - blend.w; target[entryOf(blend.b)] += blend.w; }
    sc[0] = x; sc[1] = y; sampled = true; lastOutdoor = outdoor;
  }
  function setTod(hour) {
    const t = out.tod; t[0] = t[1] = t[2] = 0;
    if (typeof hour !== 'number') { t[hour !== undefined && slotOf[hour] !== undefined ? slotOf[hour] : frozenSlot] = 1; return; }
    const m = sched.length; let a = m - 1;
    for (let i = 0; i < m; i++) if (sched[i].h <= hour) a = i;
    const b = (a + 1) % m, ha = sched[a].h;
    let hb = sched[b].h; if (hb <= ha) hb += 24;
    let hh = hour; if (hh < ha) hh += 24;
    const f = Math.min(1, Math.max(0, (hh - ha) / (hb - ha)));
    t[slots[a]] += 1 - f; t[slots[b]] += f;
  }
  function remember() {
    for (let i = 0; i < n; i++) lastW[i] = out.w[i];
    sc[2] = out.wNone;
    for (let i = 0; i < 3; i++) lastTod[i] = out.tod[i];
  }
  function publish() {
    let s = 0;
    for (let i = 0; i < n; i++) { out.w[i] = cur[i]; s += out.w[i]; }
    out.wNone = 1 - s;
    if (out.on ? out.wNone >= 0.999 : out.wNone < 0.995) { out.on = !out.on; out.version++; remember(); return; }
    let moved = Math.abs(out.wNone - sc[2]) >= STEP;
    for (let i = 0; i < n && !moved; i++) if (Math.abs(out.w[i] - lastW[i]) >= STEP) moved = true;
    for (let i = 0; i < 3 && !moved; i++) if (Math.abs(out.tod[i] - lastTod[i]) >= STEP) moved = true;
    if (moved) { out.version++; remember(); }
  }

  out.step = function (camX, camY, hour, dt, outdoor) {
    const od = outdoor !== false;
    const d2 = (camX - sc[0]) * (camX - sc[0]) + (camY - sc[1]) * (camY - sc[1]);
    const jump = snapPending || !sampled || d2 > 2500;
    if (jump || od !== lastOutdoor || d2 > 4) sample(camX, camY, od);
    setTod(hour);
    if (jump) { for (let i = 0; i <= n; i++) cur[i] = target[i]; snapPending = false; }
    else {
      let maxD = 0;
      for (let i = 0; i <= n; i++) { const d = Math.abs(target[i] - cur[i]); if (d > maxD) maxD = d; }
      const cap = dt / fadeSec, s = maxD > cap ? cap / maxD : 1;
      for (let i = 0; i <= n; i++) cur[i] += (target[i] - cur[i]) * s;
    }
    publish();
    return out;
  };
  out.snap = function () { snapPending = true; };
  return out;
}
