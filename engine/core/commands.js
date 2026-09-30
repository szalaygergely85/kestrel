// @ts-check
// engine/core/commands.js (RE-14, docs/architecture.md 28.5).
//
// Deterministic command queue: the only sim input. Two preallocated rings -
// fixed-size records (stride 8 Int32 words + a parallel Int32 `a2` array)
// and a circular Int32 `ids` buffer for variable-length id lists (e.g. a
// multi-select of unit ids). Commands carry ticks, not wall time, so the
// loop dropping catch-up steps can never desync anything (28.5 "Loop
// integration"). Payloads are integers only - world x/y go in as
// millimetres (`Math.round(x*1000)`), never floats - so replays and (later)
// network traffic are bit-exact.
//
// Record fields (index*RECORD_STRIDE + offset): tick, player, seq, type,
// nIds, idOff, a0, a1. `a2` lives in its own parallel Int32Array (9th word
// would waste alignment for no benefit - the spec calls this out
// explicitly). Types 0-15 are engine-reserved (0 = NOP); game types start
// at 16 - the engine never interprets game types.
//
// Records are allocated from a free-list stack (O(1) alloc/free, zero
// allocation after construction). The id ring is a bump cursor with
// wraparound indexing (`(idOff + k) % maxIds`) plus a "live word count"
// overflow guard: correct under the normal FIFO-ish usage pattern this
// engine has (commands are issued a small, bounded number of ticks ahead via
// `inputDelay` and freed the tick they execute) - it is not a general
// out-of-order allocator. A pathological caller that inserts far-future
// commands and frees them wildly out of allocation order could in principle
// alias live id data before the live-word guard catches it; this is a known,
// documented simplification (RE-14 scope), not something the normal
// issue -> execute cadence can trigger.

const RECORD_STRIDE = 8; // tick, player, seq, type, nIds, idOff, a0, a1
const OFF_TICK = 0, OFF_PLAYER = 1, OFF_SEQ = 2, OFF_TYPE = 3;
const OFF_NIDS = 4, OFF_IDOFF = 5, OFF_A0 = 6, OFF_A1 = 7;

/**
 * @param {{maxRecords?:number, maxIds?:number, inputDelay?:number}} [opts]
 */
export function createCommandQueue(opts = {}) {
  const maxRecords = opts.maxRecords ?? 4096;
  const maxIds = opts.maxIds ?? 65536;
  const inputDelay = opts.inputDelay ?? 1;

  const records = new Int32Array(maxRecords * RECORD_STRIDE);
  const a2Arr = new Int32Array(maxRecords);
  const used = new Uint8Array(maxRecords);
  const ids = new Int32Array(maxIds);

  // Free-list stack of record slot indices; freeTop is the number of valid
  // entries in freeStack[0..freeTop). Popped/pushed in O(1), no allocation.
  const freeStack = new Int32Array(maxRecords);
  for (let i = 0; i < maxRecords; i++) freeStack[i] = i;
  let freeTop = maxRecords;

  // Scratch index array for execute()'s insertion sort - reused every call.
  const scratch = new Int32Array(maxRecords);

  // Per-player seq counters. Plain growable array (not a Map/Set - 28.2's
  // "no Map/Set/object-key iteration in the sim" rule), indexed by player
  // id; only grows the first time a given player id is seen.
  let seq = [];

  let idCursor = 0;
  let liveIdWords = 0;

  const q = { tick: 0, inputDelay, maxRecords, maxIds, ids };

  function allocRecord(tick, player, seqNo, type, idsIn, n, a0, a1, a2) {
    if (freeTop === 0) {
      throw new Error(`commands: record ring overflow (maxRecords=${maxRecords})`);
    }
    if (liveIdWords + n > maxIds) {
      throw new Error(`commands: id ring overflow (maxIds=${maxIds}, requested ${n}, live ${liveIdWords})`);
    }
    const idx = freeStack[--freeTop];
    const idOff = idCursor;
    for (let k = 0; k < n; k++) {
      ids[(idOff + k) % maxIds] = idsIn[k];
    }
    idCursor = (idOff + n) % maxIds;
    liveIdWords += n;

    const base = idx * RECORD_STRIDE;
    records[base + OFF_TICK] = tick;
    records[base + OFF_PLAYER] = player;
    records[base + OFF_SEQ] = seqNo;
    records[base + OFF_TYPE] = type;
    records[base + OFF_NIDS] = n;
    records[base + OFF_IDOFF] = idOff;
    records[base + OFF_A0] = a0 | 0;
    records[base + OFF_A1] = a1 | 0;
    a2Arr[idx] = a2 | 0;
    used[idx] = 1;
    return idx;
  }

  function freeRecord(idx) {
    const base = idx * RECORD_STRIDE;
    liveIdWords -= records[base + OFF_NIDS];
    used[idx] = 0;
    freeStack[freeTop++] = idx;
  }

  /** Issued from input/UI or AI, never by the sim mid-step. Stamps
   * `tick = q.tick + inputDelay` and a per-player, monotonically increasing
   * `seq`. Overflow throws. */
  q.issue = function issue(player, type, idsIn, n, a0 = 0, a1 = 0, a2 = 0) {
    const s = (seq[player] | 0);
    seq[player] = s + 1;
    return allocRecord(q.tick + inputDelay, player, s, type, idsIn, n, a0, a1, a2);
  };

  /** Replay/network injection with an explicit tick/seq. Throws if
   * `tick < q.tick` (that tick has already run). */
  q.insert = function insert(tick, player, seqNo, type, idsIn, n, a0 = 0, a1 = 0, a2 = 0) {
    if (tick < q.tick) {
      throw new Error(`commands: insert into the past (tick=${tick} < q.tick=${q.tick})`);
    }
    if ((seq[player] | 0) <= seqNo) seq[player] = seqNo + 1;
    return allocRecord(tick, player, seqNo, type, idsIn, n, a0, a1, a2);
  };

  /** Runs every record whose tick === q.tick, ordered by (player, seq) via
   * insertion sort into the scratch index array, calling `handler(q, rec)`
   * for each. Frees the executed records, then `q.tick++`. Zero allocation. */
  q.execute = function execute(handler) {
    const tick = q.tick;
    let count = 0;
    for (let i = 0; i < maxRecords; i++) {
      if (!used[i]) continue;
      if (records[i * RECORD_STRIDE + OFF_TICK] !== tick) continue;
      // Insertion sort by (player, seq) as we collect.
      let p = count;
      const pi = records[i * RECORD_STRIDE + OFF_PLAYER];
      const si = records[i * RECORD_STRIDE + OFF_SEQ];
      while (p > 0) {
        const j = scratch[p - 1];
        const pj = records[j * RECORD_STRIDE + OFF_PLAYER];
        const sj = records[j * RECORD_STRIDE + OFF_SEQ];
        if (pj < pi || (pj === pi && sj <= si)) break;
        scratch[p] = scratch[p - 1];
        p--;
      }
      scratch[p] = i;
      count++;
    }
    for (let k = 0; k < count; k++) {
      handler(q, scratch[k]);
    }
    for (let k = 0; k < count; k++) {
      freeRecord(scratch[k]);
    }
    q.tick = tick + 1;
  };

  q.type = (rec) => records[rec * RECORD_STRIDE + OFF_TYPE];
  q.player = (rec) => records[rec * RECORD_STRIDE + OFF_PLAYER];
  q.seq = (rec) => records[rec * RECORD_STRIDE + OFF_SEQ];
  q.recTick = (rec) => records[rec * RECORD_STRIDE + OFF_TICK];
  q.idOff = (rec) => records[rec * RECORD_STRIDE + OFF_IDOFF];
  q.nIds = (rec) => records[rec * RECORD_STRIDE + OFF_NIDS];
  q.a0 = (rec) => records[rec * RECORD_STRIDE + OFF_A0];
  q.a1 = (rec) => records[rec * RECORD_STRIDE + OFF_A1];
  q.a2 = (rec) => a2Arr[rec];
  /** Reads the k-th id of `rec` (handles the ring's wraparound). */
  q.idAt = (rec, k) => ids[(records[rec * RECORD_STRIDE + OFF_IDOFF] + k) % maxIds];

  /** Snapshot of every pending (not yet executed) record, sorted by
   * (tick, player, seq), plus `tick` and the per-player seq counters. Not on
   * the zero-alloc hot path - allocation is fine here. */
  q.save = function save() {
    const pending = [];
    for (let i = 0; i < maxRecords; i++) {
      if (!used[i]) continue;
      const base = i * RECORD_STRIDE;
      const n = records[base + OFF_NIDS];
      const idOff = records[base + OFF_IDOFF];
      const idList = new Array(n);
      for (let k = 0; k < n; k++) idList[k] = ids[(idOff + k) % maxIds];
      pending.push([
        records[base + OFF_TICK], records[base + OFF_PLAYER], records[base + OFF_SEQ],
        records[base + OFF_TYPE], records[base + OFF_A0], records[base + OFF_A1],
        a2Arr[i], idList,
      ]);
    }
    pending.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
    return { tick: q.tick, seq: seq.slice(), records: pending };
  };

  /** Restores state from a `save()`-shaped object, replacing all pending
   * records. */
  q.load = function load(obj) {
    // Free every currently-used slot.
    for (let i = 0; i < maxRecords; i++) {
      if (used[i]) freeRecord(i);
    }
    idCursor = 0;
    liveIdWords = 0;
    q.tick = obj.tick;
    seq = obj.seq.slice();
    for (const [tick, player, seqNo, type, a0, a1, a2, idList] of obj.records) {
      allocRecord(tick, player, seqNo, type, idList, idList.length, a0, a1, a2);
    }
  };

  return q;
}
