// FLICKER-F3-01 (OB-208): live flicker number for the F3 panel. Pure logic, fixed buffers, 0 alloc per push().
// flicker = share of cells that are non-sky in BOTH frames whose GLYPH byte (fg.a, as flickerStep reads it) changed
// vs the previous presented frame. EMA over 30 frames, kept separately for "still camera" (the honest number) and
// "moving" (raw change incl. legitimate parallax). The reprojected metric (flickerReprojStep) needs the Depth readback
// + camera matrices every frame -> not cheap here, so no reprojected variant (the line says "raw" while moving).
export const EMA_FRAMES = 30;

export function createFlickerMeter(maxCells = 0) {
  const a = 2 / (EMA_FRAMES + 1);
  let prevGlyph = new Uint8Array(maxCells), prevKind = new Uint8Array(maxCells), n = 0, have = false;
  const cam = new Float64Array(5);
  const m = {
    still: 0, moving: 0, nStill: 0, nMoving: 0, lastStill: true, last: 0,
    /** gi = Uint32Array(4n) (readbackGeometry().GI; kind = low byte of .y), fg = Uint8Array(4n) (glyph in byte 3). */
    push(gi, fg, cells, cx, cy, cz, yaw, pitch) {
      if (cells > prevGlyph.length) { prevGlyph = new Uint8Array(cells); prevKind = new Uint8Array(cells); have = false; } // grid grew (rare)
      if (cells !== n) { n = cells; have = false; }
      const still = have && cam[0] === cx && cam[1] === cy && cam[2] === cz && cam[3] === yaw && cam[4] === pitch;
      cam[0] = cx; cam[1] = cy; cam[2] = cz; cam[3] = yaw; cam[4] = pitch;
      let total = 0, changed = 0;
      for (let i = 0; i < cells; i++) {
        const k = gi[i * 4 + 1] & 0xff, g = fg[i * 4 + 3];
        if (have && k !== 0 && prevKind[i] !== 0) { total++; if (g !== prevGlyph[i]) changed++; }
        prevKind[i] = k; prevGlyph[i] = g;
      }
      if (!have) { have = true; return m; }
      const r = total ? changed / total : 0;
      m.last = r; m.lastStill = still;
      if (still) { m.still = m.nStill++ ? m.still + a * (r - m.still) : r; }
      else { m.moving = m.nMoving++ ? m.moving + a * (r - m.moving) : r; }
      return m;
    },
    reset() { have = false; m.still = m.moving = 0; m.nStill = m.nMoving = 0; },
    /** F3 line (allocates a string; F3 only). */
    text() {
      if (m.nStill && m.lastStill) return `flicker ${(m.still * 100).toFixed(2)}% (still)`;
      if (m.nMoving && !m.lastStill) return `flicker ${(m.moving * 100).toFixed(2)}% (moving, raw)` + (m.nStill ? `  last still ${(m.still * 100).toFixed(2)}%` : '');
      return m.nStill ? `flicker ${(m.still * 100).toFixed(2)}% (still, held)` : 'flicker ... (stand still)';
    },
  };
  return m;
}
