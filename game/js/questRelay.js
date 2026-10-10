// US-096w: bridges game events/facts into the lane-C quest sim (quest/sim/quest.js) and exposes the current
// objective text for the HUD. Pure data + a small UI-layer draw; no world/engine imports, so it runs in Node.
import { questObjectives } from './quest/sim/quest.js';
import { createQuestBook, READY } from './quest/sim/questBook.js'; // QG-03: the relay's m1 state IS book.main

const BREACH_R2 = 3 * 3, BREACH_DZ = 2.5; // "reached the breach": within 3 m (xy) of the marker and 2.5 m in z
export const DONE_TEXT = 'The pencil line runs on.';
const PLATE = [10, 11, 16], TEXT = [226, 214, 176], DIM = [140, 134, 112];

/**
 * @param {any} def quest definition (content/quests/m1.quest.json)
 * @param {any} [saved] quest snapshot from a save
 * @param {any[]} [giverDefs] giver quests (content/quests/*.quest.json with `giver`); QG-03
 * @param {any} [savedQuests] save.game.quests map (or migrated)
 */
export function createQuestRelay(def, saved = null, giverDefs = [], savedQuests = null) {
  let book = createQuestBook(def, giverDefs, { quest: saved, quests: savedQuests });
  let state = book.main;
  let rows = questObjectives(state, def, []);
  const fired = { wake: false, sword: false, waystone: false, breach: false }; // edge guards (cheap polling)
  const firedAreas = new Set();
  let dirty = false, lineFor = '', line = '';

  function syncFired() {
    fired.wake = state.flags.wake === true;
    fired.sword = state.items.includes('sword'); fired.waystone = state.areas.includes('waystone'); fired.breach = state.areas.includes('breach');
  }
  syncFired();

  /** Feeds one quest event (see quest.js); returns true when the quest changed. Malformed ids are ignored. */
  function feed(event) {
    let changed = false;
    try { changed = book.feed(event); } catch (e) { return false; }
    if (changed) { questObjectives(state, def, rows); dirty = true; }
    relay.checkSections();
    return changed;
  }

  /** CH1-02: "Quest complete" callback(title) for every section whose last step completed in objectives [from, to). */
  let seen = state.completed.length; // steps already accounted for (restore sets it, so a restore never toasts)
  function sectionToasts(from, to) {
    const objs = def.objectives, titles = new Map((def.sections || []).map(x => [x.id, x.title]));
    for (let i = from; i < to; i++) {
      const sec = objs[i].section;
      if (sec && (i + 1 >= objs.length || objs[i + 1].section !== sec) && titles.has(sec)) relay.onSection(titles.get(sec));
    }
  }

  const relay = {
    def,
    /** Optional (title) callback: a section's last step completed live (main.js shows "Quest complete: <title>"). */
    onSection: null,
    /** Fires onSection for steps completed since the last call (feed() calls it; saveRelay.stepGame too, for giver hand-ins that bypass feed). */
    checkSections() {
      const n = state.completed.length;
      if (n > seen && relay.onSection) sectionToasts(seen, n);
      seen = n;
    },
    /** World the quest flags are written to (set by saveRelay each step / on boot). */
    world: null,
    /** CH1-02 (38.37 item 1): the one way game code sets a quest flag: world.state[key] = value AND book.feed. */
    questFlag(key, value = true) {
      if (relay.world) relay.world.state[key] = value;
      return feed({ type: 'flag:set', key, value });
    },
    /** QG-03: the quest book (m1 + giver quests); replaced on reset(), so read it through the relay each time. */
    get book() { return book; },
    /** Optional (name, a, b) callback for every event poll() fires (main.js points it at the gameHooks seam). */
    onPoll: null,
    get state() { return state; },
    get done() { return state.completed.length >= def.objectives.length; },
    get dirty() { return dirty; },
    clearDirty() { dirty = false; },
    feed,
    /** Current objective text (first not-complete objective) or the done line (writer: "The pencil line runs on."). */
    objectiveText() {
      const t = book.tracked(); // QG-03: an accepted giver quest owns the HUD line (its step, or its return line when ready)
      if (t >= 0) { const d = book.def(t); return book.status(t) === READY && d.returnText ? d.returnText : d.objectives[Math.min(book.questState(t).completed.length, d.objectives.length - 1)].text; }
      return state.completed.length < def.objectives.length ? def.objectives[state.completed.length].text : (def.doneText || DONE_TEXT);
    },
    /** Replace the quest (restore from a save, or a fresh run when `saved` is null). */
    reset(savedState = null, savedQuests = null) {
      const onChange = book.onChange;
      book = createQuestBook(def, giverDefs, { quest: savedState, quests: savedQuests }); firedAreas.clear(); book.onChange = onChange; state = book.main; rows = questObjectives(state, def, []); syncFired(); dirty = false; seen = state.completed.length;
    },
    /**
     * Per-fixed-step facts -> events. Every flag fires once (guards); cost is a few comparisons.
     * @param {{wakeDone:boolean, swordTaken:boolean, endStarted:boolean, x:number, y:number, z:number}} f
     * @param {{x:number,y:number,z:number}|null} breach world-space breach marker
     */
    poll(f, breach) {
      if (f.wakeDone && !fired.wake) { fired.wake = true; feed({ type: 'flag:set', key: 'wake', value: true }); if (relay.onPoll) relay.onPoll('flag:set', 'wake', true); }
      if (f.swordTaken && !fired.sword) { fired.sword = true; feed({ type: 'item:got', id: 'sword' }); if (relay.onPoll) relay.onPoll('item:got', 'sword', 1); }
      if (breach && !fired.breach) {
        const dx = f.x - breach.x, dy = f.y - breach.y;
        if (dx * dx + dy * dy <= BREACH_R2 && Math.abs(f.z - breach.z) <= BREACH_DZ) { fired.breach = true; feed({ type: 'area:entered', id: 'breach' }); if (relay.onPoll) relay.onPoll('area:entered', 'breach'); }
      }
      if (f.endStarted && !fired.waystone) { fired.waystone = true; feed({ type: 'area:entered', id: 'waystone' }); if (relay.onPoll) relay.onPoll('area:entered', 'waystone'); }
    },
    /**
     * QUEST-CHAIN-Q-01: area-only world zones (towerDoor / roadWest / bendRelay: circle x,y,r,zMin) -> area:entered once.
     * Nothing else emitted these live (triggers.js skips nameless zones), so the 'leave' / 'road' / 'relay' steps never completed.
     * @param {number} x @param {number} y @param {number} z @param {{id:string,x:number,y:number,r:number,zMin:number}[]} zones
     */
    pollAreas(x, y, z, zones) {
      for (let i = 0; i < zones.length; i++) {
        const q = zones[i];
        if (state.areas.includes(q.id) || firedAreas.has(q.id)) continue;
        const dx = x - q.x, dy = y - q.y;
        if (dx * dx + dy * dy <= q.r * q.r && z >= q.zMin) { firedAreas.add(q.id); feed({ type: 'area:entered', id: q.id }); if (relay.onPoll) relay.onPoll('area:entered', q.id); }
      }
    },
    /** HUD: objective line at the top-left of the UI layer (setCellRGB cells; no allocation).
     *  TEMPORARY (D-050): lane C's quest HUD replaces this line; until then it is the only objective line (never draw two). */
    draw(ui) {
      const text = relay.objectiveText();
      if (text !== lineFor) { lineFor = text; line = relay.done ? text : '> ' + text; } // rebuilt only when the text changes
      const s = line;
      const fg = relay.done ? DIM : TEXT, x0 = 2, y = 1;
      for (let j = -1; j <= s.length; j++) put(ui, x0 + j, y, 32, fg, PLATE);
      for (let j = 0; j < s.length; j++) put(ui, x0 + j, y, s.charCodeAt(j), fg, PLATE);
    },
  };
  return relay;
}

function put(ui, x, y, code, fg, bg) {
  if (x < 0 || x >= ui.cols) return;
  ui.setCellRGB(x, y, code - 32, fg[0], fg[1], fg[2], bg[0], bg[1], bg[2]);
}
