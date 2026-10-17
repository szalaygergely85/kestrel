// tools/editor/questPick.js - ED-QUEST-03. Pick mode: the quest panel arms a slot, the next viewport click
// (resolved by main.js through the normal pickAt) goes to handle(); Esc cancels. No DOM besides the optional chip.
export function createQuestPicker({ onHit, onState } = {}) {
  let slot = null;
  const set = (s) => { slot = s; if (onState) onState(s); };
  return {
    get armed() { return slot !== null; },
    get slot() { return slot; },
    arm(s) { set(s); },
    cancel() { if (slot !== null) set(null); },
    /** Viewport click result {entityId, point}: returns true when consumed (picker stays armed on an error so the owner can retry). */
    handle(hit) {
      if (slot === null) return false;
      const s = slot, ok = onHit ? onHit(s, hit) : true;
      if (ok !== false) set(null);
      return true;
    },
    onKey(e) { if (e.key === 'Escape' && slot !== null) { set(null); return true; } return false; },
  };
}
