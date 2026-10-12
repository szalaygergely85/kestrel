// OB-079: autosave when the owner quits (pagehide / tab hidden) so Continue resumes the LAST session.
// Pure: DOM events are wired in main.js. Same guard as the 60 s autosave (canSave) plus "not on the title menu".
/**
 * @param {{canSave:()=>boolean, titleActive:()=>boolean, save:()=>*}} o
 * @returns {{onPageHide:()=>boolean, onVisibility:(hidden:boolean)=>boolean}} each returns true when a save was written
 */
export function createQuitSave({ canSave, titleActive, save }) {
  const run = () => {
    if (titleActive() || !canSave()) return false;
    // OB-079: save() -> relay.save -> adapter.writeSlot is fully synchronous (localStorage setItem), so it finishes inside pagehide
    try { save(); } catch (e) { return false; } // never throw out of an unload handler
    return true;
  };
  return { onPageHide: run, onVisibility: (hidden) => (hidden ? run() : false) };
}
