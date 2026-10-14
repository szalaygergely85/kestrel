// tools/editor/questPanel.js - ED-QUEST-02. Thin DOM over quest/flow.js + quest/edit.js + quest/model.js.
// mountQuestPanel(root, { names, itemDefs, loadFiles, write }):
//   loadFiles() -> Promise<{ 'm1.quest.json': text, 'ch12/pack.json': text, 'sites.json': text, ... }>
//   write(relPath, text) persists one quest file (editor supplies its own io; default = download).
import { loadQuests, saveQuest, saveAll, applyZones, makeStack } from './quest/model.js';
import { buildLintCtx, liveLint, presetOptions, playUrl } from './quest/wire.js';
import { questRows, filterRows, buildFlow, itemChoices, objText, objJournal } from './quest/flow.js';
import * as ed from './quest/edit.js';
import { applyPick } from './quest/targets.js';
import { createQuestPicker } from './questPick.js';
import { renderLineEditor } from './questDialogue.js';
import { loadDialogues, saveDialogues, captureBaseline } from './quest/lines.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** In-memory fs over a {path: text} map, so model.js loads without node:fs. */
export function memFs(files) {
  const names = Object.keys(files);
  const dirs = new Set(names.filter((n) => n.includes('/')).map((n) => n.split('/')[0]));
  const key = (p) => p.replace(/^[qd]\//, '');
  return {
    readFileSync: (p) => { const k = key(p); if (!(k in files)) throw new Error('missing ' + k); return files[k]; },
    readdirSync: () => [...new Set(names.map((n) => n.split('/')[0]))],
    existsSync: (p) => key(p) in files,
    statSync: (p) => ({ isDirectory: () => dirs.has(key(p)) }),
  };
}

export async function mountQuestPanel(root, opts) {
  const { names, itemDefs, loadFiles, write, getWorld = () => ({ entities: [] }), floorAt } = opts;
  const files = await loadFiles();
  // ED-QUEST-03b: areas.json stays in the model (area picks write it; Save writes it back); the overlay reads the same object
  if (!files['areas.json']) files['areas.json'] = JSON.stringify({ version: 1, areas: {} }, null, 2) + String.fromCharCode(10);
  const model = loadQuests('q', memFs(files));
  const areasFile = model.files.get('areas.json').obj;
  // ED-QUEST-06: dialogue files ({ 'rook.dialogue.json': text }) are optional; line edits write them back via write('dialogue/<name>')
  const dfiles = opts.loadDialogueFiles ? await opts.loadDialogueFiles() : {};
  const dm = loadDialogues('d', memFs(dfiles));
  const lineBase = captureBaseline(model);
  let lineMsg = '';
  const stack = makeStack();
  let current = null, filter = '', pickMsg = '', selObj = -1, showAll = false;   // ED-QUEST-04: selObj = step highlighted in the view
  const sites = (model.files.get('sites.json') || { obj: {} }).obj.sites || {};
  // ED-QUEST-03: Pick mode. A hit from the viewport sets the armed slot via one undoable command.
  const picker = createQuestPicker({
    onState: () => redraw(),
    onHit: (slot, hit) => {
      const r = applyPick(current, slot, hit, getWorld(), { sites, floorAt, model, worldId: opts.worldId });
      if (r.error) { pickMsg = r.error; redraw(); return false; }
      pickMsg = ''; run(r.cmd); return true;
    },
  });

  root.textContent = '';
  const bar = el('div', 'q-bar');
  const search = el('input'); search.type = 'text'; search.placeholder = 'filter title / id / giver...'; search.id = 'quest-filter';
  const newBtn = el('button', 'ed-btn', 'New quest'); newBtn.id = 'quest-new';
  bar.append(search, newBtn);
  const allLbl = el('label', 'q-field'); const allCb = el('input'); allCb.type = 'checkbox'; allCb.id = 'quest-show-all';
  allLbl.append(allCb, el('span', null, ' Show all quest markers'));
  allCb.addEventListener('change', () => { showAll = allCb.checked; opts.onMarkers && opts.onMarkers(); });
  bar.append(allLbl);
  const list = el('div', 'q-list'); list.id = 'quest-list';
  const detail = el('div', 'q-detail'); detail.id = 'quest-detail';
  root.append(bar, list, detail);

  const redraw = () => { renderList(); renderDetail(); opts.onMarkers && opts.onMarkers(); };
  const run = (cmd) => { stack.run(cmd); redraw(); };

  function renderList() {
    list.textContent = '';
    for (const r of filterRows(questRows(model.quests, names), filter)) {
      const row = el('div', 'q-row' + (current && current.id === r.id ? ' active' : ''));
      row.dataset.qid = r.id;
      row.append(el('span', 'q-chip ' + r.chip, r.side ? 'side' : 'main'), el('span', 'q-title', r.title), el('span', 'q-meta', ` ${r.id} - ${r.region}`));
      row.addEventListener('click', () => { current = model.quests.find((x) => x.id === r.id); selObj = -1; redraw(); });
      list.append(row);
    }
  }

  function field(label, value, onCommit, multiline) {
    const wrap = el('label', 'q-field'); wrap.append(el('span', null, label)); wrap.dataset.field = label === 'Title' ? 'title' : label === 'Return text' ? 'returnText' : label.startsWith('Offer') ? 'lines' : '';
    const inp = el(multiline ? 'textarea' : 'input'); inp.value = value;
    inp.addEventListener('change', () => onCommit(inp.value));   // blur/enter = one undo step
    wrap.append(inp); return wrap;
  }

  // ED-QUEST-05: live lint list, rebuilt on every redraw (every edit goes through run()/redraw)
  function goTo(t) {
    if (t.kind === 'objective') { const i = current.objectives.findIndex((o) => o.id === t.id); if (i >= 0) { selObj = i; redraw(); const b = detail.querySelector('[data-obj="' + i + '"]'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); } }
    else if (t.kind === 'giver' || t.kind === 'return') { opts.onFocus && t.id && opts.onFocus(t.id); const b = detail.querySelector('[data-pick="' + t.kind + '"]'); if (b && b.focus) b.focus(); }
    else { const f = detail.querySelector(t.kind === 'reward' ? '#quest-reward' : '[data-field="' + t.id + '"] input, [data-field="' + t.id + '"] textarea') || detail.querySelector('[data-field="title"] input'); if (f && f.focus) f.focus(); }
  }
  function lintBox(q) {
    const box = el('div', 'q-lint'); box.id = 'quest-lint';
    let msgs = [];
    try { msgs = liveLint(model, q, buildLintCtx({ world: getWorld(), itemDefs, names, floorAt, sites, getMesh: opts.getMesh })); } catch (e) { msgs = [{ rule: 'R0', severity: 'warn', text: 'Lint failed: ' + (e && e.message), target: { kind: 'field', id: 'title' } }]; }
    box.append(el('b', null, msgs.length ? 'Problems (' + msgs.length + ')' : 'No problems'));
    for (const m of msgs) {
      const row = el('div', 'q-lint-row ' + m.severity); row.dataset.rule = m.rule;
      const go = el('button', 'ed-btn', 'Go to'); go.addEventListener('click', () => goTo(m.target));
      row.append(el('span', null, m.text + ' '), go); box.append(row);
    }
    return box;
  }

  function renderDetail() {
    detail.textContent = '';
    const q = current;
    if (!q) { detail.append(el('div', 'q-hint', 'Pick a quest.')); return; }
    const flow = el('pre', 'q-flow'); flow.id = 'quest-flow';
    flow.textContent = buildFlow(q, names).map((n) => n.label + (n.detail ? '\n    ' + n.detail : '')).join('\n  v\n');
    detail.append(flow);
    detail.append(lintBox(q));
    const pickBtn = (slot, label) => {
      const b = el('button', 'ed-btn' + (picker.slot === slot || (picker.slot && slot && picker.slot.obj === slot.obj && slot.obj !== undefined) ? ' active' : ''), 'Pick');
      b.title = 'Pick ' + label + ' in the 3D view (Esc cancels)'; b.dataset.pick = typeof slot === 'string' ? slot : 'obj' + slot.obj;
      b.addEventListener('click', () => { pickMsg = ''; picker.armed && picker.slot === slot ? picker.cancel() : picker.arm(slot); });
      return b;
    };
    const slotRow = (label, slot) => { const w = el('div', 'q-field'); w.append(el('span', null, label), pickBtn(slot, label)); return w; };
    detail.append(slotRow('Giver', 'giver'), slotRow('Return to', 'return'));
    const pm = el('div', 'q-msg', picker.armed ? 'Click in the 3D view (Esc cancels)' : pickMsg); pm.id = 'quest-pick-msg'; detail.append(pm);
    detail.append(field('Title', q.title, (v) => run(ed.setTitle(q, v))));
    detail.append(renderLineEditor({ q, dm, base: lineBase, model, names, run, setMsg: (m) => { lineMsg = m; const e = document.getElementById('quest-line-msg'); if (e) e.textContent = m; } }));
    const lm = el('div', 'q-msg', lineMsg); lm.id = 'quest-line-msg'; detail.append(lm);
    detail.append(field('Offer (Accept / Exit text, one line each)', ((q.lines && q.lines.offer) || []).join('\n'), (v) => run(ed.setOfferLines(q, v.split('\n'))), true));
    q.objectives.forEach((o, i) => {
      const box = el('div', 'q-obj' + (selObj === i ? ' active' : '')); box.dataset.obj = i; box.append(el('b', null, `Step ${i + 1}`));
      box.addEventListener('click', () => { if (selObj !== i) { selObj = i; opts.onMarkers && opts.onMarkers(); box.classList.add('active'); } });
      box.append(field('Text', objText(o), (v) => run(ed.setObjectiveField(q, i, 'text', v))));
      box.append(field('Journal', objJournal(o), (v) => run(ed.setObjectiveField(q, i, 'journal', v)), true));
      const up = el('button', 'ed-btn', 'Up'), dn = el('button', 'ed-btn', 'Down'), del = el('button', 'ed-btn', 'Delete');
      up.disabled = i === 0; dn.disabled = i === q.objectives.length - 1;
      up.addEventListener('click', () => run(ed.moveStep(q, i, i - 1)));
      dn.addEventListener('click', () => run(ed.moveStep(q, i, i + 1)));
      del.addEventListener('click', () => run(ed.deleteStep(q, i)));
      box.append(pickBtn({ obj: i }, 'the target of step ' + (i + 1)), up, dn, del); detail.append(box);
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
      // ED-QUEST-03b: areas.json (game format) + the world json's area-only zones are saved with the quest
      const aw = r.ok ? saveAll(model, { writeFileSync: (p, t) => write(p.replace(/^q\//, ''), t) }) : { written: [] };
      const zones = r.ok && model.zones.length && opts.saveWorld ? (applyZones(model, getWorld()), opts.saveWorld(), 'world') : null;
      const dw = r.ok ? saveDialogues(dm, { writeFileSync: (p2, t) => write('dialogue/' + p2.replace(/^d\//, ''), t) }) : [];
      msg.textContent = r.ok ? 'Saved ' + [r.file, ...aw.written.filter((n) => n !== r.file), ...(zones ? ['world'] : []), ...dw.map((n) => 'dialogue/' + n)].join(', ') : r.errors.join('; ');
    });
    // ED-QUEST-07: Play from here - new tab at the editor camera ground position with ?qstate=<questId>:<preset>
    const pSel = el('select'); pSel.id = 'quest-play-preset';
    for (const o of presetOptions(q)) pSel.append(new Option(o.label, o.value));
    const play = el('button', 'ed-btn', 'Play from here'); play.id = 'quest-play';
    play.addEventListener('click', () => {
      const c = opts.getCamGround ? opts.getCamGround() : null; if (!c) { msg.textContent = 'No camera position'; return; }
      window.open(playUrl('../../game/index.html', c, q.id, pSel.value), '_blank');
    });
    tools.append(undo, redo, save, pSel, play, msg); detail.append(tools);
  }

  search.addEventListener('input', () => { filter = search.value; renderList(); });
  newBtn.addEventListener('click', () => { const c = ed.newSideQuest(model); stack.run(c); current = c.quest; redraw(); });
  redraw();
  return {
    model, stack, picker, areasFile, dialogues: dm, lineBase, select: (id) => { current = model.quests.find((x) => x.id === id); selObj = -1; redraw(); },
    /** ED-QUEST-04: what the view draws - the open quest, or every quest when "Show all" is on. */
    markerState: () => ({ quests: showAll ? model.quests : (current ? [current] : []), all: showAll, selObj, sites }),
    selectObjective: (id, i) => { current = model.quests.find((x) => x.id === id) || current; selObj = i; redraw(); },
  };
}

/** Default loader: content/quests/index.json lists packs + legacy files; plain fetch from the page's server. */
/** Dialogue files listed in content/manifest.json (dialogue/*.dialogue.json) -> { name: text }. */
export async function fetchDialogueFiles(root = '../../content/') {
  const man = JSON.parse(await (await fetch(root + 'manifest.json')).text()), out = {};
  for (const p of Object.values(man).flat().filter((x) => typeof x === 'string' && /^dialogue\/[^/]+\.dialogue\.json$/.test(x))) {
    const r = await fetch(root + p); if (r.ok) out[p.slice(9)] = await r.text();
  }
  return out;
}

export async function fetchQuestFiles(base = '../../content/quests/') {
  const get = async (p) => { const r = await fetch(base + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.text(); };
  const idx = JSON.parse(await get('index.json'));
  const files = { 'sites.json': await get('sites.json') };
  try { files['areas.json'] = await get('areas.json'); } catch (e) { /* optional */ }
  for (const n of idx.legacy) files[n + '.quest.json'] = await get(n + '.quest.json');
  for (const p of idx.packs) files[p + '/pack.json'] = await get(p + '/pack.json');
  return files;
}

/** Default writer: browser download (the editor has no repo-wide fs); the owner drops the file into content/quests. */
export function downloadWrite(rel, text) {
  const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = rel.replace(/\//g, '_'); a.click(); URL.revokeObjectURL(a.href);
}
