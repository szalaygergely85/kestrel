// game/js/quest/questInspect.js (QL-04). Behaviour `quest.inspect` for any level prop / interactable:
// `{ interact: 'quest.inspect', objectId: '<giver or hand-in object id>', prompt: '[E] Inspect <name>' }`. It only forwards the
// object id to the game's sink (main.js: book.inspect -> accept / hand-in + a short notice text). No dialogue, never locks.
let sink = null;
export function setInspectSink(fn) { sink = typeof fn === 'function' ? fn : null; }
export function questInspect(ctx) {
  const id = ctx && ctx.def && ctx.def.objectId;
  if (typeof id !== 'string' || !id || !sink) return false;
  sink(id);
  return true;
}
/** Word-wrap `text` to lines of at most `w` chars (notice view limit 38). */
export function wrapText(text, w = 38) {
  const out = []; let cur = '';
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + word.length > w) { out.push(cur); cur = word; } else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) out.push(cur);
  return out;
}
