// CH1-09 (architecture.md 38.37 item 7): chapter-complete card + journal hand-off. A pure state machine + draw in the
// end.js timing style. No main.js import: main hands in `world`, `openNote` (noteRead's opener), `isNoteOpen`.
//   idle -> dim (1.0 s, scene to 50 %) -> type (title, name, next line at TYPE_CPS) -> hold (2 s) -> journal (note panel
//   open; E/Esc closes it in noteRead) -> done (dim fades out, play continues, input unlocked).
// Flags (saved in world.state): chapter.ch1.done = true, chapter.next = 'ch2'. trigger() is a no-op when the flag is
// already set, so a loaded finished save never replays the card ("shows once, never on load").
import { TYPE_CPS } from './end.js';

export const DIM_SEC = 1.0, HOLD_SEC = 2.0, DIM_MUL = 0.5, UNDIM_SEC = 0.3;
export const CHAPTER_TEXT = Object.freeze({
  title: 'CHAPTER COMPLETE', name: 'Beyond the Wall', next: 'Next chapter: The River and the Forgotten',
  journalId: 'journalCh1',
});
export const FLAG_DONE = 'chapter.ch1.done', FLAG_NEXT = 'chapter.next';
const LINE_GAP = 2;

/**
 * @param {{world:{state:Object}, openNote:(id:string)=>void, isNoteOpen:()=>boolean, setFlag?:(k:string,v:any)=>void,
 *   text?:Partial<typeof CHAPTER_TEXT>, cps?:number, fg?:string, bg?:string}} o
 */
export function createChapterCard({ world, openNote, isNoteOpen, setFlag = null, text = {}, cps = TYPE_CPS, fg = '#e8e2d0', bg = '#000000' }) {
  const T = { ...CHAPTER_TEXT, ...text };
  const lines = [T.title, T.name, T.next];
  const total = lines[0].length + lines[1].length + lines[2].length;
  let state = 'idle', t = 0, undim = 0;
  const isDone = () => state === 'idle' ? !!world.state[FLAG_DONE] : state === 'done';

  /** Call when the main quest completes. Returns false (and does nothing) if the card already ran / was saved done. */
  function trigger() {
    if (state !== 'idle' || world.state[FLAG_DONE]) return false;
    world.state[FLAG_DONE] = true; world.state[FLAG_NEXT] = 'ch2';
    if (setFlag) { setFlag(FLAG_DONE, true); setFlag(FLAG_NEXT, 'ch2'); }
    state = 'dim'; t = 0;
    return true;
  }
  /** Fixed step, dt in seconds. */
  function update(dt) {
    if (state === 'idle') return;
    if (state === 'done') { if (undim > 0) undim = Math.max(0, undim - dt / UNDIM_SEC); return; }
    t += dt;
    if (state === 'dim' && t >= DIM_SEC) { state = 'type'; t = 0; }
    else if (state === 'type' && t * cps >= total) { state = 'hold'; t = 0; }
    else if (state === 'hold' && t >= HOLD_SEC) { state = 'journal'; t = 0; openNote(T.journalId); }
    else if (state === 'journal' && t > 0.05 && !isNoteOpen()) { state = 'done'; undim = 1; }
  }
  /** Input gate: true from trigger until the journal is closed. */
  function isLocked() { return state !== 'idle' && state !== 'done'; }
  /** Whole-scene dim like pushNoteDim: dim.all = min(dim.all, mul). */
  function pushDim(dim) {
    let k = 0;
    if (state === 'dim') k = Math.min(1, t / DIM_SEC);
    else if (state === 'type' || state === 'hold' || state === 'journal') k = 1;
    else if (state === 'done') k = undim;
    if (k <= 0 || !dim) return;
    const mul = 1 + (DIM_MUL - 1) * k;
    if (mul < dim.all) dim.all = mul;
  }
  /** Typed card text (no allocation: setCell per char). Hidden once the journal opens. */
  function draw(ui) {
    if (state !== 'type' && state !== 'hold') return;
    let n = state === 'hold' ? total : Math.min(total, Math.floor(t * cps));
    const y0 = Math.floor(ui.rows / 2) - 2;
    for (let li = 0; li < 3 && n > 0; li++) {
      const s = lines[li], x0 = Math.floor((ui.cols - s.length) / 2), y = y0 + li * LINE_GAP;
      const m = n < s.length ? n : s.length;
      for (let i = 0; i < m; i++) ui.setCell(x0 + i, y, s[i], fg, bg);
      n -= s.length;
    }
  }
  return { trigger, update, isLocked, pushDim, draw, isDone, state: () => state, text: () => lines.slice() };
}
