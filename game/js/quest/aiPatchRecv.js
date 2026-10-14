// ED-AI-RECV - game side of the editor's live creature edits (ED-AI-03 patchBridge). Pure: the channel and the sim
// are injected. Receives { type:'ai-patch', name, fields } on BroadcastChannel 'kestrel-ai-patch', calls
// sim.patchArchetype(name, fields) and answers { type:'ai-patch-result', name, ok, refused:[text] }.
import { dropPack, clearTest } from './sim/aiTest.js';
export const AI_PATCH_CHANNEL = 'kestrel-ai-patch';

/** channelFactory(name) -> channel ({postMessage, onmessage, close?}) or null; getSim() -> current sim (read per message). */
export function create(channelFactory, getSim) {
  let ch = null;
  try { ch = channelFactory ? channelFactory(AI_PATCH_CHANNEL) : null; } catch (e) { ch = null; }
  if (!ch) return { active: false, close() {} };
  const reply = (name, ok, refused) => ch.postMessage({ type: 'ai-patch-result', name, ok, refused });
  // ED-AI-06: 'ai-drop' {kind,count,x,y,seed} wakes reserve slots at the point; 'ai-clear' parks them again. Never saved.
  const handleDrop = (m) => {
    const sim = getSim();
    if (!sim || !sim.groups) return ch.postMessage({ type: 'ai-drop-result', ok: false, n: 0, text: 'game has no creature sim loaded yet' });
    try {
      if (m.type === 'ai-clear') return ch.postMessage({ type: 'ai-drop-result', ok: true, n: clearTest(sim), text: 'cleared' });
      const n = dropPack(sim, { kind: String(m.kind), count: m.count, x: +m.x, y: +m.y, seed: m.seed | 0 }).length;
      ch.postMessage({ type: 'ai-drop-result', ok: n > 0, n, text: n ? '' : 'No free test creature of that kind here (or not walkable).' });
    } catch (e) { ch.postMessage({ type: 'ai-drop-result', ok: false, n: 0, text: 'drop failed: ' + (e && e.message || e) }); }
  };
  ch.onmessage = (ev) => {
    const m = ev && ev.data;
    if (m && (m.type === 'ai-drop' || m.type === 'ai-clear')) return handleDrop(m);
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
