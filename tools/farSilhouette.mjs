// OB-209 (far silhouette): pure measure for tools/verify-far-silhouette.mjs (Node-testable, no DOM).
// Input: RGBA bytes of a still. Per column it finds the horizon (first row from the top whose luma departs from the
// sky colour), then compares the far band (just under the horizon) with the sky right above it and the terrain below.
// A far shape that is much PALER than both neighbours (owner: pale "building" cut-out) or much DARKER + bluer than the
// terrain (owner: navy far trees) is flagged per pixel; the result is the flagged fraction of the far band.

export const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Mean luma + rgb of rows [y0, y1) for columns [x0, x1). */
export function bandMean(px, w, x0, x1, y0, y1) {
  let n = 0, r = 0, g = 0, b = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  if (!n) return { r: 0, g: 0, b: 0, l: 0, n: 0 };
  r /= n; g /= n; b /= n; return { r, g, b, l: luma(r, g, b), n };
}

/**
 * Measure far-shape contrast in a still (letterbox rows = pure black are skipped).
 * Per column strip: the ground line gY = scanning up from `groundY` (row fraction), the first row much brighter than the
 * grass (luma > grass + groundT). Then up from gY the flat far fill (far hill / far trees, rows whose strip mean stays
 * within fillT of the row just above the ground line) until the colour jumps = the shape top; the sky reference is the
 * strip mean 2..6 rows above that top (xFrom..xTo = where the far hill sits at the OB-209 pose). Contrast = rgb distance fill vs sky ref; only shapes >= minH rows count.
 * Owner OB-209 view before the fix: ~43 (pale/green cut-out); after: ~30.
 */
export function measureFarBand(px, w, h, opts = {}) {
  const o = { groundY: 0.62, xFrom: 0.82, xTo: 1, cols: 20, groundT: 60, fillT: 6, minH: 12, maxUp: 0.35, ...opts };
  const row = (x0, x1, y) => bandMean(px, w, x0, x1, y, y + 1);
  let top = 0; while (top < h && row(0, w, top).l < 2) top++; // letterbox
  const shapes = [];
  for (let x0 = Math.floor(o.xFrom * w); x0 + o.cols <= Math.floor(o.xTo * w); x0 += o.cols) {
    const x1 = x0 + o.cols, y0 = Math.floor(o.groundY * h), grass = row(x0, x1, y0).l;
    let gY = -1;
    for (let y = y0; y > top + 4 && gY < 0; y--) if (row(x0, x1, y).l > grass + Math.min(o.groundT, Math.max(8, grass * 0.8))) gY = y; // dark night grass: smaller step
    if (gY < 0) continue;
    const fill = row(x0, x1, gY - 1); let y = gY - 1;
    const yMin = Math.max(top + 7, gY - Math.floor(o.maxUp * h));
    while (y > yMin) { const m = row(x0, x1, y - 1); if (Math.abs(m.r - fill.r) + Math.abs(m.g - fill.g) + Math.abs(m.b - fill.b) > o.fillT * 3) break; y--; }
    const hgt = gY - y;
    if (hgt < o.minH || y <= yMin) continue;
    const sky = bandMean(px, w, x0, x1, y - 6, y - 2);
    const dist = Math.hypot(fill.r - sky.r, fill.g - sky.g, fill.b - sky.b);
    shapes.push({ x: x0, top: y, ground: gY, h: hgt, dist: Math.round(dist), fill: [fill.r, fill.g, fill.b].map(Math.round), sky: [sky.r, sky.g, sky.b].map(Math.round) });
  }
  shapes.sort((a, b) => b.dist - a.dist);
  const k = Math.min(3, shapes.length), worstDist = k ? shapes.slice(0, k).reduce((a, s) => a + s.dist, 0) / k : 0;
  return { shapes: shapes.length, worstDist, worst: shapes.slice(0, 3) };
}

/** Gate: true (fail) when the mean of the 3 worst far shapes differs from the sky above them by more than maxDist (rgb). */
export function farGateFails(m, { maxDist = 36 } = {}) {
  return m.worstDist > maxDist;
}

/**
 * VISQA-02 (high far ridge): per column strip in [xFrom, xTo), rows [yFrom, yTo): the strongest step between the sky block just above
 * (rows y-6..y-2) and a FLAT block below (rows y..y+minH all within fillT of row y+1) = a far mountain cut out as one flat fill against
 * the sky at its ridge, counted only when the fill is PALER (luma) than that sky. dist = rgb distance of the two blocks; worstDist = mean of the 3 worst strips (gate with farGateFails).
 * Before VISQA-02 (burl-home 09/13: flat cream under blue sky) it is large; after, the fogged ridge takes the sky colour at its elevation.
 */
export function measureRidge(px, w, h, opts = {}) {
  const o = { xFrom: 0.42, xTo: 0.78, yFrom: 0.25, yTo: 0.5, cols: 20, fillT: 6, minH: 12, ...opts };
  const shapes = [];
  for (let x0 = Math.floor(o.xFrom * w); x0 + o.cols <= Math.floor(o.xTo * w); x0 += o.cols) {
    const x1 = x0 + o.cols; let best = null;
    for (let y = Math.floor(o.yFrom * h); y < Math.floor(o.yTo * h); y++) {
      const ref = bandMean(px, w, x0, x1, y + 1, y + 2); let flat = true;
      for (let k = y; k < y + o.minH && flat; k++) { const m = bandMean(px, w, x0, x1, k, k + 1); flat = Math.abs(m.r - ref.r) + Math.abs(m.g - ref.g) + Math.abs(m.b - ref.b) <= o.fillT * 3; }
      if (!flat) continue;
      const sky = bandMean(px, w, x0, x1, y - 6, y - 2), fill = bandMean(px, w, x0, x1, y, y + 4);
      if (fill.l < sky.l) continue; // only PALE cut-outs (owner: flat cream far hill); a darker ridge / cloud underside is aerial perspective
      const dist = Math.hypot(fill.r - sky.r, fill.g - sky.g, fill.b - sky.b);
      if (!best || dist > best.dist) best = { x: x0, top: y, dist: Math.round(dist), fill: [fill.r, fill.g, fill.b].map(Math.round), sky: [sky.r, sky.g, sky.b].map(Math.round) };
    }
    if (best) shapes.push(best);
  }
  shapes.sort((a, b) => b.dist - a.dist);
  const k = Math.min(3, shapes.length), worstDist = k ? shapes.slice(0, k).reduce((a, s) => a + s.dist, 0) / k : 0;
  return { shapes: shapes.length, worstDist, worst: shapes.slice(0, 3) };
}
