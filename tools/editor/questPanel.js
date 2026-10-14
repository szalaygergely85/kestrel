// tools/editor/questPanel.js - ED-QUEST-02. Thin DOM over quest/flow.js + quest/edit.js + quest/model.js.
// mountQuestPanel(root, { names, itemDefs, loadFiles, write }):
//   loadFiles() -> Promise<{ 'm1.quest.json': text, 'ch12/pack.json': text, 'sites.json': text, ... }>
//   write(relPath, text) persists one quest file (editor supplies its own io; default = download).
import { loadQuests, saveQuest, makeStack } from './quest/model.js';
import { questRows, filterRows, buildFlow, itemChoices, objText, objJournal } from './quest/flow.js';
import * as ed from './quest/edit.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** In-memory fs over a {path: text} map, so model.js loads without node:fs. */
function memFs(files) {
  const names = Object.keys(files);
  const dirs = new Set(names.filter((n) => n.includes('/')).map((n) => n.split('/')[0]));
  const key = (p) => p.replace(/^q\//, '');
  return {
    readFileSync: (p) => { const k = key(p); if (!(k in files)) throw new Error('missing ' + k); return files[k]; },
    readdirSync: () => [...new Set(names.map((n) => n.split('/')[0]))],
    existsSync: (p) => key(p) in files,
    statSync: (p) => ({ isDirectory: () => dirs.has(key(p)) }),
  };
}

export async function mountQuestPanel(root, opts) {
  const { names, itemDefs, loadFiles, write } = opts;
  const files = await loadFiles();
  const model = loadQuests('q', memFs(files));
  const stack = makeStack();
  let current = null, filter = '';

  root.textContent = '';
  const bar = el('div', 'q-bar');
  const search = el('input'); search.type = 'text'; search.placeholder = 'filter title / id / giver...'; search.id = 'quest-filter';
  const newBtn = el('button', 'ed-btn', 'New quest'); newBtn.id = 'quest-new';
  bar.append(search, newBtn);
  const list = el('div', 'q-list'); list.id = 'quest-list';
  const detail = el('div', 'q-detail'); detail.id = 'quest-detail';
  root.append(bar, list, detail);

  const redraw = () => { renderList(); renderDetail(); };
  const run = (cmd) => { stack.run(cmd); redraw(); };

  function renderList() {
    list.textContent = '';
    for (const r of filterRows(questRows(model.quests, names), filter)) {
      const row = el('div', 'q-row' + (current && current.id === r.id ? ' active' : ''));
      row.dataset.qid = r.id;
      row.append(el('span', 'q-chip ' + r.chip, r.side ? 'side' : 'main'), el('span', 'q-title', r.title), el('span', 'q-meta', ` ${r.id} - ${r.region}`));
      row.addEventListener('click', () => { current = model.quests.find((x) => x.id === r.id); redraw(); });
      list.append(row);
    }
  }

  function field(label, value, onCommit, multiline) {
    const wrap = el('label', 'q-field'); wrap.append(el('span', null, label));
    const inp = el(multiline ? 'textarea' : 'input'); inp.value = value;
    inp.addEventListener('change', () => onCommit(inp.value));   // blur/enter = one undo step
    wrap.append(inp); return wrap;
  }

  function renderDetail() {
    detail.textContent = '';
    const q = current;
    if (!q) { detail.append(el('div', 'q-hint', 'Pick a quest.')); return; }
    const flow = el('pre', 'q-flow'); flow.id = 'quest-flow';
    flow.textContent = buildFlow(q, names).map((n) => n.label + (n.detail ? '\n    ' + n.detail : '')).join('\n  v\n');
    detail.append(flow);
    detail.append(field('Title', q.title, (v) => run(ed.setTitle(q, v))));
    detail.append(field('Offer (Accept / Exit text, one line each)', ((q.lines && q.lines.offer) || []).join('\n'), (v) => run(ed.setOfferLines(q, v.split('\n'))), true));
    q.objectives.forEach((o, i) => {
      const box = el('div', 'q-obj'); box.append(el('b', null, `Step ${i + 1}`));
      box.append(field('Text', objText(o), (v) => run(ed.setObjectiveField(q, i, 'text', v))));
      box.append(field('Journal', objJournal(o), (v) => run(ed.setObjectiveField(q, i, 'journal', v)), true));
      const up = el('button', 'ed-btn', 'Up'), dn = el('button', 'ed-btn', 'Down'), del = el('button', 'ed-btn', 'Delete');
      up.disabled = i === 0; dn.disabled = i === q.objectives.length - 1;
      up.addEventListener('click', () => run(ed.moveStep(q, i, i - 1)));
      dn.addEventListener('click', () => run(ed.moveStep(q, i, i + 1)));
      del.addEventListener('click', () => run(ed.deleteStep(q, i)));
      box.append(up, dn, del); detail.append(box);
    });
    const add = el('button', 'ed-btn', 'Add step'); add.addEventListener('click', () => run(ed.addStep(q)));
    detail.append(add);
    detail.append(field('Return text', q.returnText || '', (v) => run(ed.setReturnText(q, v))));
    // reward item: picked by plain name, never a raw id
    const cur = q.reward && q.reward.items && q.reward.items[0];
    const sel = el('select'); sel.id = 'quest-reward';
    sel.append(new Option('(no item)', ''));
    for (const c of itemChoices(itemDefs)) sel.append(new Option(c.name, c.id));
    sel.value = cur ? cur.id : '';
    const cnt = el('input'); cnt.type = 'number'; cnt.min = 1; cnt.value = cur ? cur.n : 1; cnt.style.width = '4em';
    const setReward = () => run(ed.setRewardItem(q, sel.value, Number(cnt.value) || 1));
    sel.addEventListener('change', setReward); cnt.addEventListener('change', setReward);
    const rw = el('label', 'q-field'); rw.append(el('span', null, 'Reward'), sel, cnt); detail.append(rw);
    const tools = el('div', 'q-tools');
    const undo = el('button', 'ed-btn', 'Undo'), redo = el('button', 'ed-btn', 'Redo'), save = el('button', 'ed-btn', 'Save'); save.id = 'quest-save';
    undo.addEventListener('click', () => { stack.undo(); redraw(); });
    redo.addEventListener('click', () => { stack.redo(); redraw(); });
    const msg = el('span', 'q-msg');
    save.addEventListener('click', () => {
      const r = saveQuest(model, q, { writeFileSync: (p, t) => write(p.replace(/^q\//, ''), t) });
      msg.textContent = r.ok ? 'Saved ' + r.file : r.errors.join('; ');
    });
    tools.append(undo, redo, save, msg); detail.append(tools);
  }

  search.addEventListener('input', () => { filter = search.value; renderList(); });
  newBtn.addEventListener('click', () => { const c = ed.newSideQuest(model); stack.run(c); current = c.quest; redraw(); });
  redraw();
  return { model, stack, select: (id) => { current = model.quests.find((x) => x.id === id); redraw(); } };
}

/** Default loader: content/quests/index.json lists packs + legacy files; plain fetch from the page's server. */
export async function fetchQuestFiles(base = '../../content/quests/') {
  const get = async (p) => { const r = await fetch(base + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.text(); };
  const idx = JSON.parse(await get('index.json'));
  const files = { 'sites.json': await get('sites.json') };
  for (const n of idx.legacy) files[n + '.quest.json'] = await get(n + '.quest.json');
  for (const p of idx.packs) files[p + '/pack.json'] = await get(p + '/pack.json');
  return files;
}

/** Default writer: browser download (the editor has no repo-wide fs); the owner drops the file into content/quests. */
export function downloadWrite(rel, text) {
  const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = rel.replace(/\//g, '_'); a.click(); URL.revokeObjectURL(a.href);
}
