// CANOPY-SHAFT-01b (38.76 rule 8a): frame B (lift on) vs frame A (lift off) hard asserts. Pure + injectable so a Node test can drive it.
// `renderB()` draws frame B; `readCells(fg, bg)` is wg.readbackCells. Frame B gets FRESH arrays: the pipeline's no-arg readback returns
// its REUSED _rbFg/_rbBg buffers, which would overwrite frame A (and the twin compare would see the lift-ON frame).
// readShade/aSFg/aSBg are MANDATORY: a null readback FAILs the row (no silent fallback to final cells). Final cells keep a zero-tolerance sign assert
// (sign(final B - final A) == sign(shade B - shade A), no final change where the shade delta is 0; the edge gain is a positive multiply).
// Direction ("moves toward tint * sunI") is checked on the SHADE output when `readShade`/`aSFg`/`aSBg` are given: the lift is a shade-stage op and the
// edge pass after it multiplies fg by its rule gain (> 1 on cap/lip cells), which can carry a correctly lifted channel past the target in the final cells
// (root cause of the 12 wrongDir cells, 2026-10-15). Glyph / changed-cell / >= 1 % asserts stay on the final cells.
export async function shaftRule8a({ n, aFg, aBg, aSFg, aSBg, lightA, renderB, readCells, readShade, sunI, tint }) {
  await renderB();
  const rb = await readCells(new Uint8Array(n * 4), new Uint8Array(n * 4));
  const sb = readShade && aSFg ? await readShade(new Uint8Array(n * 4), new Uint8Array(n * 4)) : null;
  if (!sb || !sb.fg || !sb.bg) return { ok: false, fails: ['shade-stage readback unavailable (readbackShade null): rule 8a direction cannot be judged'], stats: { lifted: 0, liftedPct: 0, glyphDiff: 0, nonShaft: 0, wrongDir: 0, signMismatch: 0, maxLift: 0, samples: '' } };
  const dA = [aSBg, aSFg], dB = [sb.bg, sb.fg], fA = [aBg, aFg], fB = [rb.bg, rb.fg];
  const fails = [];
  let signMismatch = 0;
  const samples = []; let lifted = 0, glyphDiff = 0, nonShaft = 0, wrongDir = 0, maxLift = 0;
  for (let c = 0; c < n; c++) {
    const sq = (lightA[c * 4 + 3] >>> 20) & 15, o = c * 4;
    let ch = false;
    for (let k = 0; k < 3; k++) {
      for (const [a, b] of [[aBg, rb.bg], [aFg, rb.fg]]) { if (b[o + k] !== a[o + k]) { ch = true; maxLift = Math.max(maxLift, Math.abs(b[o + k] - a[o + k])); } }
      for (let pl = 0; pl < 2; pl++) {
        const a = dA[pl], b = dB[pl], d = b[o + k] - a[o + k], df = fB[pl][o + k] - fA[pl][o + k];
        if (Math.sign(df) !== Math.sign(d)) { signMismatch++; if (samples.length < 6) samples.push(['sign', c, k, pl ? 'fg' : 'bg', d, df].join(',')); } // zero tolerance, final cells vs shade stage
        if (d === 0) continue;
        const tgt = tint[k] * sunI; if ((d > 0 && a[o + k] > tgt + 1) || (d < 0 && a[o + k] < tgt - 1)) { wrongDir++; if (samples.length < 6) samples.push([c, k, pl ? 'fg' : 'bg', a[o + k], b[o + k], sq, Math.round(tgt)].join(',')); } // must move toward tint * sunI (1 byte slack)
      }
    }
    if (aFg[o + 3] !== rb.fg[o + 3]) glyphDiff++; // glyph code lives in fg.a
    if (ch) { if (sq === 0) nonShaft++; else lifted++; }
  }
  const liftedPct = 100 * lifted / n;
  if (glyphDiff) fails.push('glyph changed in ' + glyphDiff + ' cells');
  if (nonShaft) fails.push(nonShaft + ' changed cells with bits 20..23 = 0');
  if (wrongDir) fails.push(wrongDir + ' channels moved away from the sun tint (cell,ch,plane,A,B,sq,tgt: ' + samples.join(' | ') + ')');
  if (signMismatch) fails.push(signMismatch + ' final-cell channels whose change sign differs from the shade-stage delta');
  if (liftedPct < 1) fails.push('only ' + liftedPct.toFixed(2) + ' % of cells lifted (>= 1 % required)');
  return { ok: fails.length === 0, fails, stats: { lifted, liftedPct, glyphDiff, nonShaft, wrongDir, signMismatch, maxLift, samples: samples.join(' | ') } };
}
