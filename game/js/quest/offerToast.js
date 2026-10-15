// game/js/quest/offerToast.js - "New quest: <Name> has work for you" once per derived next offer (book.nextOffers()).
// seed() records the offers that already exist (call once after load: no toast for them); poll() returns the offers that
// appeared since the last call (cheap: gated on book.version, safe to call every frame) and remembers them so each toasts once.
export function createOfferToast(book, giverName) {
  const seen = new Set();
  let ver = -1;
  const scratch = []; // reused by poll(): 0 alloc per frame; valid until the next poll()
  const list = () => (book && book.nextOffers ? book.nextOffers() : []);
  return {
    seed() { seen.clear(); ver = book ? book.version : -1; for (const o of list()) seen.add(o.id); },
    /** @returns {string[]} toast lines for offers that are new since the last seed()/poll() */
    poll() {
      const out = scratch; out.length = 0;
      if (!book || book.version === ver) return out; // cheap per-frame call: only re-derive when the book changed
      ver = book.version;
      for (const o of list()) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        out.push('New quest: ' + giverName(o.giver) + ' has work for you');
      }
      return out;
    },
  };
}
