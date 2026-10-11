// game/js/quest/burlEscort.js (CH1-07, architecture.md 38.37 item 5). Pure phase logic for Burl's escort and departure;
// movement is npcWalk. world.state['burl.phase'] (int) and ['burl.wp'] (int) are saved with world.state.
//   0 home  1 walking to the stone  2 at the stone  3 departing  4 gone (hidden)  5 back home (flags burl.home)
// s.* dialogue flags live in world.state without the "s." (dialogueCtl): burl.follow, burl.depart, burl.departing.
export const PHASE_HOME = 0, PHASE_WALK = 1, PHASE_STONE = 2, PHASE_DEPART = 3, PHASE_GONE = 4, PHASE_BACK = 5; // 5 = QL-05: back on her berry slope (errand giver)
export const HOME_FAR_M = 40; // QL-05: Burl reappears at home only when the player is at least this far away (never pops in sight)
export const WAIT_BARK_M = 12, WAIT_BARK_COOL_S = 20; // PO-CH1-14: player runs ahead of Burl during the walk
// M4 (sq.burl.walk): 6 = leading the player along walks.toBend, 7 = waiting at the Bend relay until hand-in (then she goes home out of sight)
export const PHASE_LEAD = 6, PHASE_BEND = 7, LEAD_WAIT_M = 14, LEAD_RESUME_M = 8, BEND_FLAG = 'escort.bear.relayBend';
export const CALL_NEAR_M = 14, TALK_NEAR_M = 4, TALK_REARM_M = 7;

/**
 * @param {{world:{state:object}, walk:object (npcWalk), questFlag:(k:string)=>void,
 *   barks?:{play:(id:string,who?:any)=>boolean}, dialogueOpen?:()=>boolean, afterLeave?:()=>boolean,
 *   requestOpen?:(id:string)=>void, noticeBusy?:()=>boolean, id?:string, x?:()=>number, y?:()=>number}} o
 *   x/y: Burl position getters (for the proximity checks)
 */
export function createBurlEscort(o) {
  const { world, walk, questFlag } = o, st = world.state, id = o.id || 'bear';
  const t0 = (world.get(id) && world.get(id).data.transform) || null, homeYaw = t0 ? t0.yawDeg : 0;
  let talkLatch = false, wokenLatch = false, waitCool = 0;
  const phase = () => st['burl.phase'] | 0;
  const setPhase = (p) => { st['burl.phase'] = p; };
  const follow = () => walk.start('follow', { lead: true, fromWp: st['burl.wp'] | 0, onArrive: arrived });
  function arrived() { st['burl.wp'] = walk.wp; setPhase(PHASE_STONE); questFlag('burl.arrived'); }
  function gone() { setPhase(PHASE_GONE); }
  // QL-05: the walk's first waypoint is her berry slope (data). Appears there, talkable again, flag s.burl.home / quest flag burl.home.
  function goHome() {
    setPhase(PHASE_BACK); st['burl.home'] = true; st['burl.departing'] = false;
    walk.place('follow', 0); if (t0) t0.yawDeg = homeYaw;
    if (o.restore) o.restore();
    questFlag('burl.home');
  }
  // sq.burl.walk: o.leadStatus() = questBook status of the errand (2 active, 3 ready, 4 done); needs components.walks.toBend (data)
  const hasLead = () => { const w = world.get(id), c = w && w.data.components; return !!(c && c.walks && c.walks.toBend); };
  const leadStatus = () => (o.leadStatus ? o.leadStatus() : -1);
  const lead = () => walk.start('toBend', { lead: true, waitFar: LEAD_WAIT_M, resumeNear: LEAD_RESUME_M, fromWp: st['burl.lwp'] | 0, onArrive: atBend });
  function atBend() { st['burl.lwp'] = walk.wp; setPhase(PHASE_BEND); questFlag(BEND_FLAG, true); }
  const homeXY = () => { const w = world.get(id), p = w && w.data.components && w.data.components.walks && w.data.components.walks.follow; return p ? p[0] : null; };
  const api = {
    get phase() { return phase(); },
    /** true while Burl is on a walk (npcBear's turn-to-player stays paused). */
    get busy() { return walk.active; },
    /** Applies the load rules to a freshly built world (call once after the world state is restored). */
    load() {
      const p = phase();
      if (p === PHASE_WALK) follow();                       // mid-walk: stands at burl.wp, resumes when the player is near
      else if (p === PHASE_STONE) walk.place('follow');     // at the end of the walk
      else if (p === PHASE_LEAD) { if (leadStatus() >= 2 && leadStatus() <= 3) lead(); else goHome(); } // resumes where she stood
      else if (p === PHASE_BEND) { if (leadStatus() >= 2 && leadStatus() <= 3) walk.place('toBend'); else goHome(); }
      else if (p === PHASE_DEPART || p === PHASE_GONE || p === PHASE_BACK) goHome(); // departure is not replayed; a fresh load puts her home (QL-05)
    },
    /** Fixed step. (px,py) = player; hold = a dialogue/menu/note is open (AUD-06): no walking, no barks. */
    step(dt, px, py, hold) {
      if (hold) return;
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
        if (waitCool > 0) waitCool -= dt;
        if (o.barks && waitCool <= 0) { // NEEDS WRITER: bark key 'bear.wait' (placeholder text in bear.barks.json)
          const dx = px - o.x(), dy = py - o.y();
          if (dx * dx + dy * dy > WAIT_BARK_M * WAIT_BARK_M && o.barks.play('bear.wait', id, true)) waitCool = WAIT_BARK_COOL_S;
        }
      } else if (p === PHASE_STONE) {
        const open = o.dialogueOpen && o.dialogueOpen();
        if (st['burl.depart'] && !open) { // the after-wake node ended: leave
          setPhase(PHASE_DEPART); questFlag('burl.departing');
          walk.start('depart', { lead: false, hideAtEnd: true, onArrive: gone });
          return;
        }
        // PO-CH1-08: the stone is awake -> Burl's goodbye opens by itself once the notice is gone and the player is near (no un-prompted re-talk)
        if (st['waystone.waystone.woken'] && !st['burl.depart'] && o.requestOpen && !(o.noticeBusy && o.noticeBusy())) {
          const dx = px - o.x(), dy = py - o.y(), d2 = dx * dx + dy * dy;
          if (!wokenLatch && !open && d2 <= TALK_NEAR_M * TALK_NEAR_M) { wokenLatch = true; o.requestOpen(id); }
          else if (wokenLatch && d2 > TALK_REARM_M * TALK_REARM_M) wokenLatch = false;
        }
        // auto-open the stone talk once per approach until it has been told
        if (!st['dlg.bear.stone.told'] && !st['bear.stone.told'] && o.requestOpen) {
          const dx = px - o.x(), dy = py - o.y(), d2 = dx * dx + dy * dy;
          if (!talkLatch && !open && d2 <= TALK_NEAR_M * TALK_NEAR_M) { talkLatch = true; o.requestOpen(id); }
          else if (talkLatch && d2 > TALK_REARM_M * TALK_REARM_M) talkLatch = false;
        }
      } else if (p === PHASE_BACK) { // home on her slope: sq.burl.walk accepted -> she leads (starts once the accept dialogue is closed)
        if (leadStatus() === 2 && hasLead() && !st[BEND_FLAG]) { st['burl.lwp'] = 0; setPhase(PHASE_LEAD); lead(); }
      } else if (p === PHASE_LEAD) {
        if (leadStatus() < 2 || leadStatus() > 3) { goHome(); return; } // abandoned
        walk.step(dt, px, py);
        st['burl.lwp'] = walk.wp;
        if (waitCool > 0) waitCool -= dt;
        if (o.barks && waitCool <= 0) {
          const dx = px - o.x(), dy = py - o.y();
          if (dx * dx + dy * dy > WAIT_BARK_M * WAIT_BARK_M && o.barks.play('bear.wait', id, true)) waitCool = WAIT_BARK_COOL_S;
        }
      } else if (p === PHASE_BEND) { // handed in (or abandoned) and the player has left -> home, never popping in sight
        const ls = leadStatus();
        if (ls !== 2 && ls !== 3) {
          const dx = px - o.x(), dy = py - o.y(), h = homeXY();
          if (dx * dx + dy * dy >= HOME_FAR_M * HOME_FAR_M && (!h || (px - h[0]) ** 2 + (py - h[1]) ** 2 >= HOME_FAR_M * HOME_FAR_M)) { st[BEND_FLAG] = false; goHome(); }
        }
      } else if (p === PHASE_DEPART) {
        walk.step(dt, px, py);
      } else if (p === PHASE_GONE) { // QL-05: out of sight and far away -> she is home again
        const h = homeXY();
        if (h && (px - h[0]) ** 2 + (py - h[1]) ** 2 >= HOME_FAR_M * HOME_FAR_M) goHome();
      }
    },
  };
  return api;
}
