// ENV-03a (arch 38.65 point 3): turns the picked biome atmospheres (design/look/biomeLook.js) into engine-facing numbers.
// Pure + deterministic: buildAtmosConfig(biomeLook, biomesTable?) -> { n, names, recs, biomeToEntry, slotOf, defaultTime } or throws.
// recs[e * 3 + slot] (slot 0 day, 1 dusk, 2 night) = { fog F32(3) 0..255, fogDensity, haze F32(3) 0..255, hazeAmount,
// lift F32(3), gamma F32(3), gain F32(3), sat }. No hex strings, no names inside the records.
// biomesTable (optional, geo.biomes): every mapped biome must have blendM >= 20 (missing blendM = engine default 24).

export const ATMOS_SLOTS = ['day', 'dusk', 'night'];
// day-schedule key (P.daySchedule) -> slot; the driver blends the two slots of the current schedule segment
export const ATMOS_SLOT_OF = { morning: 0, noon: 0, dusk: 1, night: 2 };
export const ATMOS_DEFAULT_TIME = 'noon';
export const ATMOS_MAX_BIOME_ID = 15;

function fail(where, msg) { throw new Error('atmosConfig: ' + where + ': ' + msg); }
function num(where, v, lo, hi) { if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) fail(where, 'must be a number in ' + lo + '..' + hi + ', got ' + v); return v; }
function hex(where, h) {
  if (typeof h !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(h)) fail(where, 'bad hex colour ' + JSON.stringify(h));
  return Float32Array.of(parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16));
}
function vec3(where, a, lo, hi) {
  if (!Array.isArray(a) || a.length !== 3) fail(where, 'needs exactly 3 numbers');
  return Float32Array.from(a.map((v, i) => num(where + '[' + i + ']', v, lo, hi)));
}

export function buildAtmosConfig(biomeLook, biomesTable) {
  if (!biomeLook || !biomeLook.biomes || !biomeLook.atmosMap) fail('data', 'biomeLook has no biomes/atmosMap');
  const order = Array.isArray(biomeLook.order) ? biomeLook.order : Object.keys(biomeLook.biomes);
  const used = new Set(Object.values(biomeLook.atmosMap));
  const names = order.filter(k => used.has(k));
  for (const u of used) if (!names.includes(u)) fail('atmosMap', 'unknown biomeLook entry ' + JSON.stringify(u));
  const recs = [];
  names.forEach(name => {
    const b = biomeLook.biomes[name], w = 'atmos ' + name;
    if (!b || !b.pick || !b.atmos) fail(w, 'missing biome entry / pick');
    const a = b.atmos[b.pick.atmos];
    if (!a) fail(w, 'pick.atmos ' + b.pick.atmos + ' has no atmos entry');
    const density = num(w + '.fogDensity', a.fogDensity, 0.0005, 0.05);
    const hazeAmount = num(w + '.hazeAmount', a.hazeAmount, 0, 1);
    for (const key of ['fog', 'haze', 'grade']) if (!a[key]) fail(w + '.' + key, 'missing');
    ATMOS_SLOTS.forEach(slot => {
      const g = a.grade[slot], ws = w + '.' + slot;
      if (!g) fail(ws + '.grade', 'missing slot');
      const gamma = vec3(ws + '.gamma', g.gamma, 0, 4);
      gamma.forEach((v, i) => { if (!(v > 0)) fail(ws + '.gamma[' + i + ']', 'must be > 0'); });
      recs.push({
        fog: hex(ws + '.fog', a.fog[slot]), fogDensity: density,
        haze: hex(ws + '.haze', a.haze[slot]), hazeAmount,
        lift: vec3(ws + '.lift', g.lift, 0, 0.1), gamma,
        gain: vec3(ws + '.gain', g.gain, 0, 4), sat: num(ws + '.sat', g.sat, 0, 2)
      });
    });
  });
  const biomeToEntry = new Int8Array(ATMOS_MAX_BIOME_ID + 1).fill(-1);
  for (const [k, name] of Object.entries(biomeLook.atmosMap)) {
    const id = +k;
    if (!Number.isInteger(id) || id < 0 || id > ATMOS_MAX_BIOME_ID) fail('atmosMap', 'bad biome id ' + k);
    if (biomesTable) {
      const bt = id === 0 ? {} : biomesTable[id];   // id 0 = the start meadow, no table row (engine default blend)
      if (!bt) fail('atmosMap', 'biome id ' + id + ' not in the geo biome table');
      if ((bt.blendM || 24) < 20) fail('atmosMap', 'biome ' + id + ' blendM ' + bt.blendM + ' < 20 m (fade needs >= 20 m)');
    }
    biomeToEntry[id] = names.indexOf(name);
  }
  return { n: names.length, names, recs, biomeToEntry, slotOf: ATMOS_SLOT_OF, defaultTime: ATMOS_DEFAULT_TIME };
}
