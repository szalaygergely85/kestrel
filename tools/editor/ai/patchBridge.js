// tools/editor/ai/patchBridge.js - ED-AI-03. Debounced live patch of one archetype to a running game tab. The game side
// (ED-AI-02, `sim.patchArchetype`) receives { type:'ai-patch', name, fields } and answers { type:'ai-patch-result', name,
// ok, refused:[messages] }. Transport is injected: channel = { post(msg), onmessage = fn } (DOM glue uses BroadcastChannel).
// Pure, timers injectable. At most one message per `delayMs` per archetype; fields of the same archetype merge.
export const PATCH_MSG = 'ai-patch';
export const PATCH_RESULT = 'ai-patch-result';

export function createPatchBridge({ channel, delayMs = 100, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, onResult = () => {} }) {
  const pending = new Map(); // name -> { fields, timer }
  const lastSent = new Map(); // name -> time
  let sent = 0;
  function flushOne(name) {
    const p = pending.get(name); if (!p) return;
    if (p.timer !== null) clearTimer(p.timer);
    pending.delete(name);
    lastSent.set(name, now()); sent++;
    channel.post({ type: PATCH_MSG, name, fields: p.fields });
  }
  if (channel) channel.onmessage = (m) => { if (m && m.type === PATCH_RESULT) onResult({ name: m.name, ok: !!m.ok, refused: m.refused || [] }); };
  return {
    /** Queue fields for `name`; sent at once if idle, else after the rest of the debounce window (fields merge). */
    sendPatch(name, fields) {
      const p = pending.get(name);
      if (p) { Object.assign(p.fields, fields); return; }
      const wait = Math.max(0, delayMs - (now() - (lastSent.get(name) ?? -Infinity)));
      const entry = { fields: { ...fields }, timer: null };
      pending.set(name, entry);
      if (wait === 0) flushOne(name); else entry.timer = setTimer(() => flushOne(name), wait);
    },
    flush() { for (const n of [...pending.keys()]) flushOne(n); },
    get sentCount() { return sent; },
    get pendingCount() { return pending.size; },
  };
}
