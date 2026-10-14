// ENV-03a (arch 38.65 point 1): per-step biome-atmosphere weights, 0 alloc, no pops.
//   const d = createAtmosDriver({ nEntries, biomeToEntry: Int8Array(16) (-1 = none), biomeBlend(x, y, out{a,b,w}),
//                                 schedule: P.daySchedule, slotOf: { morning:0, noon:0, dusk:1, night:2 }, fadeSec: 1.5, frozenSlot: 0 });
//   d.step(camX, camY, hour, dt, outdoor)   // per unpaused 60 Hz step; hour not finite = frozen clock (tod = one-hot frozenSlot)
//   d.snap(camX?, camY?, hour?, outdoor?)   // jump to the target (load / teleport); no args = the last step's inputs
//   d.out = { w: F32(n), wNone, tod: F32(3), version }   d.active: pass `d.active ? d.out : null` to mixAtmos (off = engine sees null)
// Rules: target re-sampled only after the camera moved > 2 m (jitter at rest costs nothing); weights move on the straight line
// toward the target, at most dt/fadeSec per step each (sum stays 1); version bumps only when a weight/tod moved >= 1/256 since
// the last bump; active turns off at wNone >= 0.999, on again below 0.995; a jump > 50 m and the first step snap.

export function createAtmosDriver(opts) {
  const n = opts.nEntries, b2e = opts.biomeToEntry, blend = opts.biomeBlend, sched = opts.schedule, slotOf = opts.slotOf;
  const fadeSec = opts.fadeSec || 1.5, frozenSlot = opts.frozenSlot | 0;
  const out = { w: new Float32Array(n), wNone: 1, tod: new Float32Array(3), version: 0 };
  const cur = new Float64Array(n + 1), tgt = new Float64Array(n + 1), last = new Float64Array(n + 4); // index n = none; last = bump snapshot (+ tod)
  const tmp = { a: 0, b: 0, w: 0 };
  const slots = new Int8Array(sched.length);
  for (let i = 0; i < sched.length; i++) { const s = slotOf[sched[i].key]; slots[i] = s === undefined ? frozenSlot : s; }
  cur[n] = 1; tgt[n] = 1;
  const P = new Float64Array(5); // sx, sy, lcx, lcy, lhour (typed array: closure doubles would box = alloc)
  let sampled = false, lastOutdoor = true, started = false, active = false;
  const self = { out, get active() { return active; }, step, snap };
  P[4] = NaN;

  function entryOf(id) { return id >= 0 && id < 16 ? b2e[id] : -1; }

  function sample(cx, cy, outdoor) {
    tgt.fill(0);
    if (!outdoor) tgt[n] = 1;
    else {
      blend(cx, cy, tmp);
      const ea = entryOf(tmp.a), eb = entryOf(tmp.b);
      tgt[ea < 0 ? n : ea] += 1 - tmp.w;
      tgt[eb < 0 ? n : eb] += tmp.w;
    }
    P[0] = cx; P[1] = cy; sampled = true;
  }

  // tod from the schedule segment rule of blendLook (linear between the two neighbours)
  function setTod(hour) {
    const t = out.tod;
    t[0] = t[1] = t[2] = 0;
    if (!isFinite(hour)) { t[frozenSlot] = 1; return; }
    const m = sched.length, h = ((hour % 24) + 24) % 24;
    let i = m - 1;
    for (let k = 0; k < m; k++) if (sched[k].h > h) { i = k - 1; break; }
    let h0;
    if (i < 0) { i = m - 1; h0 = sched[i].h - 24; } else h0 = sched[i].h;
    const j = (i + 1) % m, h1 = (i + 1 < m) ? sched[j].h : sched[j].h + 24, span = h1 - h0, f = span > 0 ? (h - h0) / span : 0;
    t[slots[i]] += 1 - f; t[slots[j]] += f;
  }

  function publish(force) {
    let sum = 0;
    for (let e = 0; e < n; e++) { out.w[e] = cur[e]; sum += out.w[e]; }
    const wn = out.wNone = Math.max(0, 1 - sum);
    const was = active;
    if (active) { if (wn >= 0.999) active = false; } else if (wn < 0.995) active = true;
    let d = force || was !== active;
    const T = 1 / 256;
    if (!d) {
      for (let e = 0; e < n; e++) if (Math.abs(out.w[e] - last[e]) >= T) { d = true; break; }
      if (!d && Math.abs(wn - last[n]) >= T) d = true;
      if (!d) for (let s = 0; s < 3; s++) if (Math.abs(out.tod[s] - last[n + 1 + s]) >= T) { d = true; break; }
    }
    if (d) {
      for (let e = 0; e < n; e++) last[e] = out.w[e];
      last[n] = wn;
      for (let s = 0; s < 3; s++) last[n + 1 + s] = out.tod[s];
      out.version++;
    }
  }

  function snap(cx, cy, hour, outdoor) {
    if (cx === undefined) { cx = P[2]; cy = P[3]; hour = P[4]; outdoor = lastOutdoor; }
    P[2] = cx; P[3] = cy; P[4] = hour; lastOutdoor = outdoor !== false;
    sample(cx, cy, lastOutdoor);
    for (let i = 0; i <= n; i++) cur[i] = tgt[i];
    setTod(hour);
    started = true;
    publish(true);
  }

  function step(cx, cy, hour, dt, outdoor) {
    outdoor = outdoor !== false;
    P[2] = cx; P[3] = cy; P[4] = hour;
    const dx = cx - P[0], dy = cy - P[1], d2 = dx * dx + dy * dy;
    if (!started || d2 > 2500) { snap(cx, cy, hour, outdoor); return; }
    if (outdoor !== lastOutdoor) { lastOutdoor = outdoor; sample(cx, cy, outdoor); }
    else if (d2 > 4) sample(cx, cy, outdoor);
    // straight line toward the target: every |dw| <= dt/fade, the sum stays 1
    let maxd = 0;
    for (let i = 0; i <= n; i++) { const d = Math.abs(tgt[i] - cur[i]); if (d > maxd) maxd = d; }
    if (maxd > 0) {
      const lim = dt / fadeSec, s = maxd <= lim ? 1 : lim / maxd;
      for (let i = 0; i <= n; i++) cur[i] += (tgt[i] - cur[i]) * s;
    }
    setTod(hour);
    publish(false);
  }
  return self;
}
