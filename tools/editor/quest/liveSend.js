// tools/editor/quest/liveSend.js - ED-QUEST-07b. Debounced live push of unsaved quest text / dialogue lines to a running
// game tab (BroadcastChannel 'kestrel-quest-patch', received by game/js/quest/questPatchRecv.js; the game ignores it
// outside editor play-test / ?dev=1 runs). Pure: the channel and timers are injected.
import { objText, objJournal } from './flow.js';
export const QUEST_PATCH_CHANNEL = 'kestrel-quest-patch';

/** Display-text view of a model quest (what book.patchText accepts). */
export function questTextDef(q) {
  return { title: q.title, returnText: q.returnText, objectives: (q.objectives || []).map((o) => ({ id: o.id, text: objText(o), journal: objJournal(o) })) };
}

/** Dialogue files whose lines differ from the loaded baseline -> [{ id:'rook', raw }]. */
export function changedDialogues(dm) {
  const out = [];
  for (const [name, f] of dm.files) if (JSON.stringify(f.obj) !== JSON.stringify(f.orig)) out.push({ id: name.replace(/\.dialogue\.json$/, ''), raw: f.obj });
  return out;
}

export function createLiveSender({ channel, delayMs = 250, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null, job = null, last = new Map(), sent = 0;
  function flush() {
    timer = null; if (!job || !channel) return;
    const { q, dm } = job; job = null;
    const post = (key, msg) => { const s = JSON.stringify(msg); if (last.get(key) === s) return; last.set(key, s); sent++; channel.postMessage(msg); };
    if (q) post('q:' + q.id, { type: 'quest-patch', id: q.id, def: questTextDef(q) });
    if (dm) for (const d of changedDialogues(dm)) post('d:' + d.id, { type: 'dialogue-patch', id: d.id, raw: d.raw });
  }
  return {
    /** Call after every quest/dialogue edit; the latest call within the window wins. */
    schedule(q, dm) { job = { q, dm }; if (timer !== null) clearTimer(timer); timer = setTimer(flush, delayMs); },
    flush() { if (timer !== null) clearTimer(timer); flush(); },
    get sentCount() { return sent; },
  };
}

export const browserChannel = () => { try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel(QUEST_PATCH_CHANNEL) : null; } catch (e) { return null; } };
