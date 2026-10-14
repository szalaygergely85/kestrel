// D-098 item 5: quest tracker, top-right. The tracked quest (book.tracked(), else the main quest) with its title and objectives
// ("Kill boars 3/5"). Pure draw over the ui cell API; reuses one scratch array, no per-frame allocation after the first call.
const FG = [236, 226, 190], DONE = [120, 120, 130], TITLE = [240, 200, 90], BG = [10, 11, 16];
const rows_ = [];
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '~' : s);

/** Lines [{text, kind:'title'|'active'|'done'}] for the tracked quest; empty when nothing to show. Pure (Node-testable). */
export function trackerLines(book, maxW = 34, out = []) {
  out.length = 0; if (!book) return out;
  const ti = book.tracked(), qi = ti >= 0 ? ti : 0, def = book.def(qi);
  if (!def || book.status(qi) === 4) return out;
  const obj = book.objectives(qi, rows_), title = def.title || def.name || def.id;
  out.push({ text: clip(title, maxW), kind: 'title' });
  for (let i = 0; i < obj.length; i++) {
    const o = obj[i]; if (o.status === 'locked') continue;
    const cnt = o.target > 1 ? ' ' + o.progress + '/' + o.target : '';
    out.push({ text: clip((o.status === 'complete' ? 'x ' : '- ') + o.text, maxW - cnt.length) + cnt, kind: o.status === 'complete' ? 'done' : 'active' });
  }
  return out;
}

export function drawQuestTracker(ui, cols, book, y0 = 1) {
  const lines = trackerLines(book, Math.min(34, cols - 4));
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k], c = l.kind === 'title' ? TITLE : l.kind === 'done' ? DONE : FG, x0 = cols - 2 - l.text.length;
    for (let j = -1; j <= l.text.length; j++) { const x = x0 + j; if (x >= 0 && x < cols) ui.setCellRGB(x, y0 + k, (j < 0 || j >= l.text.length ? 32 : l.text.charCodeAt(j)) - 32, c[0], c[1], c[2], BG[0], BG[1], BG[2]); }
  }
}
