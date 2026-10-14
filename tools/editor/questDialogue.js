// tools/editor/questDialogue.js - ED-QUEST-06. DOM section of the quest panel: dialogue lines of the open quest as editable rows
// with a live "n / 56" counter, add / delete / reorder, and the "Changed text" list for the writer. Logic lives in quest/lines.js.
import { LINE_MAX, lineLength, lineRows, setLine, addLine, deleteLine, moveLine, changedLines, exportChangedText } from './quest/lines.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** Trims text to LINE_MAX characters (typing past the cap is refused in the input). */
export const clampLine = (t) => { const a = [...t]; return a.length > LINE_MAX ? a.slice(0, LINE_MAX).join('') : t; };

/**
 * ctx = { q, dm, base, model, names, run(cmd), setMsg(text) }; returns the section element.
 * `run` pushes one undoable command and redraws the panel.
 */
export function renderLineEditor(ctx) {
  const { q, dm, base, model, names, run, setMsg } = ctx;
  const box = el('div', 'q-lines'); box.id = 'quest-lines';
  box.append(el('b', null, 'Dialogue lines'));
  const rows = lineRows(q, dm, names);
  const last = {};
  for (const r of rows) last[r.key] = r.index;
  let group = '';
  for (const r of rows) {
    const g = r.stage + '|' + r.key;
    if (g !== group) { group = g; box.append(el('div', 'q-lines-head', `${r.stage} - ${r.speaker || 'no speaker'}`)); }
    const row = el('div', 'q-line'); row.dataset.key = r.key; row.dataset.index = r.index;
    const inp = el('input'); inp.type = 'text'; inp.value = r.text; inp.size = 60;
    const cnt = el('span', 'q-count' + (r.over ? ' over' : ''), `${r.count} / ${LINE_MAX}`);
    const update = () => {
      const c = clampLine(inp.value);
      if (c !== inp.value) { inp.value = c; setMsg(`Limit is ${LINE_MAX} characters.`); }
      cnt.textContent = `${lineLength(inp.value)} / ${LINE_MAX}`; cnt.classList.toggle('over', lineLength(inp.value) > LINE_MAX);
    };
    inp.addEventListener('input', update);
    inp.addEventListener('change', () => {
      const res = setLine(q, r.key, r.index, inp.value, dm);
      if (res.error) { setMsg(res.error); inp.value = r.text; update(); } else { setMsg(''); run(res.cmd); }
    });
    const act = (label, fn) => { const b = el('button', 'ed-btn', label); b.addEventListener('click', () => { const res = fn(); if (res.error) setMsg(res.error); else { setMsg(''); run(res.cmd); } }); return b; };
    const up = act('Up', () => moveLine(q, r.key, r.index, r.index - 1, dm)), dn = act('Down', () => moveLine(q, r.key, r.index, r.index + 1, dm));
    up.disabled = r.index === 0; dn.disabled = r.index === last[r.key];
    row.append(el('span', 'q-speaker', r.speaker), inp, cnt, up, dn, act('Delete', () => deleteLine(q, r.key, r.index, dm)));
    box.append(row);
    if (r.index === last[r.key]) box.append(act('Add line to ' + r.stage.toLowerCase(), () => addLine(q, r.key, '', dm)));
  }
  if (!rows.length) box.append(el('div', 'q-hint', 'This quest has no dialogue lines yet.'));
  // Changed text list (all quests + dialogue files) for the writer
  const ch = changedLines(model, dm, base, names), text = exportChangedText(ch);
  const list = el('pre', 'q-changed', text); list.id = 'quest-changed';
  const exp = el('button', 'ed-btn', 'Export changed text'); exp.id = 'quest-changed-export';
  exp.addEventListener('click', () => {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'changed-text.txt'; a.click(); URL.revokeObjectURL(a.href);
  });
  box.append(el('b', null, `Changed text (${ch.length})`), list, exp);
  return box;
}
