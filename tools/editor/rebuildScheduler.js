// tools/editor/rebuildScheduler.js - ED-MESH-1d (architecture.md 31.3 "Debounce"):
// several edits inside one animation frame (arrow-key repeats) -> ONE World.load + setWorld.
// Pure (no DOM / engine): `request()` marks a rebuild pending, `flush()` runs it at most once
// per call (the editor calls it from its frame loop), `flushNow()` is `request()` + `flush()`.

/**
 * @param {() => number} doRebuild runs the real rebuild and returns its ms
 * @param {(ms:number, count:number) => void} [onDone] called after a rebuild with the ms
 *        and how many requests it folded
 */
export function createRebuildScheduler(doRebuild, onDone) {
  let pending = 0;
  let runs = 0;
  return {
    request() { pending++; },
    flush() {
      if (!pending) return false;
      const folded = pending;
      pending = 0;
      runs++;
      const ms = doRebuild();
      if (onDone) onDone(ms, folded);
      return true;
    },
    flushNow() { pending++; return this.flush(); },
    get pending() { return pending > 0; },
    get runs() { return runs; },
  };
}
