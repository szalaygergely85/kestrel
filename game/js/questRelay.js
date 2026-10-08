// US-096w: bridges game events/facts into the lane-C quest sim (quest/sim/quest.js) and exposes the current
// objective text for the HUD. Pure data + a small UI-layer draw; no world/engine imports, so it runs in Node.
import { createQuest, applyQuestEvent, questObjectives } from './quest/sim/quest.js';

const BREACH_R2 = 3 * 3, BREACH_DZ = 2.5; // "reached the breach": within 3 m (xy) of the marker and 2.5 m in z
export const DONE_TEXT = 'The pencil line runs on.';
const PLATE = [10, 11, 16], TEXT = [226, 214, 176], DIM = [140, 134, 112];

/**
 * @param {any} def quest definition (content/quests/m1.quest.json)
 * @param {any} [saved] quest snapshot from a save
 */
export function createQuestRelay(def, saved = null) {
  let state = createQuest(def, saved);
  let rows = questObjectives(state, def, []);
  const fired = { wake: false, lantern: false, sword: false, waystone: false, breach: false }; // edge guards (cheap polling)
  let dirty = false, lineFor = '', line = '';

  function syncFired() {
    fired.wake = state.flags.wake === true; fired.lantern = state.items.includes('lantern');
    fired.sword = state.items.includes('sword'); fired.waystone = state.areas.includes('waystone'); fired.breach = state.areas.includes('breach');
  }
  syncFired();

  /** Feeds one quest event (see quest.js); returns true when the quest changed. Malformed ids are ignored. */
  function feed(event) {
    let changed = false;
    try { changed = applyQuestEvent(state, event, def); } catch (e) { return false; }
    if (changed) { questObjectives(state, def, rows); dirty = true; }
    return changed;
  }

  const relay = {
    def,
    /** Optional (name, a, b) callback for every event poll() fires (main.js points it at the gameHooks seam). */
    onPoll: null,
    get state() { return state; },
    get done() { return state.completed.length >= def.objectives.length; },
    get dirty() { return dirty; },
    clearDirty() { dirty = false; },
    feed,
    /** Current objective text (first not-complete objective) or the done line (writer: "The pencil line runs on."). */
    objectiveText() {
      return state.completed.length < def.objectives.length ? def.objectives[state.completed.length].text : (def.doneText || DONE_TEXT);
    },
    /** Replace the quest (restore from a save, or a fresh run when `saved` is null). */
    reset(savedState = null) {
      state = createQuest(def, savedState); rows = questObjectives(state, def, []); syncFired(); dirty = false;
    },
    /**
     * Per-fixed-step facts -> events. Every flag fires once (guards); cost is a few comparisons.
     * @param {{wakeDone:boolean, lanternTaken:boolean, swordTaken:boolean, endStarted:boolean, x:number, y:number, z:number}} f
     * @param {{x:number,y:number,z:number}|null} breach world-space breach marker
     */
    poll(f, breach) {
      if (f.wakeDone && !fired.wake) { fired.wake = true; feed({ type: 'flag:set', key: 'wake', value: true }); if (relay.onPoll) relay.onPoll('flag:set', 'wake', true); }
      if (f.lanternTaken && !fired.lantern) { fired.lantern = true; feed({ type: 'item:got', id: 'lantern' }); if (relay.onPoll) relay.onPoll('item:got', 'lantern', 1); }
      if (f.swordTaken && !fired.sword) { fired.sword = true; feed({ type: 'item:got', id: 'sword' }); if (relay.onPoll) relay.onPoll('item:got', 'sword', 1); }
      if (breach && !fired.breach) {
        const dx = f.x - breach.x, dy = f.y - breach.y;
        if (dx * dx + dy * dy <= BREACH_R2 && Math.abs(f.z - breach.z) <= BREACH_DZ) { fired.breach = true; feed({ type: 'area:entered', id: 'breach' }); if (relay.onPoll) relay.onPoll('area:entered', 'breach'); }
      }
      if (f.endStarted && !fired.waystone) { fired.waystone = true; feed({ type: 'area:entered', id: 'waystone' }); if (relay.onPoll) relay.onPoll('area:entered', 'waystone'); }
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
