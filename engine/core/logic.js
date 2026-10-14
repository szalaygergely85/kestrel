// engine/core/logic.js (ED-LOGIC-01a, docs/architecture.md 38.70).
//
// Game-neutral logic-block interpreter: When -> If -> Do. The game injects the vocabulary
//   vocab = { events: {name: {args}}, conds: {name: {args, test(ctx, a) -> bool}}, acts: {name: {args, run(ctx, a)}} }
// where `args` = {argName: type}; type = 'int'|'bool'|'text'|'ref:<kind>' | 'a|b|c' (enum); a trailing '?' = optional.
// Block data: { id, rev, once?, max?, when:{on, ...args}, if:[{is, ...args}], do:[{act, ...args, after?}] };
// the condition {is:'not', cond:{is, ...}} negates one condition.
//
// Rules: fixed step only (no wall-clock, no random); events raised during a step (logic.push from an
// action) wait for the NEXT step - no recursion; delayed (`after`) actions tick down per step;
// content order everywhere; step() allocates nothing. State is keyed by block id (+ rev) for saves.
// compileLogic / validateLogic may allocate (load time).

export const LOGIC_LIMITS = Object.freeze({ blocks: 128, conds: 8, acts: 8, afterMax: 3600 });
const BLOCK_KEYS = ['id', 'rev', 'name', 'once', 'max', 'when', 'if', 'do', 'ui'];

function typeErr(spec, v, refs) {
  const opt = spec.endsWith('?');
  const t = opt ? spec.slice(0, -1) : spec;
  if (v === undefined || v === null) return opt ? null : 'is missing';
  if (t === 'int') return Number.isInteger(v) ? null : 'must be a whole number';
  if (t === 'bool') return typeof v === 'boolean' ? null : 'must be true or false';
  if (t === 'text') return typeof v === 'string' ? null : 'must be text';
  if (t.includes('|')) return t.split('|').includes(v) ? null : `must be one of: ${t.split('|').join(', ')}`;
  if (t.startsWith('ref:')) {
    if (typeof v !== 'string' || !v) return 'must be a name';
    const set = refs && refs[t.slice(4)];
    if (set && !(set.has ? set.has(v) : set.includes(v))) return `refers to "${v}" which does not exist`;
    return null;
  }
  return `has unknown type "${t}" in the vocabulary`;
}

function checkArgs(out, where, item, specArgs, skip, refs) {
  for (const n of Object.keys(specArgs || {})) { const e = typeErr(specArgs[n], item[n], refs); if (e) out.push(`${where}: "${n}" ${e}.`); }
  for (const k of Object.keys(item)) if (!skip.includes(k) && !(specArgs && k in specArgs)) out.push(`${where}: unknown field "${k}".`);
}

function checkCond(out, where, c, vocab, refs, inNot) {
  if (!c || typeof c !== 'object') { out.push(`${where}: must be an object.`); return; }
  if (c.is === 'not') {
    if (inNot) { out.push(`${where}: "not" cannot be nested.`); return; }
    checkCond(out, `${where} (not)`, c.cond, vocab, refs, true);
    for (const k of Object.keys(c)) if (k !== 'is' && k !== 'cond') out.push(`${where}: unknown field "${k}".`);
    return;
  }
  const spec = vocab.conds && vocab.conds[c.is];
  if (!spec) { out.push(`${where}: unknown condition "${c.is}".`); return; }
  checkArgs(out, `${where} "${c.is}"`, c, spec.args, ['is'], refs);
}

/** Pure schema check. Returns plain-text error strings ([] = valid). refs = {kind: Set|Array} enables ref existence. */
export function validateLogic(blocks, vocab, refs, limits) {
  const L = { ...LOGIC_LIMITS, ...(limits || {}) };
  const out = [];
  if (!Array.isArray(blocks)) return ['A logic file must be a list of blocks.'];
  if (blocks.length > L.blocks) out.push(`Too many blocks: ${blocks.length} (at most ${L.blocks} per area).`);
  const seen = new Set();
  blocks.forEach((b, i) => {
    if (!b || typeof b !== 'object') { out.push(`Block ${i + 1}: must be an object.`); return; }
    const w = `Block "${b.id ?? '#' + (i + 1)}"`;
    if (typeof b.id !== 'string' || !b.id) out.push(`Block ${i + 1}: needs an id.`);
    else if (seen.has(b.id)) out.push(`${w}: id is used twice.`);
    else seen.add(b.id);
    if (!Number.isInteger(b.rev) || b.rev < 1) out.push(`${w}: "rev" must be a whole number of 1 or more.`);
    if (b.once !== undefined && typeof b.once !== 'boolean') out.push(`${w}: "once" must be true or false.`);
    if (b.max !== undefined && (!Number.isInteger(b.max) || b.max < 1)) out.push(`${w}: "max" must be a whole number of 1 or more.`);
    for (const k of Object.keys(b)) if (!BLOCK_KEYS.includes(k)) out.push(`${w}: unknown field "${k}".`);
    const wh = b.when;
    if (!wh || typeof wh !== 'object') out.push(`${w}: needs a "when".`);
    else {
      const spec = vocab.events && vocab.events[wh.on];
      if (!spec) out.push(`${w}: unknown event "${wh.on}".`);
      else checkArgs(out, `${w} when "${wh.on}"`, wh, spec.args, ['on'], refs);
    }
    if (b.if !== undefined) {
      if (!Array.isArray(b.if)) out.push(`${w}: "if" must be a list.`);
      else {
        if (b.if.length > L.conds) out.push(`${w}: too many conditions (${b.if.length}, at most ${L.conds}).`);
        b.if.forEach((c, j) => checkCond(out, `${w} condition ${j + 1}`, c, vocab, refs, false));
      }
    }
    if (!Array.isArray(b.do) || b.do.length === 0) out.push(`${w}: needs at least one action in "do".`);
    else {
      if (b.do.length > L.acts) out.push(`${w}: too many actions (${b.do.length}, at most ${L.acts}).`);
      b.do.forEach((a, j) => {
        const ww = `${w} action ${j + 1}`;
        if (!a || typeof a !== 'object') { out.push(`${ww}: must be an object.`); return; }
        const spec = vocab.acts && vocab.acts[a.act];
        if (!spec) { out.push(`${ww}: unknown action "${a.act}".`); return; }
        checkArgs(out, `${ww} "${a.act}"`, a, spec.args, ['act', 'after'], refs);
        if (a.after !== undefined && (!Number.isInteger(a.after) || a.after < 0 || a.after > L.afterMax)) out.push(`${ww}: "after" must be a whole number from 0 to ${L.afterMax}.`);
      });
    }
  });
  return out;
}

/** Load-time compile (may allocate). Throws Error(plain text) when the data is invalid. */
export function compileLogic(blocks, vocab, opts = {}) {
  const errs = validateLogic(blocks, vocab, opts.refs, opts.limits);
  if (errs.length) throw new Error('Logic blocks are invalid:\n' + errs.join('\n'));
  const kindNames = Object.keys(vocab.events);
  const kindOf = new Map(kindNames.map((n, i) => [n, i]));
  const argIds = new Map();
  const argId = (name, value) => { const k = name + '\u0000' + value; let v = argIds.get(k); if (v === undefined) { v = argIds.size + 1; argIds.set(k, v); } return v; };
  const compiled = blocks.map((b) => {
    const spec = vocab.events[b.when.on];
    let key = -1; // -1 = wildcard (no key arg given)
    for (const n of Object.keys(spec.args || {})) if (b.when[n] !== undefined) { key = argId(n, b.when[n]); break; }
    return {
      id: b.id, rev: b.rev, max: b.once ? 1 : (b.max || 0), kind: kindOf.get(b.when.on), key,
      conds: (b.if || []).map((c) => (c.is === 'not'
        ? { test: vocab.conds[c.cond.is].test, a: c.cond, neg: true }
        : { test: vocab.conds[c.is].test, a: c, neg: false })),
      acts: b.do.map((a) => ({ run: vocab.acts[a.act].run, a, after: a.after | 0 })),
    };
  });
  const byKind = kindNames.map((_, k) => Int32Array.from(compiled.flatMap((c, i) => (c.kind === k ? [i] : []))));
  const idIndex = new Map(compiled.map((c, i) => [c.id, i]));
  return {
    blocks: compiled, byKind, idIndex, kindNames,
    kindId: (name) => (kindOf.has(name) ? kindOf.get(name) : -1),
    /** argId of an event argument value; 0 = not used by any block (matches wildcards only). */
    argId: (name, value) => argIds.get(name + '\u0000' + value) || 0,
  };
}

/** Runtime. ctx is passed untouched to vocab test()/run(); actions raise events through logic.push. */
export function createLogic(program, { maxPerStep = 32, ring = 64, pending = 32, warn = (m) => console.warn(m) } = {}) {
  const nb = program.blocks.length;
  const fired = new Int32Array(nb);
  const evK = new Int32Array(ring), evA = new Int32Array(ring);
  let head = 0, count = 0, resume = 0, tick = 0, used = 0;
  const pB = new Int32Array(pending), pA = new Int32Array(pending), pL = new Int32Array(pending);
  let pCount = 0;
  let warnedRing = false, warnedPending = false;
  const stats = { droppedEvents: 0, droppedPending: 0, stepActions: 0, deferred: 0 };
  const extra = {}; // opaque game-owned section (saved under `g`)

  /** Queue an event (kind from program.kindId, arg from program.argId). Handled on the next step. */
  function push(kindId, argId = 0) {
    if (kindId < 0) return false;
    if (count >= ring) {
      stats.droppedEvents++;
      if (!warnedRing) { warnedRing = true; warn(`logic: event queue full (${ring}); dropping new events.`); }
      return false;
    }
    const t = (head + count) % ring;
    evK[t] = kindId; evA[t] = argId; count++;
    return true;
  }

  function runAct(ctx, bi, ai) { const act = program.blocks[bi].acts[ai]; act.run(ctx, act.a); used++; }

  function fire(ctx, bi, b) {
    fired[bi]++;
    for (let ai = 0; ai < b.acts.length; ai++) {
      if (b.acts[ai].after > 0) {
        if (pCount >= pending) {
          stats.droppedPending++;
          if (!warnedPending) { warnedPending = true; warn(`logic: delayed-action table full (${pending}); dropping.`); }
        } else { pB[pCount] = bi; pA[pCount] = ai; pL[pCount] = b.acts[ai].after; pCount++; }
      } else runAct(ctx, bi, ai);
    }
  }

  function condsOk(ctx, b) {
    for (let i = 0; i < b.conds.length; i++) { const c = b.conds[i]; if (!!c.test(ctx, c.a) === c.neg) return false; }
    return true;
  }

  /** One fixed step. Returns the number of actions run. */
  function step(ctx) {
    tick++; used = 0;
    // 1) delayed actions: count down, run the due ones in insertion order (compacting in place)
    let w = 0;
    const n0 = pCount;
    for (let i = 0; i < n0; i++) {
      if (pL[i] > 0) pL[i]--;
      if (pL[i] === 0 && used < maxPerStep) runAct(ctx, pB[i], pA[i]);
      else { pB[w] = pB[i]; pA[w] = pA[i]; pL[w] = pL[i]; w++; }
    }
    // entries parked by actions that ran above were appended after n0: keep them
    for (let i = n0; i < pCount; i++) { pB[w] = pB[i]; pA[w] = pA[i]; pL[w] = pL[i]; w++; }
    pCount = w;
    // 2) events present at step start (later pushes wait for the next step)
    let todo = count;
    while (todo > 0) {
      const a = evA[head];
      const list = program.byKind[evK[head]];
      let j = resume, deferred = false;
      for (; j < list.length; j++) {
        const bi = list[j], b = program.blocks[bi];
        if (b.key !== -1 && b.key !== a) continue;
        if (b.max > 0 && fired[bi] >= b.max) continue;
        if (!condsOk(ctx, b)) continue;
        if (used > 0 && used + b.acts.length > maxPerStep) { deferred = true; break; }
        fire(ctx, bi, b);
      }
      if (deferred) { resume = j; stats.deferred++; break; }
      resume = 0; head = (head + 1) % ring; count--; todo--;
    }
    stats.stepActions = used;
    return used;
  }

  function save() {
    const b = {};
    for (let i = 0; i < nb; i++) b[program.blocks[i].id] = { n: fired[i], rev: program.blocks[i].rev };
    const p = [];
    for (let i = 0; i < pCount; i++) p.push([program.blocks[pB[i]].id, pA[i], pL[i]]);
    const e = []; // queued events: [kindName, argId] (argIds are stable for unchanged content)
    for (let i = 0; i < count; i++) { const t = (head + i) % ring; e.push([program.kindNames[evK[t]], evA[t]]); }
    return { v: 1, b, p, e, g: JSON.parse(JSON.stringify(extra)) };
  }

  function load(obj) {
    fired.fill(0); pCount = 0; head = 0; count = 0; resume = 0;
    for (const k of Object.keys(extra)) delete extra[k];
    if (!obj || obj.v !== 1) return; // no/foreign save -> fresh
    for (const id of Object.keys(obj.b || {})) {
      const bi = program.idIndex.get(id);
      if (bi === undefined) continue; // unknown block id -> dropped
      const s = obj.b[id];
      fired[bi] = s.rev === program.blocks[bi].rev ? (s.n | 0) : 0; // rev change -> fire count reset
    }
    for (const row of obj.p || []) {
      const bi = program.idIndex.get(row[0]);
      if (bi === undefined || row[1] >= program.blocks[bi].acts.length || pCount >= pending) continue;
      pB[pCount] = bi; pA[pCount] = row[1]; pL[pCount] = row[2]; pCount++;
    }
    for (const row of obj.e || []) { const k = program.kindId(row[0]); if (k >= 0) push(k, row[1] | 0); }
    Object.assign(extra, JSON.parse(JSON.stringify(obj.g || {})));
  }

  /** h = engine/core/hash.js hasher. Mixes tick, fire counts, event queue and delayed-action table. */
  function hashInto(h) {
    h.u32(count); h.u32(pCount);
    for (let i = 0; i < nb; i++) h.u32(fired[i]);
    for (let i = 0; i < count; i++) { const t = (head + i) % ring; h.u32(evK[t]); h.u32(evA[t]); }
    for (let i = 0; i < pCount; i++) { h.u32(pB[i]); h.u32(pA[i]); h.u32(pL[i]); }
  }

  return { push, step, save, load, hashInto, stats, groups: extra, fireCount: (id) => fired[program.idIndex.get(id)] | 0, get pending() { return pCount; }, get queued() { return count; } };
}
