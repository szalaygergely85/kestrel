// engine/ui/fade.js (US-017, docs/architecture.md 7.4 "Fade"). The
// `uiStyle.fade` rule as engine code: glyphs dim DOWN THE RAMP as the scene
// fades, not just an overlay alpha, so a bright wall stays a brighter glyph
// than a dark one for longer, exactly like real light fading out. The ramp
// itself is data (`palette.ramps.<key>`, index 0 = darkest = space, last =
// brightest - design/palette.js section 2), never hard-coded here.
//
// Allocation rule (9): `applySceneFade` runs at most once per rendered
// frame (compositor.js, `renderWorld`'s CPU path only) but over every cell,
// so it must not allocate - `createFadeLut` does the one-time setup work.

/** @typedef {{idx:Uint8Array, ramp:Uint8Array, minGain:number}} FadeLut */

/**
 * @param {string} ramp - a `palette.ramps.<key>` string, index 0 = space.
 * @param {number} letterIndex - ramp index used for any code NOT found in
 *   `ramp` (arbitrary UI letters/digits/punctuation drawn as text, not part
 *   of a material's own glyph ramp) - typically the brightest index, so
 *   text starts fully lit and fades exactly like a ramp glyph would.
 * @param {number} [minGain] - color floor at `a = 0` (0 = pure black).
 * @returns {FadeLut}
 */
export function createFadeLut(ramp, letterIndex, minGain) {
  const n = ramp.length;
  const idx = new Uint8Array(128);
  idx.fill(letterIndex);
  for (let i = 0; i < n; i++) {
    const code = ramp.charCodeAt(i);
    if (code >= 0 && code < 128) idx[code] = i;
  }
  const rampCodes = new Uint8Array(n);
  for (let i = 0; i < n; i++) rampCodes[i] = ramp.charCodeAt(i);
  return { idx, ramp: rampCodes, minGain: typeof minGain === 'number' ? minGain : 0 };
}

/**
 * `code` (an ASCII char code, e.g. `glyphIdx + 32`) faded to amount `a`
 * (1 = unfaded/identity, 0 = space): `i` = this code's own position in the
 * ramp (or `lut.idx`'s default `letterIndex` for anything not in it),
 * result = `ramp[round(a * i)]` - as `a` falls, the glyph steps DOWN the
 * ramp toward index 0 (space), never sideways to an unrelated glyph. Pure,
 * no allocation.
 * @param {number} code
 * @param {number} a
 * @param {FadeLut} lut
 * @returns {number} a faded ASCII code
 */
export function fadeGlyph(code, a, lut) {
  if (a >= 1) return code; // identity (test rule: a = 1 is the identity)
  const i = code >= 0 && code < 128 ? lut.idx[code] : lut.idx[0];
  let j = Math.round(a * i);
  if (j < 0) j = 0;
  const last = lut.ramp.length - 1;
  if (j > last) j = last;
  return lut.ramp[j];
}

/**
 * Fades every NON-MASK cell of `rt.cells` in place toward black (`a = 0`)
 * or leaves it alone (`a = 1`) - mask cells (`cells.mask[i] === 1`, i.e.
 * cells written by JS this frame: crosshair, prompts, debug text - see
 * engine/render/CellBuffer.js) are skipped entirely, so UI text stays
 * independent of the 3D scene's own fade (7.4). Colors: `fg *= minGain +
 * (1 - minGain) * a`, `bg *= a`. Direct typed-array writes only - no
 * allocation, no per-cell object (rule 9).
 * @param {import('../render/RenderTarget.js').RenderTarget} rt
 * @param {number} a - 1 = off/identity, 0 = fully faded (black, all space).
 * @param {FadeLut} lut
 */
/**
 * Call right before `applySceneFade` on the CPU path (both real gameplay,
 * `?gpu=0`, and the `?gpucompare=1` JS oracle). `cb.mask` doubles as two
 * different signals depending on the path (CellBuffer.js): on the GPU path
 * it means "true UI overlay cell" (crosshair/end-card/debug text - the only
 * things that ever call `setCell`/`setCellRGB` there, since the 3D scene is
 * drawn straight into GL textures and never touches `CellBuffer`), which is
 * exactly what GPU sprite pass F's "fade every non-mask cell" skips
 * (sprites.frag.js). On the CPU path the raycaster/terrain/sky/sprites ALSO
 * draw through `setCellRGB` (that's what running the CPU cast means), so by
 * the time a caller reaches its `applySceneFade` call (always after the 3D
 * scene, always before any UI is drawn) every cell is masked and the fade
 * would be a full no-op (US-017 tester fix pass 2, BUG-1). No real UI has
 * been drawn yet at that point in any caller, so every current cell IS
 * legitimately fade-eligible - clearing the mask here makes the CPU fade
 * skip exactly the same cells the GPU pass does (none, until the caller
 * draws UI afterward).
 * @param {import('../render/RenderTarget.js').RenderTarget} rt
 */
export function clearMaskForSceneFade(rt) {
  rt.cells.mask.fill(0);
}

export function applySceneFade(rt, a, lut) {
  if (a >= 1) return; // identity - nothing to do (also keeps this a true no-op when the story isn't wired up)
  if (a < 0) a = 0;
  const cb = rt.cells;
  const n = cb.cols * cb.rows;
  const mask = cb.mask, gi = cb.glyphIdx, fg = cb.fg, bg = cb.bg;
  const fgGain = lut.minGain + (1 - lut.minGain) * a;
  for (let i = 0; i < n; i++) {
    if (mask[i]) continue;
    const code = fadeGlyph(gi[i] + 32, a, lut);
    const newIdx = code < 32 ? 0 : code - 32;
    gi[i] = newIdx;
    const fi = i * 4;
    // US-017 ARCH CHANGES #1 (found via the ?gpucompare=1 sceneFade=0.5
    // parity pose): CellBuffer duplicates the glyph index into fg[fi+3]
    // (its RGBA8 upload layout, CellBuffer.js's own doc comment) - every
    // OTHER writer (setCell/setCellRGB) keeps both copies in sync, this one
    // must too, or every reader of `cb.fg` (GPU texture upload, the compare
    // tools, `readbackPresent`) sees the un-faded glyph while `cb.glyphIdx`
    // itself is correctly faded.
    fg[fi + 3] = newIdx;
    fg[fi] = (fg[fi] * fgGain) | 0;
    fg[fi + 1] = (fg[fi + 1] * fgGain) | 0;
    fg[fi + 2] = (fg[fi + 2] * fgGain) | 0;
    bg[fi] = (bg[fi] * a) | 0;
    bg[fi + 1] = (bg[fi + 1] * a) | 0;
    bg[fi + 2] = (bg[fi + 2] * a) | 0;
  }
}
