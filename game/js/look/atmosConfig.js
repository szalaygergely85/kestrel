// ENV-03a (arch 38.65 point 3): the designer's picked biome atmospheres (design/look/biomeLook.js) -> engine-facing AtmosTable.
// buildAtmosConfig(biomeLook, biomes) -> { table: { n, recs[n*3] }, biomeToEntry: Int8Array(16), names }.
// recs index = entry * 3 + slot (slot 0 day, 1 dusk, 2 night); fields = AtmosRec of engine/render/atmos.js (fog/haze 0..255 floats, no hex).
// `biomes` = geo.biomes table (id -> { blendM? }); every mapped biome must have blendM >= 20 (missing = 24, the world default). Throws per bad field.

const SLOTS = ['day', 'dusk', 'night'];

function fail(where, msg) { throw new Error('atmos: ' + where + ': ' + msg); }
function num(where, v, lo, hi) { if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) fail(where, 'must be a number in ' + lo + '..' + hi + ', got ' + v); return v; }
function hex(where, h) {
  if (typeof h !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(h)) fail(where, 'bad hex colour ' + JSON.stringify(h));
  return Float32Array.of(parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16));
}
function vec3(where, v, lo, hi) {
  if (!Array.isArray(v) || v.length !== 3) fail(where, 'needs 3 numbers');
  return Float32Array.of(num(where + '[0]', v[0], lo, hi), num(where + '[1]', v[1], lo, hi), num(where + '[2]', v[2], lo, hi));
}

export function buildAtmosConfig(biomeLook, biomes) {
  if (!biomeLook || !Array.isArray(biomeLook.order) || !biomeLook.biomes) fail('data', 'biomeLook has no order/biomes');
  const order = biomeLook.order, recs = [];
  if (order.length > 127) fail('order', 'too many entries');
  order.forEach((name, e) => {
    const b = biomeLook.biomes[name], w = 'entry ' + name;
    if (!b || !b.pick || !b.atmos) fail(w, 'missing biome entry / pick');
    const a = b.atmos[b.pick.atmos];
    if (!a) fail(w, 'pick.atmos ' + b.pick.atmos + ' has no atmos entry');
    const fogDensity = num(w + '.fogDensity', a.fogDensity, 0.0005, 0.05);
    const hazeAmount = num(w + '.hazeAmount', a.hazeAmount, 0, 1);
    for (const slot of SLOTS) {
      const ws = w + '.' + slot, g = a.grade && a.grade[slot];
      if (!g) fail(ws + '.grade', 'missing');
      recs[e * 3 + SLOTS.indexOf(slot)] = {
        fog: hex(ws + '.fog', a.fog && a.fog[slot]), fogDensity,
        haze: hex(ws + '.haze', a.haze && a.haze[slot]), hazeAmount,
        lift: vec3(ws + '.lift', g.lift, 0, 0.1),
        gamma: vec3(ws + '.gamma', g.gamma, 0.01, 4),   // > 0
        gain: vec3(ws + '.gain', g.gain, 0, 4),
        sat: num(ws + '.sat', g.sat, 0, 2)
      };
    }
  });
  const map = biomeLook.atmosMap;
  if (!map || typeof map !== 'object') fail('atmosMap', 'missing');
  const biomeToEntry = new Int8Array(16).fill(-1);
  for (const key of Object.keys(map)) {
    const id = +key, w = 'atmosMap[' + key + ']';
    if (!Number.isInteger(id) || id < 0 || id > 15) fail(w, 'biome id must be an integer 0..15');
    const e = order.indexOf(map[key]);
    if (e < 0) fail(w, 'unknown entry ' + JSON.stringify(map[key]));
    // biome 0 (start meadow) has no geo.biomes row and no own blend zone; every other mapped biome needs a wide enough fade
    if (id !== 0) {
      const row = biomes && biomes[id];
      if (!row) fail(w, 'biome ' + id + ' not in geo.biomes');
      const bm = row.blendM || 24;
      if (bm < 20) fail(w, 'blendM ' + bm + ' < 20 m (hard border would pop)');
    }
    biomeToEntry[id] = e;
  }
  return { table: { n: order.length, recs }, biomeToEntry, names: order.slice() };
}
