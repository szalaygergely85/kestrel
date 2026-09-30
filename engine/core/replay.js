// @ts-check
// engine/core/replay.js (RE-14, docs/architecture.md 28.5).
//
// JSON Lines (UTF-8, extension `.kreplay.jsonl`) recorder/player for a
// deterministic command-queue sim:
//
//   {"kind":"kestrel-replay","v":1,"content":<n>,"world":"<name>","seed":<u32>,"step":60,"inputDelay":1,"players":[0,1],"start":<WorldState|null>}
//   {"t":120,"p":0,"s":3,"c":16,"u":[4,5,9],"a":[12500,-3000,-1]}   one line per executed command, in execute order
//   {"t":120,"h":"9f3a0c1d"}                                        checkpoint every 60 ticks (hash after tick t ran, 0-indexed; tick % checkpointEvery === 0)
//   {"end":600,"h":"..."}
//
// `createRecorder` needs each executed record's fields *before* commands.js
// frees them at the end of `execute()`. Rather than changing the "loop
// integration" call shape from 28.5 (`q.execute(applyCommand)` stays exactly
// as written at the call site), the recorder wraps `q.execute` once at
// construction time: the wrapper runs the real execute, capturing each
// record's fields into a reused scratch array as `handler` is invoked for
// it, then `afterTick(tick)` flushes that tick's captured lines (and a
// checkpoint line, every `checkpointEvery` ticks). A tick with no commands
// and no checkpoint appends nothing and allocates nothing.

const CHECKPOINT_EVERY = 60;

function toHex(h) {
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {import('./commands.js').createCommandQueue extends (...a:any)=>infer R ? R : never} q
 * @param {() => number} hashFn - returns the current sim state hash (u32);
 *   called by the recorder right after a tick's systems have run.
 * @param {object} [header] - the replay header fields (kind/v/content/world/
 *   seed/step/inputDelay/players/start); if omitted, call `writeHeader` once
 *   before the first `afterTick`.
 * @param {{checkpointEvery?:number}} [opts]
 */
export function createRecorder(q, hashFn, header, opts = {}) {
  const checkpointEvery = opts.checkpointEvery ?? CHECKPOINT_EVERY;
  const lines = [];
  // Fields captured per executed record this tick, flushed by afterTick.
  // Plain arrays (not objects) reused across ticks - grown lazily, never
  // shrunk, indexed positionally; cleared by resetting `pendingCount` rather
  // than reallocating.
  let pendingCount = 0;
  const pT = [], pP = [], pS = [], pC = [], pU = [], pA0 = [], pA1 = [], pA2 = [];

  // The wrapper passed to `origExecute` must be created ONCE (here, at
  // recorder-construction time), not per tick - a fresh arrow function on
  // every `q.execute` call would allocate every tick, against the zero-
  // alloc-per-tick contract. The "current handler" (the real per-tick
  // handler passed into our `q.execute` override) lives in this closure
  // variable, which the one hoisted wrapper reads and calls.
  let currentHandler = null;
  function recordingHandler(qq, rec) {
    const n = qq.nIds(rec);
    const idsCopy = new Array(n);
    for (let k = 0; k < n; k++) idsCopy[k] = qq.idAt(rec, k);
    const i = pendingCount++;
    pT[i] = qq.recTick(rec);
    pP[i] = qq.player(rec);
    pS[i] = qq.seq(rec);
    pC[i] = qq.type(rec);
    pU[i] = idsCopy;
    pA0[i] = qq.a0(rec);
    pA1[i] = qq.a1(rec);
    pA2[i] = qq.a2(rec);
    currentHandler(qq, rec);
  }

  const origExecute = q.execute.bind(q);
  q.execute = function execute(handler) {
    currentHandler = handler;
    origExecute(recordingHandler);
  };

  const recorder = {};

  recorder.writeHeader = function writeHeader(h) {
    lines.push(JSON.stringify({ kind: 'kestrel-replay', v: 1, ...h }));
  };
  if (header) recorder.writeHeader(header);

  /** Call once per executed tick (`recorder.afterTick(q.tick - 1)` per the
   * loop-integration order), after that tick's systems have run and
   * `hashFn()` reflects post-tick state. Flushes this tick's command lines,
   * then a checkpoint line every `checkpointEvery` ticks. */
  recorder.afterTick = function afterTick(tick) {
    for (let i = 0; i < pendingCount; i++) {
      const line = { t: pT[i], p: pP[i], s: pS[i], c: pC[i], u: pU[i], a: [pA0[i], pA1[i], pA2[i]] };
      lines.push(JSON.stringify(line));
    }
    pendingCount = 0;
    // 28.5's worked example shows a checkpoint at the same "t" as a command
    // line (`{"t":120,...}`), both on the raw 0-indexed engine-tick scale
    // `recTick`/`afterTick` already use - so the gate is on `tick` itself,
    // not `tick + 1`.
    if (tick % checkpointEvery === 0) {
      lines.push(JSON.stringify({ t: tick, h: toHex(hashFn()) }));
    }
  };

  /** Appends the final `{"end":tick,"h":...}` line. */
  recorder.end = function end(tick) {
    lines.push(JSON.stringify({ end: tick, h: toHex(hashFn()) }));
  };

  /** @returns {string} the full JSONL text, one line per record + trailing newline. */
  recorder.text = function text() {
    return lines.map((l) => l + '\n').join('');
  };

  return recorder;
}

/**
 * Parses a recorded JSONL replay once (allocation allowed here - this runs
 * at load, not per tick).
 * @param {string} text
 */
export function createPlayer(text) {
  const rawLines = text.split('\n').filter((l) => l.length > 0);
  const parsed = rawLines.map((l) => JSON.parse(l));
  if (parsed.length === 0 || parsed[0].kind !== 'kestrel-replay') {
    throw new Error('replay: missing/invalid header line');
  }
  const header = parsed[0];
  const cmdLines = [];
  const checkpoints = [];
  let endLine = null;
  for (let i = 1; i < parsed.length; i++) {
    const l = parsed[i];
    if ('end' in l) { endLine = l; continue; }
    if ('c' in l) { cmdLines.push(l); continue; }
    if ('h' in l) { checkpoints.push(l); continue; }
  }

  const player = { header, divergedAt: -1 };
  let cmdCursor = 0;
  let ckCursor = 0;

  /** Inserts every recorded command whose tick === q.tick (recorded ticks
   * are execution ticks, so this always inserts at exactly q.tick - never
   * ahead of it). Call once per tick, before `q.execute`. */
  player.beforeTick = function beforeTick(q) {
    while (cmdCursor < cmdLines.length && cmdLines[cmdCursor].t === q.tick) {
      const l = cmdLines[cmdCursor];
      const ids = new Int32Array(l.u);
      q.insert(l.t, l.p, l.s, l.c, ids, ids.length, l.a[0], l.a[1], l.a[2]);
      cmdCursor++;
    }
  };

  /** Compares `hash` (u32) against the recorded checkpoint for `tick`, if
   * any (checkpoints are recorded in increasing tick order, so a simple
   * cursor is enough - no lookup structure needed). On a mismatch, sets
   * `divergedAt = tick` and returns false; ticks with no checkpoint recorded
   * return true (nothing to check). Also checks the final `end` line the
   * same way when `tick` matches it. */
  player.check = function check(tick, hash) {
    if (player.divergedAt !== -1) return false;
    if (ckCursor < checkpoints.length && checkpoints[ckCursor].t === tick) {
      const expected = checkpoints[ckCursor].h;
      ckCursor++;
      if (toHex(hash) !== expected) {
        player.divergedAt = tick;
        return false;
      }
    }
    if (endLine && endLine.end === tick) {
      if (toHex(hash) !== endLine.h) {
        player.divergedAt = tick;
        return false;
      }
    }
    return true;
  };

  return player;
}
