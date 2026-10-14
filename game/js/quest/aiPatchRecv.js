// ED-AI-RECV - game side of the editor's live creature edits (ED-AI-03 patchBridge). Pure: the channel and the sim
// are injected. Receives { type:'ai-patch', name, fields } on BroadcastChannel 'kestrel-ai-patch', calls
// sim.patchArchetype(name, fields) and answers { type:'ai-patch-result', name, ok, refused:[text] }.
export const AI_PATCH_CHANNEL = 'kestrel-ai-patch';

/** channelFactory(name) -> channel ({postMessage, onmessage, close?}) or null; getSim() -> current sim (read per message). */
export function create(channelFactory, getSim) {
  let ch = null;
  try { ch = channelFactory ? channelFactory(AI_PATCH_CHANNEL) : null; } catch (e) { ch = null; }
  if (!ch) return { active: false, close() {} };
  const reply = (name, ok, refused) => ch.postMessage({ type: 'ai-patch-result', name, ok, refused });
  ch.onmessage = (ev) => {
    const m = ev && ev.data;
    if (!m || m.type !== 'ai-patch') return;
    const name = String(m.name);
    const sim = getSim();
    if (!sim || typeof sim.patchArchetype !== 'function') return reply(name, false, ['game has no creature sim loaded yet']);
    let r;
    try { r = sim.patchArchetype(name, m.fields || {}); } catch (e) { return reply(name, false, ['patch failed: ' + (e && e.message || e)]); }
    const errs = (r && r.errors) || [];
    reply(name, !!(r && r.ok), errs.map((x) => (typeof x === 'string' ? x : (x && (x.message || x.msg)) || JSON.stringify(x))));
  };
  return { active: true, close() { ch.onmessage = null; if (ch.close) ch.close(); } };
}

/** Browser glue: real BroadcastChannel, or null when missing. */
export const broadcastFactory = (name) => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null);
