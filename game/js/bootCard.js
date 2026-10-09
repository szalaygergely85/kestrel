// Boot loading card (owner request 2026-10-08): a DOM <pre> with an ASCII progress bar + the current phase label, driven by
// engine/core/bootProgress.js. Removed at the first frame. Not created on capture/bench/gpucompare pages (main.js decides).
import { createBootProgress, asciiBar } from '../../engine/index.js';

/** @returns {{progress: ReturnType<typeof createBootProgress>, paint: () => Promise<void>, setStageLines: (text: string) => void}} */
export function createBootCard(doc = document) {
  const el = doc.createElement('pre');
  el.id = 'bootcard';
  el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);margin:0;padding:14px 20px;z-index:50;' +
    'font:16px/1.5 Consolas,"DejaVu Sans Mono",monospace;color:#e8d9a8;background:rgba(10,8,6,.92);border:1px solid #6b5a30;text-align:center;white-space:pre;pointer-events:none';
  doc.body.appendChild(el);
  let lastState = null, stageLines = ''; // S8-B1-20: per-stage ms (bootStageTimer.cardText()), redrawn under the bar
  function render() {
    if (!lastState || lastState.done) return;
    el.textContent = `ASCII QUEST\n\n${asciiBar(lastState.value)}\n${lastState.label}${stageLines ? '\n\n' + stageLines : ''}`;
  }
  const progress = createBootProgress((s) => {
    lastState = s;
    if (s.done) { el.remove(); return; }
    render();
  });
  progress.phase('content');
  // let the browser paint the new state before the next (possibly long) step
  const paint = () => new Promise((res) => { const t = setTimeout(res, 50); requestAnimationFrame(() => { clearTimeout(t); setTimeout(res, 0); }); });
  /** S8-B1-20: set the per-stage timing block under the bar (bootStageTimer.cardText()); redraws immediately. */
  function setStageLines(text) { stageLines = text; render(); }
  return { progress, paint, setStageLines };
}
