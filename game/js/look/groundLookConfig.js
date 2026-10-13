// ENV-02a (arch 38.63 point 3): turns the designer's picked ground looks (design/look/biomeLook.js) into the engine-facing config:
// plain numbers and id arrays only (linear RGB, glyph char codes, look ids, terrain type ids); NO hex strings, no names, no palette keys.
// Pure and deterministic: buildGroundLookConfig(biomeLook, terrainTypes) -> { looks:[...], lookMap:[...] } or throws on a bad field.
// Look id 0 = today's ground (TLOOK path); looks get ids 1.. in biomeLook.order (<= 15, they share a nibble in the bake).
// resolveLook(cfg, groundId, biomeId) -> look id (first matching rule, else 0). The World opt `groundLook` takes this object (ENV-02c).

const MAX_LOOKS = 15, MAX_ACCENTS = 2;

function fail(where, msg) { throw new Error('groundLook: ' + where + ': ' + msg); }
function num(where, v, lo, hi) { if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) fail(where, 'must be a number in ' + lo + '..' + hi + ', got ' + v); return v; }
function glyphCodes(where, s, minLen, maxLen) {
  if (typeof s !== 'string' || s.length < minLen || s.length > maxLen) fail(where, 'glyph string of ' + minLen + '..' + maxLen + ' chars, got ' + JSON.stringify(s));
  const out = [];
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 || c > 126) fail(where, 'non-printable-ASCII glyph at ' + i); out.push(c); }
  return out;
}
function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function rgb(where, hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) fail(where, 'bad hex colour ' + JSON.stringify(hex));
  return [1, 3, 5].map(i => lin(parseInt(hex.substr(i, 2), 16) / 255));
}
function colours(where, list, n) {
  if (!Array.isArray(list) || list.length !== n) fail(where, 'needs exactly ' + n + ' colours');
  return list.map((h, i) => rgb(where + '[' + i + ']', h));
}

export function buildGroundLookConfig(biomeLook, terrainTypes) {
  if (!biomeLook || !Array.isArray(biomeLook.order) || !biomeLook.biomes) fail('data', 'biomeLook has no order/biomes');
  const order = biomeLook.order;
  if (order.length > MAX_LOOKS) fail('order', 'at most ' + MAX_LOOKS + ' looks, got ' + order.length);
  const ids = {};
  const looks = order.map((name, k) => {
    const b = biomeLook.biomes[name], w = 'look ' + name;
    if (!b || !b.pick || !b.ground) fail(w, 'missing biome entry / pick');
    const g = b.ground[b.pick.ground];
    if (!g) fail(w, 'pick.ground ' + b.pick.ground + ' has no ground entry');
    ids[name] = k + 1;
    const glyphs = glyphCodes(w + '.glyphs', g.glyphs, 1, 4);
    const sh = g.shimmer || {};
    const mode = sh.mode === 'lean' ? 1 : sh.mode === 'sheen' ? 0 : fail(w + '.shimmer.mode', 'sheen or lean');
    const lean = mode === 1 ? glyphCodes(w + '.shimmer.lean', sh.lean, glyphs.length, glyphs.length) : glyphs.slice();
    // the engine budget is 2 accents per look: extra designer accents are dropped (design/ is not edited here; glade has 3, '+' is dropped)
    if (g.accents !== undefined && !Array.isArray(g.accents)) fail(w + '.accents', 'must be an array');
    const acc = (g.accents || []).slice(0, MAX_ACCENTS);
    return {
      id: k + 1,
      glyphs, lean,
      ramp: colours(w + '.ramp', g.ramp, 4),
      bg: colours(w + '.bg', g.bg, 2),
      noiseScale: num(w + '.noiseScale', g.noiseScale, 0.1, 200),
      macroScale: num(w + '.macroScale', g.macroScale, 1, 1000),
      contrast: num(w + '.contrast', g.contrast, 0, 1),
      shimmerMode: mode,
      shimmerAmp: num(w + '.shimmer.amp', sh.amp, 0, 1),
      sheen: num(w + '.shimmer.sheen', sh.sheen, 0, 1),
      accents: acc.map((a, i) => ({
        glyph: glyphCodes(w + '.accents[' + i + '].g', a.g, 1, 1)[0],
        color: rgb(w + '.accents[' + i + '].c', a.c),
        density: num(w + '.accents[' + i + '].d', a.d, 0, 1),
        cluster: num(w + '.accents[' + i + '].cluster', a.cluster, 0, 1),
        maxDist: num(w + '.accents[' + i + '].maxDist', a.maxDist, 1, 500)
      }))
    };
  });
  const map = biomeLook.lookMap;
  if (!Array.isArray(map) || !map.length) fail('lookMap', 'missing');
  const lookMap = map.map((r, i) => {
    const w = 'lookMap[' + i + ']';
    if (!r || !(r.look in ids)) fail(w, 'unknown look ' + (r && r.look));
    if (!r.ground && !r.biomes) fail(w, 'needs ground and/or biomes');
    const ground = r.ground ? r.ground.map(n => (n in terrainTypes ? terrainTypes[n] : fail(w + '.ground', 'unknown terrain type ' + n))) : null;
    const biomes = r.biomes ? r.biomes.map(n => (Number.isInteger(n) && n >= 0 && n <= 255 ? n : fail(w + '.biomes', 'bad biome id ' + n))) : null;
    return { look: ids[r.look], ground, biomes };
  });
  return { looks, lookMap };
}

/** First matching rule wins; no match = 0 (today's ground). */
export function resolveLook(cfg, groundId, biomeId) {
  const m = cfg.lookMap;
  for (let i = 0; i < m.length; i++) {
    const r = m[i];
    if ((r.ground === null || r.ground.indexOf(groundId) >= 0) && (r.biomes === null || r.biomes.indexOf(biomeId) >= 0)) return r.look;
  }
  return 0;
}
