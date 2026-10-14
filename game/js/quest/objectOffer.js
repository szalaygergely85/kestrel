// objectOffer.js (QFIX-S5-CLOSE): the pinned keep-light page is read through the note UI (note.read), not through errands.inspected,
// so the objectGiver offer (D-087 Accept/Exit) is opened when that note closes while its quest is still available.
// Every other objectGiver (notePost, gondola, packet, owBoard, pierStone) is inspected via errands -> main.inspectObject -> book.inspect -> 'offer'.
const AVAILABLE = 1; // questBook statusOf

/** @param {{getBook:()=>any, inspect:(id:string)=>any}} o  inspect = main's inspectObject (opens the offer dialogue on 'offer') */
export function createNoteOffer({ getBook, inspect, noteId = 'keepLight', objectId = 'noteKeepLight' }) {
  let prev = null;
  return {
    /** Call every step with getOpenNoteId(); fires inspect(objectId) on the close edge of the note. Returns true when it fired. */
    step(openId) {
      const closed = prev === noteId && openId !== noteId; prev = openId || null;
      if (!closed) return false;
      const b = getBook(); if (!b) return false;
      const r = b.inspect(objectId); // 'offer' only while available; never accepts for objectGiver quests
      if (r && r.action === 'offer') { inspect(objectId); return true; }
      return false;
    },
  };
}
