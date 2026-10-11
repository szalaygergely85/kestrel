// game/js/quest/quickbarDrag.js (QB-6, owner 2026-10-11): drag and drop of items onto the quick bar while the pack / character menu is
// open. Pick up an item from the menu (or a bar slot), drop it on a bar slot = assign (hand slots equip, wrong item = refuse);
// drop a picked-up BAR slot anywhere off the bar = clear it. A press with no pointer movement is not a drag (a plain click).
// Pure logic, no DOM: main.js feeds it UI-grid cells from the mouse events. `bar` = {slotAt(cx,cy), idAt(slot)}.

/**
 * @param {{slotAt:(cx:number,cy:number)=>number, idAt:(slot:number)=>string|null,
 *          assign:(slot:number,id:string)=>boolean, clear:(slot:number)=>boolean}} bar
 */
export function createQuickbarDrag(bar) {
  const st = { id: null, from: -1, x0: 0, y0: 0, x: 0, y: 0, moved: false };
  return {
    st,
    /** the id riding the pointer (draw the ghost), or null until the pointer has moved */
    get ghostId() { return st.id && st.moved ? st.id : null; },
    get active() { return st.id !== null; },
    /** mouse button down at cell (cx, cy); `menuId` = the menu item under the pointer (or null). */
    down(cx, cy, menuId) {
      st.id = null; st.moved = false;
      const slot = bar.slotAt(cx, cy), barId = slot >= 0 ? bar.idAt(slot) : null;
      if (slot >= 0) { if (!barId) return false; st.id = barId; st.from = slot; }
      else if (menuId) { st.id = menuId; st.from = -1; }
      else return false;
      st.x0 = st.x = cx; st.y0 = st.y = cy;
      return true;
    },
    move(cx, cy) { st.x = cx; st.y = cy; if (st.id && (cx !== st.x0 || cy !== st.y0)) st.moved = true; },
    cancel() { st.id = null; st.moved = false; },
    /** button up. Returns null (nothing / plain click) or {kind:'assign'|'refuse'|'clear'|'keep', slot, id}. */
    up(cx, cy) {
      const id = st.id, from = st.from, moved = st.moved;
      st.id = null; st.moved = false;
      if (!id || !moved) return null;
      const slot = bar.slotAt(cx, cy);
      if (slot >= 0) {
        if (slot === from) return { kind: 'keep', slot, id };
        return { kind: bar.assign(slot, id) ? 'assign' : 'refuse', slot, id };
      }
      if (from >= 0) return { kind: bar.clear(from) ? 'clear' : 'refuse', slot: from, id };
      return null;
    },
  };
}
