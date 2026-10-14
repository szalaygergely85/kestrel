// tools/editor/logicPanel.js - ED-LOGIC-02b (arch 38.70). Thin DOM over logic/model.js + logic/view.js.
// mountLogicPanel(root, { schema, loadFiles, write, getWorld, getAreaGeo, choices })
//   loadFiles() -> { 'x.logic.json': text }; write(name, text); choices = { quest:[{id,name}], item:[{id,name}] }
//   getAreaGeo() -> { areaId: {x,y,r} } for picking an area by clicking the ground.
import { loadLogic, saveAll, isDirty, makeStack, addBlock, deleteBlock, moveBlock, setBlockField, setWhen, addItem, deleteItem, moveItem, setArg } from './logic/model.js';
import { entries, entryOf, argLabel, parseType, defaultItem, itemText, refFromPick, buildRefs, lintLogic, PICKABLE, KEY } from './logic/view.js';
import { createQuestPicker } from './questPick.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const memFs = (files) => ({ readFileSync: (p) => files[p.split('/').pop()], readdirSync: () => Object.keys(files) });
export async function fetchLogicFiles(base = '../../content/logic/') {
  const out = {};
  let idx = { files: [] };
  try { idx = JSON.parse(await (await fetch(base + 'index.json')).text()); } catch { /* no logic files yet */ }
  for (const n of idx.files) { const r = await fetch(base + n); if (r.ok) out[n] = await r.text(); }
  return out;
}
export const downloadLogic = (name, text) => { const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

export async function mountLogicPanel(root, opts) {
  const { schema, write, getWorld = () => ({ entities: [] }), choices = {}, getAreaGeo = () => ({}) } = opts;
  const model = loadLogic('l', memFs(await opts.loadFiles()));
  const stack = makeStack();
  let cur = null, msg = '', pickMsg = '';
  const find = (kind, v) => { const c = (choices[kind] || []).find((x) => x.id === v); return c && c.name; };
  const nameOf = { quest: (v) => find('quest', v), item: (v) => find('item', v) };
  const picker = createQuestPicker({
    onState: () => redraw(),
    onHit: (slot, hit) => {
      const r = refFromPick(slot.ref, hit, getWorld(), getAreaGeo());
      if (r.error) { pickMsg = r.error; redraw(); return false; }
      pickMsg = ''; run(setArg(cur, slot.id, slot.sec, slot.idx, slot.arg, r.value)); return true;
    },
  });
  root.textContent = '';
  const head = el('div', 'lg-bar'), body = el('div', 'lg-body'); body.id = 'logic-body';
  root.append(head, body);
  const run = (cmd) => { stack.run(cmd); redraw(); };
  const refs = () => buildRefs({ world: getWorld(), areas: getAreaGeo(), quests: choices.quest && choices.quest.map((c) => c.id), itemDefs: choices.item && Object.fromEntries(choices.item.map((c) => [c.id, 1])) });

  function argEditor(blk, sec, idx, item, arg, spec) {
    const t = parseType(spec), wrap = el('label', 'lg-arg'); wrap.append(el('span', null, argLabel(schema, arg) + ' '));
    const set = (v) => run(setArg(cur, blk.id, sec, idx, arg, v));
    const val = item[arg];
    let inp;
    if (t.kind === 'int') { inp = el('input'); inp.type = 'number'; inp.value = val ?? ''; inp.style.width = '5em'; inp.addEventListener('change', () => set(inp.value === '' ? undefined : Math.trunc(Number(inp.value)))); }
    else if (t.kind === 'bool') { inp = el('input'); inp.type = 'checkbox'; inp.checked = val === true; inp.addEventListener('change', () => set(inp.checked)); }
    else if (t.kind === 'enum') { inp = el('select'); for (const o of t.options) inp.append(new Option(o, o)); inp.value = val; inp.addEventListener('change', () => set(inp.value)); }
    else if (t.kind === 'ref' && choices[t.ref]) { inp = el('select'); inp.append(new Option(t.optional ? '(any)' : '(choose)', '')); for (const c of choices[t.ref]) inp.append(new Option(c.name, c.id)); inp.value = val || ''; inp.addEventListener('change', () => set(inp.value || undefined)); }
    else { inp = el('input'); inp.type = 'text'; inp.value = val ?? ''; inp.addEventListener('change', () => set(inp.value === '' ? undefined : inp.value)); }
    inp.dataset.arg = arg; wrap.append(inp);
    if (t.kind === 'ref' && PICKABLE.has(t.ref)) {
      const slot = { id: blk.id, sec, idx, arg, ref: t.ref };
      const s = picker.slot, same = s && s.id === blk.id && s.sec === sec && s.idx === idx && s.arg === arg;
      const b = el('button', 'ed-btn' + (same ? ' active' : ''), 'Pick'); b.title = 'Click in the 3D view (Esc cancels)'; b.dataset.pick = arg;
      b.addEventListener('click', () => { pickMsg = ''; if (same) picker.cancel(); else picker.arm(slot); });
      wrap.append(b);
      if (val) wrap.append(el('span', 'lg-val', ' ' + (val)));
    }
    return wrap;
  }

  function itemRow(blk, sec, idx, item) {
    const row = el('div', 'lg-row'); row.dataset.sec = sec; row.dataset.idx = idx;
    if (item.is === 'not') row.append(el('span', null, itemText(schema, sec, item, nameOf)));
    else {
      const sel = el('select'); sel.dataset.kind = sec;
      for (const e of entries(schema, sec)) sel.append(new Option(e.label, e.name));
      sel.value = item[KEY[sec]];
      sel.addEventListener('change', () => {
        const fresh = defaultItem(schema, sec, sel.value);
        if (sec === 'when') run(setWhen(cur, blk.id, fresh));
        else { stack.run(deleteItem(cur, blk.id, sec, idx)); run(addItem(cur, blk.id, sec, fresh, idx)); }
      });
      row.append(sel);
      const e = entryOf(schema, sec, item[KEY[sec]]);
      if (e) for (const a of Object.keys(e.args)) row.append(argEditor(blk, sec, idx, item, a, e.args[a]));
      if (sec === 'do') row.append(argEditor(blk, sec, idx, item, 'after', 'int?'));
    }
    if (sec !== 'when') {
      const list = blk[sec], mk = (t, fn, dis) => { const b = el('button', 'ed-btn', t); b.disabled = !!dis; b.addEventListener('click', fn); row.append(b); };
      mk('Up', () => run(moveItem(cur, blk.id, sec, idx, idx - 1)), idx === 0);
      mk('Down', () => run(moveItem(cur, blk.id, sec, idx, idx + 1)), idx === list.length - 1);
      mk('Delete', () => run(deleteItem(cur, blk.id, sec, idx)));
    }
    return row;
  }

  function section(blk, sec, title, addLabel) {
    const box = el('div', 'lg-sec'); box.append(el('b', null, title));
    if (sec === 'when') box.append(itemRow(blk, 'when', 0, blk.when || { on: entries(schema, 'when')[0].name }));
    else {
      (blk[sec] || []).forEach((it, i) => box.append(itemRow(blk, sec, i, it)));
      const add = el('button', 'ed-btn', addLabel); add.dataset.add = sec;
      add.addEventListener('click', () => run(addItem(cur, blk.id, sec, defaultItem(schema, sec, entries(schema, sec)[0].name))));
      box.append(add);
    }
    return box;
  }

  function blockBox(blk, i, n) {
    const box = el('div', 'lg-block'); box.dataset.block = blk.id;
    const nm = el('input'); nm.type = 'text'; nm.value = blk.name || ''; nm.placeholder = 'Name'; nm.dataset.field = 'name';
    nm.addEventListener('change', () => run(setBlockField(cur, blk.id, 'name', nm.value || undefined)));
    const once = el('input'); once.type = 'checkbox'; once.checked = blk.once === true; once.addEventListener('change', () => run(setBlockField(cur, blk.id, 'once', once.checked ? true : undefined)));
    const ol = el('label', null, ' Only once'); ol.prepend(once);
    const h = el('div', 'lg-head'); h.append(nm, ol);
    const mk = (t, fn, dis) => { const b = el('button', 'ed-btn', t); b.disabled = !!dis; b.addEventListener('click', fn); h.append(b); };
    mk('Up', () => run(moveBlock(cur, i, i - 1)), i === 0); mk('Down', () => run(moveBlock(cur, i, i + 1)), i === n - 1); mk('Delete', () => run(deleteBlock(cur, blk.id)));
    box.append(h, section(blk, 'when', 'When', ''), section(blk, 'if', 'If (all must hold)', 'Add condition'), section(blk, 'do', 'Do', 'Add action'));
    return box;
  }

  function goTo(t) {
    const f = model.files.get(t.file); if (f) cur = f;
    redraw();
    const b = body.querySelector('[data-block="' + t.id + '"]'); if (!b) return;
    if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
    const r = t.sec && t.idx >= 0 ? b.querySelector('[data-sec="' + t.sec + '"][data-idx="' + t.idx + '"]') : null;
    (r || b).classList.add('lg-flash');
  }

  function redraw() {
    head.textContent = ''; body.textContent = '';
    const fsel = el('select'); fsel.id = 'logic-file';
    for (const f of model.files.values()) fsel.append(new Option(f.name + (isDirty(f) ? ' *' : ''), f.name));
    if (!cur) cur = model.files.values().next().value || null;
    if (cur) fsel.value = cur.name;
    fsel.addEventListener('change', () => { cur = model.files.get(fsel.value); redraw(); });
    const mk = (t, id, fn) => { const b = el('button', 'ed-btn', t); b.id = id; b.addEventListener('click', fn); head.append(b); return b; };
    head.append(fsel);
    if (!cur) { body.append(el('div', 'q-hint', 'No logic files.')); return; }
    mk('New block', 'logic-new', () => {
      let n = 1; const ids = new Set(cur.blocks.map((b) => b.id)); while (ids.has('block.' + n)) n++;
      run(addBlock(cur, { id: 'block.' + n, name: 'New block', when: defaultItem(schema, 'when', entries(schema, 'when')[0].name), if: [], do: [] }));
    });
    mk('Undo', 'logic-undo', () => { stack.undo(); redraw(); }); mk('Redo', 'logic-redo', () => { stack.redo(); redraw(); });
    mk('Save', 'logic-save', () => { const r = saveAll(model, { writeFileSync: (p, t) => write(p.split('/').pop(), t) }); msg = r.written.length ? 'Saved ' + r.written.join(', ') : 'Nothing to save'; redraw(); });
    const pm = el('div', 'q-msg', picker.armed ? 'Click in the 3D view (Esc cancels)' : (pickMsg || msg)); pm.id = 'logic-msg'; body.append(pm);
    const problems = lintLogic(model, schema, refs()), lint = el('div', 'q-lint'); lint.id = 'logic-lint';
    lint.append(el('b', null, problems.length ? 'Problems (' + problems.length + ')' : 'No problems'));
    for (const p of problems) {
      const r = el('div', 'q-lint-row ' + p.severity); r.dataset.rule = p.rule;
      const go = el('button', 'ed-btn', 'Go to'); go.addEventListener('click', () => goTo(p.target));
      r.append(el('span', null, p.text + ' '), go); lint.append(r);
    }
    body.append(lint);
    cur.blocks.forEach((b, i) => body.append(blockBox(b, i, cur.blocks.length)));
  }
  redraw();
  return { model, stack, picker, redraw, lint: () => lintLogic(model, schema, refs()) };
}
