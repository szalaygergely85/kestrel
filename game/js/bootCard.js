// Boot loading card (owner request 2026-10-08): a DOM <pre> with an ASCII progress bar + the current phase label, driven by
// engine/core/bootProgress.js. Removed at the first frame. Not created on capture/bench/gpucompare pages (main.js decides).
import { createBootProgress, asciiBar } from '../../engine/index.js';

/** @returns {{progress: ReturnType<typeof createBootProgress>, paint: () => Promise<void>}} */
export function createBootCard(doc = document) {
  const el = doc.createElement('pre');
  el.id = 'bootcard';
  el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);margin:0;padding:14px 20px;z-index:50;' +
    'font:16px/1.5 Consolas,"DejaVu Sans Mono",monospace;color:#e8d9a8;background:rgba(10,8,6,.92);border:1px solid #6b5a30;text-align:center;white-space:pre;pointer-events:none';
  doc.body.appendChild(el);
  const progress = createBootProgress((s) => {
    if (s.done) { el.remove(); return; }
    el.textContent = `ASCII QUEST\n\n${asciiBar(s.value)}\n${s.label}`;
  });
  progress.phase('content');
  // let the browser paint the new state before the next (possibly long) step
  const paint = () => new Promise((res) => { const t = setTimeout(res, 50); requestAnimationFrame(() => { clearTimeout(t); setTimeout(res, 0); }); });
  return { progress, paint };
}
