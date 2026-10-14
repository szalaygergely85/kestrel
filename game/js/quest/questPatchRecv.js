// ED-QUEST-07b - game side of the editor's live quest/dialogue text edits (dev / editor play-test runs only, see main.js).
// Receives on BroadcastChannel 'kestrel-quest-patch':
//   { type:'quest-patch', id, def }       -> book.patchText(id, def)   (title / returnText / objective text+journal only)
//   { type:'dialogue-patch', id, raw }    -> dialogues[id] = compile(regen(id, raw))   (next talk uses the new lines)
// Answers { type:'quest-patch-result', ok, kind, id, text }. Patched text lives in memory only: saves hold quest STATE, never defs.
export const QUEST_PATCH_CHANNEL = 'kestrel-quest-patch';

/** Pure apply. env = { getBook(), getDialogues(), compile(raw), regen?(id, raw) -> raw' }. Returns { ok, text }. */
export function applyQuestMessage(env, m) {
  if (!m || typeof m !== 'object') return { ok: false, text: 'bad message' };
  if (m.type === 'quest-patch') {
    const book = env.getBook();
    if (!book || typeof book.patchText !== 'function') return { ok: false, text: 'game has no quest book yet' };
    return book.patchText(String(m.id), m.def) ? { ok: true, text: '' } : { ok: false, text: 'unknown quest ' + m.id };
  }
  if (m.type === 'dialogue-patch') {
    const dl = env.getDialogues();
    if (!dl || !m.raw || typeof m.raw !== 'object') return { ok: false, text: 'no dialogue table / lines' };
    const id = String(m.id);
    if (!dl[id]) return { ok: false, text: 'unknown dialogue ' + id }; // only swap tables that exist (never add)
    try { dl[id] = env.compile(env.regen ? env.regen(id, m.raw) : m.raw); return { ok: true, text: '' }; } catch (e) { return { ok: false, text: 'compile failed: ' + (e && e.message || e) }; }
  }
  return null; // not ours
}

export function create(channelFactory, env) {
  let ch = null;
  try { ch = channelFactory ? channelFactory(QUEST_PATCH_CHANNEL) : null; } catch (e) { ch = null; }
  if (!ch) return { active: false, close() {} };
  ch.onmessage = (ev) => {
    const m = ev && ev.data, r = applyQuestMessage(env, m);
    if (r) ch.postMessage({ type: 'quest-patch-result', kind: m.type, id: m.id, ok: r.ok, text: r.text });
  };
  return { active: true, close() { ch.onmessage = null; if (ch.close) ch.close(); } };
}
