// NIGHT-HAZE-01: the far terrain fog colour follows the hour. JS twin = the only implementation: the colours are written IN PLACE
// into P.rgb[fog.far.color / colorFar] (and liveFogVersion is bumped), which terrainShade, compositor and the GPU fog uniforms
// (passShade) already re-read per version - so JS path and WGSL see the same numbers. Day weight 1 writes the captured base bytes
// exactly (day rows byte-identical). Same schedule rule as blendLook / atmosDriver. 0 alloc per apply.
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * @param {any} P palette (rgb, fog.far, daySchedule)
 * @param {{dusk:{near:string,far:string},dawn?:{near:string,far:string},night:{near:string,far:string}}} spec hex colours
 * @param {Record<string,number>} [slotOf] schedule key -> 0 day / 1 dusk / 2 night / 3 dawn
 */
export function createFogHour(P, spec, slotOf = { morning: 0, noon: 0, dusk: 1, night: 2, dawn: 3 }) {
  const rec = P.fog.farBase || P.fog.far, kn = rec.color, kf = rec.colorFar;
  const base = [P.rgb[kn].slice(), P.rgb[kf].slice()];
  const col = [[base[0], hexRGB(spec.dusk.near), hexRGB(spec.night.near), hexRGB((spec.dawn || spec.dusk).near)], [base[1], hexRGB(spec.dusk.far), hexRGB(spec.night.far), hexRGB((spec.dawn || spec.dusk).far)]];
  const sched = P.daySchedule, m = sched.length, slots = sched.map((s) => (slotOf[s.key] === undefined ? 0 : slotOf[s.key]));
  const tod = new Float64Array(4);
  let last = -1;
  function weights(hour) {
    tod[0] = tod[1] = tod[2] = tod[3] = 0;
    const h = ((hour % 24) + 24) % 24;
    let i = m - 1;
    for (let k = 0; k < m; k++) if (sched[k].h > h) { i = k - 1; break; }
    let h0;
    if (i < 0) { i = m - 1; h0 = sched[i].h - 24; } else h0 = sched[i].h;
    const j = (i + 1) % m, h1 = i + 1 < m ? sched[j].h : sched[j].h + 24, span = h1 - h0, f = span > 0 ? (h - h0) / span : 0;
    tod[slots[i]] += 1 - f; tod[slots[j]] += f;
    return tod;
  }
  return {
    tod,
    /** Write the hour's far fog colours; returns true when they changed (version bumped). Non-finite hour = day base. */
    apply(hour) {
      const t = weights(Number.isFinite(hour) ? hour : 12);
      const key = Math.round(t[1] * 1024) * 2048 + Math.round(t[2] * 1024) + Math.round(t[3] * 1024) * 4194304;
      if (key === last) return false;
      last = key;
      for (let c = 0; c < 2; c++) {
        const dst = P.rgb[c ? kf : kn], d = col[c];
        if (t[0] === 1) { dst[0] = d[0][0]; dst[1] = d[0][1]; dst[2] = d[0][2]; continue; }
        for (let k = 0; k < 3; k++) dst[k] = d[0][k] * t[0] + d[1][k] * t[1] + d[2][k] * t[2] + d[3][k] * t[3];
      }
      P.liveFogVersion = (P.liveFogVersion | 0) + 1;
      return true;
    },
  };
}
