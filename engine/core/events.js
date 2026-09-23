// Tiny synchronous event emitter (US-024, docs/architecture.md section 10).
// Engine emits `world:loaded`, `world:structurePlaced`, `world:sectorAnimated`,
// `entity:added/removed`, `interaction:fired`, `trigger:fired`, `resize`,
// `contextlost/restored`. The editor subscribes; the game may too. Payloads
// are always plain data.
export class Events {
  constructor() {
    this._listeners = new Map(); // name -> Set<fn>
  }

  on(name, fn) {
    let set = this._listeners.get(name);
    if (!set) {
      set = new Set();
      this._listeners.set(name, set);
    }
    set.add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const set = this._listeners.get(name);
    if (set) set.delete(fn);
  }

  emit(name, payload) {
    const set = this._listeners.get(name);
    if (!set || set.size === 0) return;
    // Copy to an array: a listener may add/remove listeners mid-emit.
    for (const fn of Array.from(set)) fn(payload);
  }
}
