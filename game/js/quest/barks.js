// game/js/quest/barks.js (CH1-06, architecture.md 38.37 item 6).
// Non-modal one-liners ("barks"): a short typed exchange in the dialogue box skin, played once per id.
// Data (content/dialogue/*.barks.json): { speakers:{key:{label, player?}}, barks:{ id:[{who, text}, ...] } }.
// Once-flag `bark.<id>` lives in world.state (set through the injected questFlag, so it is saved/emitted like quest flags).
// Cancelled when a dialogue opens (opt.dialogue.open). Draw reuses dialogueView with a reused runner-shaped object (0 alloc).
import { createDialogueView } from './dialogueView.js';

export const BARK_LINE_SEC = 1.6;
const NO_HINT_STYLE = { keyHints: { text: '' } }; // barks take no input: hide "E: next"

/**
 * @param {{world:{state:object}, data:object, questFlag:(key:string)=>void, dialogue?:{open:boolean},
 *   style?:object, palette?:object, cps?:number, lineSec?:number}} opt
 */
export function createBarks(opt) {
  const { world } = opt, data = opt.data || {};
  const speakers = data.speakers || {}, barks = data.barks || {};
  const view = opt.view || createDialogueView({ style: Object.assign({}, opt.style, NO_HINT_STYLE), palette: opt.palette });
  const cps = opt.cps || view.cps, lineSec = opt.lineSec || BARK_LINE_SEC;
  const queue = [];       // ids waiting (play() time allocation only)
  let lines = null;       // active bark's line array
  let idx = 0, t = 0;     // current line, seconds on it
  // Runner-shaped view model, mutated in place.
  const r = { state: 'idle', speakerLabel: '', isPlayer: false, line: '', visibleChars: 0, choiceCount: 0, selected: 0 };

  function begin(id) {
    lines = barks[id]; idx = 0; t = 0; showLine();
  }
  function showLine() {
    const l = lines[idx], sp = speakers[l.who];
    r.speakerLabel = sp ? sp.label : String(l.who || '');
    r.isPlayer = !!(sp && sp.player);
    r.line = l.text; r.visibleChars = 0; r.state = 'typing';
  }
  function stop() { lines = null; queue.length = 0; r.state = 'idle'; r.line = ''; }

  const api = {
    /** true while a bark is on screen. */
    get active() { return lines !== null; },
    /** Plays bark `id` once ever. Returns true when started or queued. `speaker` (entity id/handle) is kept for the caller's use. */
    play(id, speaker) {
      const ls = barks[id];
      if (!Array.isArray(ls) || ls.length === 0) return false;
      const key = 'bark.' + id;
      if (world.state[key]) return false;                       // already played
      if (opt.dialogue && opt.dialogue.open) return false;      // never over a dialogue; not marked, can retry
      if (lines !== null && queue.indexOf(id) >= 0) return false;
      opt.questFlag(key);
      api.speaker = speaker === undefined ? null : speaker;
      if (lines === null) begin(id); else queue.push(id);
      return true;
    },
    speaker: null,
    /** Fixed-step update. */
    step(dt) {
      if (lines === null) return;
      if (opt.dialogue && opt.dialogue.open) { stop(); return; }
      t += dt;
      const n = Math.floor(t * cps), len = r.line.length;
      r.visibleChars = n < len ? n : len;
      if (r.visibleChars >= len) r.state = 'waiting';
      if (t < lineSec) return;
      if (++idx < lines.length) { t = 0; showLine(); return; }
      if (queue.length) begin(queue.shift()); else stop();
    },
    cancel: stop,
    /** Draw into the UiLayer (nothing when idle). */
    draw(layer, timeSec) { if (lines !== null) view.draw(layer, r, timeSec || 0); },
  };
  return api;
}
