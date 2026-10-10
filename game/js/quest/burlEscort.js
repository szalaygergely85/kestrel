// game/js/quest/burlEscort.js (CH1-07, architecture.md 38.37 item 5). Pure phase logic for Burl's escort and departure;
// movement is npcWalk. world.state['burl.phase'] (int) and ['burl.wp'] (int) are saved with world.state.
//   0 home  1 walking to the stone  2 at the stone  3 departing  4 gone (hidden)
// s.* dialogue flags live in world.state without the "s." (dialogueCtl): burl.follow, burl.depart, burl.departing.
export const PHASE_HOME = 0, PHASE_WALK = 1, PHASE_STONE = 2, PHASE_DEPART = 3, PHASE_GONE = 4;
export const CALL_NEAR_M = 14, TALK_NEAR_M = 4, TALK_REARM_M = 7;

/**
 * @param {{world:{state:object}, walk:object (npcWalk), questFlag:(k:string)=>void,
 *   barks?:{play:(id:string,who?:any)=>boolean}, dialogueOpen?:()=>boolean, afterLeave?:()=>boolean,
 *   requestOpen?:(id:string)=>void, id?:string, x?:()=>number, y?:()=>number}} o
 *   x/y: Burl position getters (for the proximity checks)
 */
export function createBurlEscort(o) {
  const { world, walk, questFlag } = o, st = world.state, id = o.id || 'bear';
  let talkLatch = false;
  const phase = () => st['burl.phase'] | 0;
  const setPhase = (p) => { st['burl.phase'] = p; };
  const follow = () => walk.start('follow', { lead: true, fromWp: st['burl.wp'] | 0, onArrive: arrived });
  function arrived() { st['burl.wp'] = walk.wp; setPhase(PHASE_STONE); questFlag('burl.arrived'); }
  function gone() { setPhase(PHASE_GONE); }
  const api = {
    get phase() { return phase(); },
    /** true while Burl is on a walk (npcBear's turn-to-player stays paused). */
    get busy() { return walk.active; },
    /** Applies the load rules to a freshly built world (call once after the world state is restored). */
    load() {
      const p = phase();
      if (p === PHASE_WALK) follow();                       // mid-walk: stands at burl.wp, resumes when the player is near
      else if (p === PHASE_STONE) walk.place('follow');     // at the end of the walk
      else if (p === PHASE_DEPART || p === PHASE_GONE) { walk.hide(); setPhase(PHASE_GONE); } // departure is not replayed
    },
    /** Fixed step. (px,py) = player. */
    step(dt, px, py) {
      const p = phase();
      if (p === PHASE_HOME) {
        if (st['burl.follow']) { setPhase(PHASE_WALK); st['burl.wp'] = 0; follow(); return; }
        if (o.barks && (!o.afterLeave || o.afterLeave())) {
          const dx = px - o.x(), dy = py - o.y();
          if (dx * dx + dy * dy <= CALL_NEAR_M * CALL_NEAR_M) o.barks.play('bear.call', id);
        }
      } else if (p === PHASE_WALK) {
        walk.step(dt, px, py);
        st['burl.wp'] = walk.wp;
      } else if (p === PHASE_STONE) {
        const open = o.dialogueOpen && o.dialogueOpen();
        if (st['burl.depart'] && !open) { // the after-wake node ended: leave
          setPhase(PHASE_DEPART); questFlag('burl.departing');
          walk.start('depart', { lead: false, hideAtEnd: true, onArrive: gone });
          return;
        }
        // auto-open the stone talk once per approach until it has been told
        if (!st['dlg.bear.stone.told'] && !st['bear.stone.told'] && o.requestOpen) {
          const dx = px - o.x(), dy = py - o.y(), d2 = dx * dx + dy * dy;
          if (!talkLatch && !open && d2 <= TALK_NEAR_M * TALK_NEAR_M) { talkLatch = true; o.requestOpen(id); }
          else if (talkLatch && d2 > TALK_REARM_M * TALK_REARM_M) talkLatch = false;
        }
      } else if (p === PHASE_DEPART) {
        walk.step(dt, px, py);
      }
    },
  };
  return api;
}
