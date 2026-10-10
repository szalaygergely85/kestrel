// engine/fauna/faunaDef.js - WILD-03 (docs/architecture.md 38.31 item 2).
// compileFaunaDef(wildlifeFx, models, opts) validates the designer data (ASSETS.wildlifeFx) once at load and returns
// a flat, runtime-ready def. The engine never reads window.ASSETS: the game passes the data in.
// `models` resolves a model name to its prepared voxel model ({ clipIndex: {clipName: idx} }); it is either a
// function (name) => pm or an object { name: pm } (the pool/registry the game already holds).
// Errors name the species and the key; they happen at load, never at runtime.

export const STATE_NAMES = ['idle', 'graze', 'move', 'flee', 'alert']; // fallback when the data has no `states`
export const HAB_MEADOW = 1, HAB_EDGE = 2, HAB_FOREST = 4;
const HAB_BITS = { meadow: HAB_MEADOW, edge: HAB_EDGE, forest: HAB_FOREST };

/** Per-species-name defaults of the `spawn` block (38.31 item 2). Unknown names fall back to GENERIC. */
const GENERIC = { spawnMaxM: 80, drawM: 40, cap: 6, kind: 'ground' };
const NAME_DEFAULTS = {
  rabbit: { spawnMaxM: 60, drawM: 35, cap: 10, kind: 'ground' },
  deer: { spawnMaxM: 120, drawM: 90, cap: 8, kind: 'ground' },
  fox: { spawnMaxM: 80, drawM: 60, cap: 2, kind: 'ground' },
  squirrel: { spawnMaxM: 60, drawM: 25, cap: 6, kind: 'climber' },
  bird: { spawnMaxM: 70, drawM: 30, cap: 16, kind: 'flyer' },
};
const KINDS = ['ground', 'climber', 'flyer'];
const KNOWN_KEYS = new Set(['models', 'clipFor', 'enter', 'once', 'extra', 'gaits', 'speeds', 'dist', 'times', 'flee',
  'blendMs', 'groupSize', 'buckChance', 'habitat', 'note', 'spawn', 'bodyR', 'trunkR', 'perchByModel']);
const KNOWN_SPAWN_KEYS = new Set(['habitats', 'cellChance', 'spawnMinM', 'spawnMaxM', 'despawnM', 'drawM', 'cap', 'kind']);
const warned = new Set();

function warnOnce(msg, warn) {
  if (warned.has(msg)) return;
  warned.add(msg);
  (warn || console.warn)(msg);
}

function fail(sp, key, why) { throw new Error(`faunaDef: species "${sp}" ${key}: ${why}`); }

function num(sp, key, v, dflt) {
  if (v === undefined) return dflt;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(sp, key, `expected a finite number, got ${v}`);
  return v;
}

function pair(sp, key, v, dflt) {
  if (v === undefined) return dflt;
  if (!Array.isArray(v) || v.length !== 2 || !(v[0] <= v[1])) fail(sp, key, `expected [min, max] with min <= max, got ${JSON.stringify(v)}`);
  return [v[0], v[1]];
}

function lookupModel(models, name) {
  if (typeof models === 'function') return models(name);
  return models ? models[name] : undefined;
}

/**
 * @param {object} wildlifeFx  ASSETS.wildlifeFx ({ states, animals })
 * @param {Function|Object} models  name -> pm ({ clipIndex })
 * @param {{ warn?: Function }} [opts]
 */
export function compileFaunaDef(wildlifeFx, models, opts) {
  const warn = opts && opts.warn;
  if (!wildlifeFx || !wildlifeFx.animals) throw new Error('faunaDef: wildlifeFx.animals missing');
  const states = wildlifeFx.states || STATE_NAMES;
  const species = [];
  const names = Object.keys(wildlifeFx.animals);
  for (let k = 0; k < names.length; k++) {
    const name = names[k];
    const a = wildlifeFx.animals[name];
    for (const key of Object.keys(a)) if (!KNOWN_KEYS.has(key)) warnOnce(`faunaDef: species "${name}": unknown key "${key}"`, warn);
    if (!Array.isArray(a.models) || a.models.length === 0) fail(name, 'models', 'needs at least one model name');

    // --- clips: every referenced clip name must exist on every model, with the same index ---
    const needed = [];
    const add = (c) => { if (typeof c === 'string' && !needed.includes(c)) needed.push(c); };
    for (const st of Object.keys(a.clipFor || {})) add(a.clipFor[st]);
    for (const st of Object.keys(a.enter || {})) add(a.enter[st]);
    for (const c of Object.keys(a.once || {})) { add(c); add(a.once[c]); }
    for (const c of Object.keys(a.extra || {})) add(a.extra[c]);
    for (const g of (a.gaits || [])) add(g.clip);
    const clips = {};
    for (let m = 0; m < a.models.length; m++) {
      const pm = lookupModel(models, a.models[m]);
      if (!pm || !pm.clipIndex) fail(name, `models[${m}]`, `model "${a.models[m]}" not found (or has no clipIndex)`);
      for (const c of needed) {
        const idx = pm.clipIndex[c];
        if (idx === undefined) fail(name, `clip "${c}"`, `missing on model "${a.models[m]}"`);
        if (m === 0) clips[c] = idx;
        else if (clips[c] !== idx) fail(name, `clip "${c}"`, `index ${idx} on model "${a.models[m]}" differs from ${clips[c]} on "${a.models[0]}"`);
      }
    }
    const clipFor = {};
    for (const st of Object.keys(a.clipFor || {})) clipFor[st] = clips[a.clipFor[st]];
    const enter = {};
    for (const st of Object.keys(a.enter || {})) enter[st] = clips[a.enter[st]];
    const extra = {};
    for (const c of Object.keys(a.extra || {})) extra[c] = clips[a.extra[c]];
    const once = {}; // clip index -> next clip index
    for (const c of Object.keys(a.once || {})) once[clips[c]] = clips[a.once[c]];

    // --- gaits ---
    const gaits = (a.gaits || []).map((g, i) => {
      if (!(g.tunedMps > 0)) fail(name, `gaits[${i}].tunedMps`, 'must be > 0');
      if (!(g.minMps <= g.maxMps)) fail(name, `gaits[${i}]`, 'minMps must be <= maxMps');
      if (!Array.isArray(g.rate) || !(g.rate[0] > 0) || !(g.rate[0] <= g.rate[1])) fail(name, `gaits[${i}].rate`, 'needs [lo, hi] with 0 < lo <= hi');
      return { clip: clips[g.clip], name: g.clip, tunedMps: g.tunedMps, minMps: g.minMps, maxMps: g.maxMps, rate: [g.rate[0], g.rate[1]] };
    });
    const sorted = gaits.slice().sort((p, q) => p.minMps - q.minMps);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].minMps > sorted[i - 1].maxMps) fail(name, 'gaits', `speed ranges of "${sorted[i - 1].name}" and "${sorted[i].name}" leave a gap (${sorted[i - 1].maxMps} .. ${sorted[i].minMps})`);
    }

    // --- distances: flee < alert < notice < safe, fleeIfRunning >= flee ---
    const d = a.dist;
    if (!d) fail(name, 'dist', 'missing');
    for (const key of ['flee', 'alert', 'notice', 'safe']) num(name, `dist.${key}`, d[key]);
    if (!(d.flee < d.alert && d.alert < d.notice && d.notice < d.safe)) fail(name, 'dist', `needs flee < alert < notice < safe, got ${d.flee}, ${d.alert}, ${d.notice}, ${d.safe}`);
    const fleeIfRunning = num(name, 'dist.fleeIfRunning', d.fleeIfRunning, d.flee);
    if (fleeIfRunning < d.flee) fail(name, 'dist.fleeIfRunning', `must be >= dist.flee (${d.flee}), got ${fleeIfRunning}`);

    // --- spawn block ---
    const sp = a.spawn || {};
    for (const key of Object.keys(sp)) if (!KNOWN_SPAWN_KEYS.has(key)) warnOnce(`faunaDef: species "${name}": unknown spawn key "${key}"`, warn);
    const dflt = NAME_DEFAULTS[name] || GENERIC;
    const habitats = sp.habitats === undefined ? ['meadow', 'edge'] : sp.habitats;
    if (!Array.isArray(habitats) || habitats.length === 0) fail(name, 'spawn.habitats', 'needs a non-empty array of meadow|edge|forest');
    let mask = 0;
    for (const h of habitats) {
      if (!HAB_BITS[h]) fail(name, 'spawn.habitats', `unknown habitat "${h}"`);
      mask |= HAB_BITS[h];
    }
    const cellChance = num(name, 'spawn.cellChance', sp.cellChance, 0.35);
    if (cellChance < 0 || cellChance > 1) fail(name, 'spawn.cellChance', `must be in 0..1, got ${cellChance}`);
    const spawnMinM = num(name, 'spawn.spawnMinM', sp.spawnMinM, 35);
    const spawnMaxM = num(name, 'spawn.spawnMaxM', sp.spawnMaxM, dflt.spawnMaxM);
    if (!(spawnMinM < spawnMaxM)) fail(name, 'spawn', `spawnMinM (${spawnMinM}) must be < spawnMaxM (${spawnMaxM})`);
    const despawnM = num(name, 'spawn.despawnM', sp.despawnM, spawnMaxM * 1.25);
    if (!(despawnM > spawnMaxM)) fail(name, 'spawn.despawnM', `must be > spawnMaxM (${spawnMaxM}), got ${despawnM}`);
    const drawM = num(name, 'spawn.drawM', sp.drawM, dflt.drawM);
    const cap = num(name, 'spawn.cap', sp.cap, dflt.cap);
    if (!(cap >= 1) || cap !== Math.floor(cap)) fail(name, 'spawn.cap', `must be an integer >= 1, got ${cap}`);
    const kind = sp.kind === undefined ? dflt.kind : sp.kind;
    if (!KINDS.includes(kind)) fail(name, 'spawn.kind', `must be one of ${KINDS.join('|')}, got "${kind}"`);
    const gs = pair(name, 'groupSize', a.groupSize, [1, 1]);
    if (gs[0] < 1 || gs[0] !== Math.floor(gs[0]) || gs[1] !== Math.floor(gs[1])) fail(name, 'groupSize', 'needs integers >= 1');

    species.push({
      index: k, name, kind, models: a.models.slice(), states, clipFor, enter, extra, once, gaits,
      speeds: a.speeds || {}, dist: { notice: d.notice, alert: d.alert, flee: d.flee, fleeIfRunning, safe: d.safe },
      times: a.times || {}, flee: a.flee || {}, blendMs: num(name, 'blendMs', a.blendMs, 120),
      groupSize: gs, buckChance: num(name, 'buckChance', a.buckChance, 0), bodyR: num(name, 'bodyR', a.bodyR, 0.4),
      habitatMask: mask, cellChance, spawnMinM, spawnMaxM, despawnM, drawM, cap,
      hideOrDespawn: !!(a.flee && a.flee.hideOrDespawn),
    });
  }
  return { version: wildlifeFx.version || 1, states, species };
}
