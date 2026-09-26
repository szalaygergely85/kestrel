// tools/editor/undo.js - US-032 (docs/architecture.md 24.8). A plain
// before/after `EditRecord` stack, cap 50. Pure, Node-tested (undo.test.mjs).
// No knowledge of `doc`/`commands.js` - `main.js` calls `applyEdit(doc, rec)`
// / `applyEdit(doc, invert(rec))` itself around `undo()`/`redo()`.

/**
 * @param {number} [cap] max steps kept (24.8: 50)
 */
export function createStack(cap = 50) {
  let undoArr = [];
  let redoArr = [];
  return {
    /** Pushes a committed `EditRecord`; drops the redo tail (24.8) and the oldest step past `cap`. */
    push(rec) {
      undoArr.push(rec);
      if (undoArr.length > cap) undoArr.shift();
      redoArr = [];
    },
    /** Pops the last undoable record (moves it to the redo side), or `null` if there is none. */
    undo() {
      const rec = undoArr.pop();
      if (!rec) return null;
      redoArr.push(rec);
      return rec;
    },
    /** Pops the last redoable record (moves it back to the undo side, capped), or `null`. */
    redo() {
      const rec = redoArr.pop();
      if (!rec) return null;
      undoArr.push(rec);
      if (undoArr.length > cap) undoArr.shift();
      return rec;
    },
    get canUndo() { return undoArr.length > 0; },
    get canRedo() { return redoArr.length > 0; },
    get size() { return undoArr.length; },
    clear() {
      undoArr = [];
      redoArr = [];
    },
  };
}
