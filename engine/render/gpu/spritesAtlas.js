// US-030c (docs/architecture.md 14.2 item 4, build plan "SpriteAtlas.js"):
// pure packer over the registry's billboard models - every frame of every
// animation, full size and `lods.half`, into ONE RGBA8 cell atlas plus a
// palette LUT. No gl here (Node-testable, `sprites.test.js`); the GPU pass
// (`spritesPass.js`) uploads `data` as RGBA8UI and `pal` as RGBA32F, and
// the JS reference (`engine/render/sprites.js`) reads the very same arrays,
// so both paths sample identical texels.
//
// Atlas texel (design/README.md section 4 sprite format):
//   r = glyph code (ASCII - 32; 0 = space)
//   g = colour index into `pal` (the model key's palette colour)
//   b = emissive bit | normalCode << 1   (normal codes: f 0, l 1, r 2, u 3, d 4)
//   a = 0 transparent (space glyph / space fg key) | 1 opaque
//
// Deviation from 14.2 item 4 (flagged for architect review): no "header
// row" with per-frame (x, y, w, h) inside the atlas - the frame rect goes
// into the per-sprite SPR texels instead (`sprites.js`, texel 2), which
// keeps the atlas RGBA8 without a 255-cell limit on atlas coordinates and
// removes one dependent texelFetch per sprite from the shader loop.

export const NORMAL_CODES = { f: 0, l: 1, r: 2, u: 3, d: 4, '.': 0 };
export const ATLAS_MAX_WIDTH = 512;

/**
 * @param {import('../../core/assets.js').AssetRegistry} assets
 * @param {Object} palette - `assets.palette` (needs `.rgb`)
 * @returns {{
 *   width:number, height:number, data:Uint8Array,
 *   pal:Float32Array, palKeys:string[],
 *   frames:{x:number,y:number,w:number,h:number}[],
 *   models:Map<string, {full: LodEntry, half: LodEntry|null, world:{w:number,h:number}}>
 * }}
 * LodEntry = { size:{w,h}, anchor:{x,y}, anims: Map<string, {base:number, count:number}> }
 */
export function buildSpriteAtlas(assets, palette) {
  const rgb = palette.rgb;
  const palKeys = [];
  const palIndex = new Map();
  const frames = [];
  const blocks = []; // { frameIdx, cells: Uint8Array(w*h*4) } in pack order
  const models = new Map();

  function colourIndex(key, where) {
    let idx = palIndex.get(key);
    if (idx == null) {
      if (!rgb[key]) throw new Error(`buildSpriteAtlas: ${where}: unknown palette colour "${key}"`);
      if (palKeys.length >= 255) throw new Error('buildSpriteAtlas: more than 255 distinct sprite colours');
      idx = palKeys.length;
      palKeys.push(key);
      palIndex.set(key, idx);
    }
    return idx;
  }

  function packFrame(modelKey, keys, size, frame, animName, fi) {
    const view = frame.S;
    if (!view) throw new Error(`buildSpriteAtlas: ${modelKey}.${animName}[${fi}] has no "S" view`);
    const w = size.w, h = size.h;
    const cells = new Uint8Array(w * h * 4);
    for (let r = 0; r < h; r++) {
      const gRow = view.glyphs[r] || '', fRow = view.fg[r] || '', nRow = (view.n && view.n[r]) || '';
      for (let c = 0; c < w; c++) {
        const g = c < gRow.length ? gRow.charAt(c) : ' ';
        const k = c < fRow.length ? fRow.charAt(c) : ' ';
        const o = (r * w + c) * 4;
        if (g === ' ' || k === ' ') continue; // transparent (a = 0)
        const def = keys[k];
        if (!def) throw new Error(`buildSpriteAtlas: ${modelKey}.${animName}[${fi}] row ${r} col ${c}: fg key "${k}" not in model keys`);
        const code = g.charCodeAt(0);
        if (code < 32 || code > 126) throw new Error(`buildSpriteAtlas: ${modelKey}.${animName}[${fi}]: non-ASCII glyph`);
        const nCh = c < nRow.length ? nRow.charAt(c) : 'f';
        const nCode = NORMAL_CODES[nCh] ?? 0;
        cells[o] = code - 32;
        cells[o + 1] = colourIndex(def.c, `${modelKey} key "${k}"`);
        cells[o + 2] = (def.e ? 1 : 0) | (nCode << 1);
        // US-016 D-011 addendum (architecture.md 14.4 item 12): per-key
        // emissive fog cap, in the texel alpha - `a = 0` stays transparent,
        // else `a = 1 + round(fogMax*254)` (no `fogMax` -> `a = 1`, today's
        // shape, unchanged). Only meaningful on emissive keys (`sprites.js`/
        // `sprites.frag.js` only decode it when `emissive` is true).
        cells[o + 3] = typeof def.fogMax === 'number' ? 1 + Math.round(Math.max(0, Math.min(1, def.fogMax)) * 254) : 1;
      }
    }
    const frameIdx = frames.length;
    frames.push({ x: 0, y: 0, w, h });
    blocks.push({ frameIdx, w, h, cells });
    return frameIdx;
  }

  function packLod(modelKey, keys, lod) {
    const anims = new Map();
    for (const animName of Object.keys(lod.animations || {})) {
      const anim = lod.animations[animName];
      const list = anim.frames || [];
      let base = -1;
      for (let fi = 0; fi < list.length; fi++) {
        const idx = packFrame(modelKey, keys, lod.size, list[fi], animName, fi);
        if (base < 0) base = idx;
      }
      anims.set(animName, { base, count: list.length });
    }
    return { size: { w: lod.size.w, h: lod.size.h }, anchor: { x: lod.anchor.x, y: lod.anchor.y }, anims };
  }

  for (const key of assets.keys('model')) {
    const m = assets.model(key);
    if (!m || !m.billboard || m.ui) continue; // title/subtitle (ui) are drawn by textDraw, not billboards
    const full = packLod(key, m.keys, m);
    const half = m.lods && m.lods.half ? packLod(key, m.keys, m.lods.half) : null;
    // US-016 (architecture.md 14.4 item 7): `lods.min` - the far_tower.js /
    // ferrum_lights.js style hard-floor tier, picked by PROJECTED ROWS
    // (>= model.detailRows -> full, else min), never by the scale threshold
    // `half` uses. Independent of `half` (a model may have one, the other,
    // both or neither).
    const min = m.lods && m.lods.min ? packLod(key, m.keys, m.lods.min) : null;
    // US-016 (architecture.md 14.4 item 13): a `horizon: true` model
    // (ferrum_lights.js) has no `world.w/h` - it is placed and sized by
    // ANGLE (bearingDeg/elevDeg/angular), never by a metres-based scale, so
    // `sprites.js`'s ordinary `project()` never reads `world` for it.
    models.set(key, { full, half, min, world: m.world ? { w: m.world.w, h: m.world.h } : null, horizon: !!m.horizon });
  }

  // Shelf packing: frames in pack order, left to right, new shelf when the
  // row would exceed ATLAS_MAX_WIDTH. Tiny inputs (a few hundred cells), so
  // simplicity beats tightness.
  let shelfX = 0, shelfY = 0, shelfH = 0, width = 1;
  for (const b of blocks) {
    if (shelfX + b.w > ATLAS_MAX_WIDTH && shelfX > 0) { shelfY += shelfH; shelfX = 0; shelfH = 0; }
    const f = frames[b.frameIdx];
    f.x = shelfX; f.y = shelfY;
    shelfX += b.w;
    if (b.h > shelfH) shelfH = b.h;
    if (shelfX > width) width = shelfX;
  }
  const height = Math.max(1, shelfY + shelfH);
  const data = new Uint8Array(width * height * 4);
  for (const b of blocks) {
    const f = frames[b.frameIdx];
    for (let r = 0; r < b.h; r++) {
      data.set(b.cells.subarray(r * b.w * 4, (r + 1) * b.w * 4), ((f.y + r) * width + f.x) * 4);
    }
  }

  const pal = new Float32Array(Math.max(1, palKeys.length) * 4);
  for (let i = 0; i < palKeys.length; i++) {
    const c = rgb[palKeys[i]];
    pal[i * 4] = c[0]; pal[i * 4 + 1] = c[1]; pal[i * 4 + 2] = c[2]; pal[i * 4 + 3] = 0;
  }

  return { width, height, data, pal, palKeys, frames, models };
}
