// tools/editor/questDialogue.js - ED-QUEST-06 / ED-QUI-05. DOM of card [04]: the quest's conversation nodes as terminal-style boxes
// (speaker, node id, quoted editable lines with a live "n / 56" counter, read-only branches) and the "Changed text" list for the writer.
// Logic lives in quest/lines.js (edits) and quest/conversation.js (view model).
import { LINE_MAX, lineLength, setLine, addLine, deleteLine, moveLine, changedLines, exportChangedText } from './quest/lines.js';
import { conversationView, nodeRole } from './quest/conversation.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** Trims text to LINE_MAX characters (typing past the cap is refused in the input). */
export const clampLine = (t) => { const a = [...t]; return a.length > LINE_MAX ? a.slice(0, LINE_MAX).join('') : t; };

/**
 * ctx = { q, dm, base, model, names, run(cmd), setMsg(text) }; returns the section element (#quest-lines).
 * `run` pushes one undoable command and redraws the panel.
 */
export function renderLineEditor(ctx) {
  const { q, dm, base, model, names, run, setMsg } = ctx;
  const box = el('div', 'q-lines'); box.id = 'quest-lines';
  const view = conversationView(dm, q, names);
  const act = (label, fn, cls = 'ed-btn') => { const b = el('button', cls, label); b.addEventListener('click', () => { const res = fn(); if (res.error) setMsg(res.error); else { setMsg(''); run(res.cmd); } }); return b; };
  const grid = el('div', 'q-nodes');
  for (const n of view.nodes) {
    const t = el('div', 'q-node' + (n.branches.some((b) => b.dangling) ? ' bad' : '')); t.dataset.node = n.id;
    const head = el('div', 'q-node-head');
    head.append(el('span', 'q-speaker', '> ' + (n.speaker || 'no speaker')), el('span', 'q-node-id', n.id), el('span', 'q-pill', nodeRole(n)));
    t.append(head);
    if (n.gate) t.append(el('div', 'q-ometa', 'IF ' + n.gate));
    const last = n.lines.length - 1;
    n.lines.forEach((r, i) => {
      const row = el('div', 'q-line'); row.dataset.key = r.key; row.dataset.index = r.index;
      const top = el('div', 'q-line-in'), tools = el('div', 'q-line-tools');
      const inp = el('input'); inp.type = 'text'; inp.value = r.text; if (r.over) inp.classList.add('over');
      const cnt = el('span', 'q-count' + (r.over ? ' over' : ''), `${r.count} / ${LINE_MAX}`);
      const update = () => {
        const c = clampLine(inp.value);
        if (c !== inp.value) { inp.value = c; setMsg(`Limit is ${LINE_MAX} characters.`); }
        const over = lineLength(inp.value) > LINE_MAX;
        cnt.textContent = `${lineLength(inp.value)} / ${LINE_MAX}`; cnt.classList.toggle('over', over); inp.classList.toggle('over', over);   // R19 hit shown red on the line
      };
      inp.addEventListener('input', update);
      inp.addEventListener('change', () => {
        const res = setLine(q, r.key, r.index, inp.value, dm);
        if (res.error) { setMsg(res.error); inp.value = r.text; update(); } else { setMsg(''); run(res.cmd); }
      });
      const up = act('Up', () => moveLine(q, r.key, r.index, r.index - 1, dm)), dn = act('Down', () => moveLine(q, r.key, r.index, r.index + 1, dm));
      up.disabled = i === 0; dn.disabled = i === last;
      top.append(el('span', 'q-quote', '"'), inp, el('span', 'q-quote', '"'));
      tools.append(cnt, up, dn, act('Delete', () => deleteLine(q, r.key, r.index, dm)));   // full row width for the text; counter + buttons right-aligned below
      row.append(top, tools);
      t.append(row);
    });
    t.append(act('Add line to ' + n.stage.toLowerCase(), () => addLine(q, n.key, '', dm)));
    if (n.accept || n.exit) t.append(el('div', 'q-ometa', (n.accept ? 'Accept (E)' : '') + (n.accept && n.exit ? '   ' : '') + (n.exit ? 'Exit (Q)' : '')));
    for (const s of n.sets) t.append(el('div', 'q-branch', 'SETS ' + s));
    for (const b of n.branches) {
      const br = el('div', 'q-branch' + (b.dangling ? ' bad' : '') + (b.accept ? ' accept' : ''));
      br.append(el('span', 'q-btext', b.text ? '[' + b.text + ']' : '[...]'));
      if (b.goto) {
        const g = el('button', 'q-goto', 'GOTO ' + b.goto); g.title = 'Scroll to that node';
        g.addEventListener('click', () => { const tg = box.querySelector('[data-node="' + b.goto.replace(/"/g, '') + '"]'); if (tg && tg.scrollIntoView) tg.scrollIntoView({ block: 'nearest' }); });
        br.append(g);
      }
      if (b.gate) br.append(el('span', 'q-ometa', 'IF ' + b.gate));
      for (const s of b.sets) br.append(el('span', 'q-ometa', 'SETS ' + s));
      t.append(br);
    }
    grid.append(t);
  }
  box.append(grid);
  if (!view.nodes.length) {
    box.append(el('div', 'q-hint', 'This quest has no dialogue lines yet.'));
    box.append(act('Add offer line', () => addLine(q, 'offer', '', dm)));
  }
  for (const p of view.problems) box.append(el('div', 'q-ptext', p));
  // Changed text list (all quests + dialogue files) for the writer
  const ch = changedLines(model, dm, base, names), text = exportChangedText(ch);
  const list = el('pre', 'q-changed', text); list.id = 'quest-changed';
  const exp = el('button', 'ed-btn', 'Export changed text'); exp.id = 'quest-changed-export';
  exp.addEventListener('click', () => {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'changed-text.txt'; a.click(); URL.revokeObjectURL(a.href);
  });
  const det = el('details', 'q-changed-box'); det.append(el('summary', null, `Changed text (${ch.length})`), list, exp);
  box.append(det);
  return box;
}
