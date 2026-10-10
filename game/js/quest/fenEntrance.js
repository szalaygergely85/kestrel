// unused since FEN-OFF-01 (Fen removed from the world; main.js mount is a no-op without a `fen` entity)
// game/js/quest/fenEntrance.js (CH1-08b, architecture.md 38.37 item 5). Fen is hidden until the Bend Relay is woken (and its notice is
// gone), then walks `emerge` (npcWalk, no lead); his dialogue opens on its own within 4 m (once per approach until `fen.met`), E works too.
// Load: met -> standing at the end of `emerge`; not met + relay woken -> emerges again; relay dead -> hidden.
export const TALK_NEAR_M = 4, TALK_REARM_M = 7, RELAY_KEY = 'waystone.ws_roadBend.woken', MET_KEY = 'fen.met';

/**
 * @param {{world:{state:object}, walk:object (npcWalk), requestOpen:(id:string)=>void, addTalk:()=>void,
 *   noticeBusy?:()=>boolean, dialogueOpen?:()=>boolean, id?:string, x?:()=>number, y?:()=>number}} o
 */
export function createFenEntrance(o) {
  const { world, walk } = o, st = world.state, id = o.id || 'fen';
  let started = false, ready = false, latch = false;
  const arrived = () => { ready = true; o.addTalk(); };
  const api = {
    get started() { return started; },
    get ready() { return ready; },
    /** Applies the load rules to a freshly built world (call after the world state is restored). */
    load() {
      started = ready = latch = false;
      if (st[MET_KEY]) { walk.place('emerge'); started = true; arrived(); }
      else if (st[RELAY_KEY]) { started = true; walk.start('emerge', { lead: false, onArrive: arrived }); }
      else walk.hide();
    },
    /** Fixed step. (px,py) = player; hold = a dialogue/menu/note is open (AUD-06): the walk pauses. */
    step(dt, px, py, hold) {
      if (hold) return;
      if (!started) {
        if (st[RELAY_KEY] && !(o.noticeBusy && o.noticeBusy())) { started = true; walk.start('emerge', { lead: false, onArrive: arrived }); }
        return;
      }
      if (!ready) { walk.step(dt, px, py); return; }
      if (st[MET_KEY] || !o.requestOpen) return;
      const dx = px - o.x(), dy = py - o.y(), d2 = dx * dx + dy * dy, open = o.dialogueOpen && o.dialogueOpen();
      if (!latch && !open && d2 <= TALK_NEAR_M * TALK_NEAR_M) { latch = true; o.requestOpen(id); }
      else if (latch && d2 > TALK_REARM_M * TALK_REARM_M) latch = false;
    },
  };
  return api;
}
