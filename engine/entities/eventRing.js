// engine/entities/eventRing.js (US-025, docs/architecture.md 10.1).
//
// A fixed-capacity FIFO queue that decouples "an event happened during this
// sim step" (pushed by move/animation systems while iterating entities) from
// "listeners run" (drained once per step by `World.flushEvents`, called by
// the loop after `integrate`) - draining, not firing inline, is what makes a
// listener that spawns or removes an entity safe (10.1): iteration of the
// world's entities never re-enters while a listener runs.
//
// Preallocated slots (three parallel arrays), reused every push - no
// allocation once constructed (architecture.md section 9). Payloads are
// small plain values (`arg`), not necessarily numeric (an interaction ctx is
// a plain object), so this is a fixed-size circular buffer of reused slots
// rather than a literal Int32Array (whose 3-field layout the tech notes
// describe conceptually) - entity ids are strings and event names are
// interned strings already, and `arg` is data, not something JSON-safe
// numeric IDs can carry without an extra allocation elsewhere.
export class EventRing {
  constructor(size = 256) {
    this.size = size;
    this._id = new Array(size).fill(null);
    this._event = new Array(size).fill(null);
    this._arg = new Array(size).fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.dropped = 0;
  }

  /** @returns {boolean} false if the ring is full (dropped, `this.dropped` incremented) */
  push(entityId, event, arg) {
    if (this.count >= this.size) {
      this.dropped++;
      return false;
    }
    const i = this.tail;
    this._id[i] = entityId;
    this._event[i] = event;
    this._arg[i] = arg;
    this.tail = (this.tail + 1) % this.size;
    this.count++;
    return true;
  }

  /**
   * Drains exactly the entries present at the moment this call started
   * (snapshotted count), calling `fn(entityId, event, arg)` for each -
   * entries pushed by a listener while draining are left for the NEXT
   * `drain` call, so a spawn/remove triggered by a listener never grows the
   * drain loop it is running inside (10.1 "a listener that spawns/removes
   * during flush is safe").
   */
  drain(fn) {
    let n = this.count;
    while (n-- > 0) {
      const i = this.head;
      const id = this._id[i], event = this._event[i], arg = this._arg[i];
      this._id[i] = null;
      this._event[i] = null;
      this._arg[i] = null;
      this.head = (this.head + 1) % this.size;
      this.count--;
      fn(id, event, arg);
    }
  }
}
