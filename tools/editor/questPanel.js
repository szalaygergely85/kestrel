// tools/editor/questPanel.js - ED-QUEST-02. Thin DOM over quest/flow.js + quest/edit.js + quest/model.js.
// mountQuestPanel(root, { names, itemDefs, loadFiles, write }):
//   loadFiles() -> Promise<{ 'm1.quest.json': text, 'ch12/pack.json': text, 'sites.json': text, ... }>
//   write(relPath, text) persists one quest file (editor supplies its own io; default = download).
import { loadQuests, saveQuest, saveAll, applyZones, makeStack } from './quest/model.js';
import { buildLintCtx, presetOptions, playUrl } from './quest/wire.js';
import { questRows, filterRows, itemChoices } from './quest/flow.js';
import * as ed from './quest/edit.js';
import * as fe from './quest/formatEdit.js';
import { applyPick } from './quest/targets.js';
import { createQuestPicker } from './questPick.js';
import { renderLineEditor } from './questDialogue.js';
import { createLiveSender, browserChannel } from './quest/liveSend.js';
import { validateQuest, validateFooter } from './quest/validate.js';
import { stripModel, CARDS } from './quest/questStrip.js';
import { prereqRows, setRequiresKeepShape } from './quest/prereqs.js';
import { originCards, setTurnInSameAsGiver } from './quest/originCards.js';
import { objectiveCards, setStepKind, setStepCount, kindsFor, KIND_LABEL, MAX_TEXT } from './quest/objectiveCards.js';
import { loadDialogues, saveDialogues, captureBaseline } from './quest/lines.js';
import { conversationView } from './quest/conversation.js';
import { rewardTiles, setRewardItems, rewardLint } from './quest/rewards.js';
import { HEART_PIECE_ITEM } from './quest/format.js';
import { buildEditorBundle, simSteps } from './quest/sim.js';

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
  let current = null, filter = '', pickMsg = '', selObj = -1, showAll = false, wide = true;   // wide: the Quest tab opens as a wide panel (mockup density)
  const applyWide = () => { root.classList.toggle('wide', wide); const d = document.getElementById('left-dock'); if (d) d.classList.toggle('q-wide', wide); };   // ED-QUEST-04: selObj = step highlighted in the view
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

  root.textContent = ''; applyWide();
  const bar = el('div', 'q-bar');
  const search = el('input'); search.type = 'text'; search.placeholder = 'filter title / id / giver...'; search.id = 'quest-filter';
  bar.append(search);
  const allLbl = el('label', 'q-field'); const allCb = el('input'); allCb.type = 'checkbox'; allCb.id = 'quest-show-all';
  allLbl.append(allCb, el('span', null, ' Show all quest markers'));
  allCb.addEventListener('change', () => { showAll = allCb.checked; opts.onMarkers && opts.onMarkers(); });
  bar.append(allLbl);
  const list = el('div', 'q-list'); list.id = 'quest-list';
  const detail = el('div', 'q-detail'); detail.id = 'quest-detail';
  root.append(bar, list, detail);

  const live = createLiveSender({ channel: opts.liveChannel !== undefined ? opts.liveChannel : browserChannel() }); // ED-QUEST-07b: unsaved edits -> running game tab
  const redraw = () => { renderList(); renderDetail(); opts.onMarkers && opts.onMarkers(); live.schedule(current, dm); };
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

  // ED-QUI-05/06: conversation (Accept/Exit, dangling GOTO) and reward problems join the live lint list
  const coinFlags = { coinPaid: false };   // runtime pays items only (questBook.js); flip when the grant pays rewards.coin
  // ED-QUI-06: card [05] reward tiles
  function rewardsBox(q) {
    const t = rewardTiles(q, itemDefs, coinFlags, model), wrap = el('div', 'q-rewards'); wrap.id = 'quest-rewards';
    const msg = el('div', 'q-ptext'); msg.id = 'quest-reward-msg';
    const apply = (patch) => { const r = setRewardItems(q, patch); if (r.error) { msg.textContent = r.error; return; } run(r.cmd); };
    const grid = el('div', 'q-rgrid');
    t.items.forEach((it, i) => {
      const tile = el('div', 'q-rtile'); tile.dataset.item = it.id;
      tile.append(el('div', 'q-oname', it.name));
      if (it.rarity) tile.append(el('span', 'q-pill', it.rarity.toUpperCase()));
      const n = el('input'); n.type = 'number'; n.min = 1; n.value = it.n; n.style.width = '3.5em';
      n.addEventListener('change', () => apply({ items: t.items.map((x, j) => (j === i ? { id: x.id, n: Number(n.value) || 1 } : x)) }));
      const rm = el('button', 'ed-btn', 'Remove'); rm.addEventListener('click', () => apply({ items: t.items.filter((_, j) => j !== i) }));
      const row = el('div', 'q-orow'); row.append(n, rm); tile.append(row); grid.append(tile);
    });
    if (t.heart.shown) {
      const tile = el('div', 'q-rtile'); tile.id = 'quest-heart';
      tile.append(el('div', 'q-oname', 'Heart piece'));
      const n = el('input'); n.type = 'number'; n.min = 0; n.max = 1; n.value = Math.min(1, t.heart.n); n.style.width = '3.5em';
      n.addEventListener('change', () => apply({ heartPiece: Math.min(1, Math.max(0, Number(n.value) || 0)) }));
      const row = el('div', 'q-orow'); row.append(n, el('span', 'q-ometa', '/ 1')); tile.append(row); grid.append(tile);
    }
    const coin = el('div', 'q-rtile disabled'); coin.id = 'quest-coin'; coin.title = t.coin.note;
    coin.append(el('div', 'q-oname', 'Coin'));
    const cn = el('input'); cn.type = 'number'; cn.min = 0; cn.value = t.coin.n; cn.style.width = '3.5em'; cn.disabled = !t.coin.enabled;
    if (t.coin.enabled) cn.addEventListener('change', () => apply({ coin: Number(cn.value) || 0 }));
    coin.append(cn); if (t.coin.note) coin.append(el('div', 'q-ometa', t.coin.note)); grid.append(coin);
    const add = el('select'); add.id = 'quest-reward-add'; add.append(new Option('+ Add item...', ''));
    for (const c of itemChoices(itemDefs)) if (c.id !== HEART_PIECE_ITEM && !t.items.some((x) => x.id === c.id)) add.append(new Option(c.name, c.id));
    add.addEventListener('change', () => { if (add.value) apply({ items: [...t.items, { id: add.value, n: 1 }] }); });
    const nx = el('div', 'q-rtile'); nx.id = 'quest-next';
    nx.append(el('div', 'q-ohead', 'NEXT QUEST'));
    const ns = el('select'); ns.append(new Option('(none)', ''));
    for (const c of fe.formatChoices(model, getWorld(), names).quests) if (c.id !== q.id) ns.append(new Option(c.name, c.id));
    ns.value = t.next ? t.next.id : ''; ns.addEventListener('change', () => run(fe.setNext(q, ns.value)));
    nx.append(ns, el('div', 'q-ometa', 'Offered at hand-in, never auto-started'));
    const hand = conversationView(dm, q, names).nodes.filter((x) => x.stage === 'Hand-in').flatMap((x) => x.sets);
    if (hand.length) nx.append(el('div', 'q-ometa', 'Hand-in sets: ' + hand.join(', ')));
    grid.append(nx);
    wrap.append(grid, add, msg);
    for (const p of t.problems) wrap.append(el('div', 'q-ptext', p));
    return wrap;
  }

  // ED-QUEST-05: live lint list, rebuilt on every redraw (every edit goes through run()/redraw)
  function goTo(t) {
    if (t.kind === 'card') { const c = detail.querySelector('[data-card="' + t.id + '"]'); if (c) { c.classList.remove('closed'); c.scrollIntoView && c.scrollIntoView({ block: 'start' }); } return; }
    if (t.kind === 'objective') { const i = current.objectives.findIndex((o) => o.id === t.id); if (i >= 0) { selObj = i; redraw(); const b = detail.querySelector('[data-obj="' + i + '"]'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); } }
    else if (t.kind === 'giver' || t.kind === 'return') { opts.onFocus && t.id && opts.onFocus(t.id); const b = detail.querySelector('[data-pick="' + t.kind + '"]'); if (b && b.focus) b.focus(); }
    else { const f = detail.querySelector(t.kind === 'reward' ? '#quest-reward' : '[data-field="' + t.id + '"] input, [data-field="' + t.id + '"] textarea') || detail.querySelector('[data-field="title"] input'); if (f && f.focus) f.focus(); }
  }

  // ED-QUI-07b2: SIM = the real quest runtime (runQuestE2e) on the OPEN, unsaved documents; STEP reveals one row at a time. Warns on FAIL, never blocks Play live.
  const simRuns = new Map();   // quest id -> { result, shown, stamp }
  const simStamp = (q) => JSON.stringify(q.raw) + '|' + [...dm.files.values()].map((f) => JSON.stringify(f.obj)).join('');
  const fetchText = opts.fetchText || (async (p) => { try { const r = await fetch('../../' + p); return r.ok ? r.text() : null; } catch (e) { return null; } });
  async function runSim(q, stepwise) {
    const { runQuestE2e } = await import('../../game/js/quest/questE2eRun.js');
    let result;
    try { const bundle = await buildEditorBundle({ model, dm, itemDefs, fetchText, openEntities: (getWorld() || {}).entities || [] }); result = await runQuestE2e(bundle, q.id); }
    catch (e) { const f = { name: '0 loaded', ok: false, detail: String((e && e.message) || e) }; result = { ok: false, steps: [f], firstFail: f }; }
    simRuns.set(q.id, { result, shown: stepwise ? 1 : Infinity, stamp: simStamp(q) });
    if (current === q) redraw();
    goTo({ kind: 'card', id: 'validate' });
  }
  function simBox(q) {
    const box = el('div', 'q-vsim'); box.id = 'quest-sim-area';
    const head = el('div', 'q-vhead');
    const run1 = el('button', 'ed-btn primary', 'SIM'), step = el('button', 'ed-btn', 'STEP'), live = el('button', 'ed-btn', 'Play live');
    run1.id = 'quest-sim-run'; step.id = 'quest-sim-step'; live.id = 'quest-sim-live';
    run1.title = 'Run the whole quest here (real quest runtime, your unsaved edits included)'; step.title = 'Show the run one step at a time'; live.title = 'Open the game tab at this quest (Play from here)';
    run1.addEventListener('click', () => runSim(q, false));
    live.addEventListener('click', () => { const b = document.getElementById('quest-play'); if (b) b.click(); });
    const r = simRuns.get(q.id);
    step.addEventListener('click', () => { if (!r || r.shown >= r.result.steps.length) runSim(q, true); else { r.shown++; redraw(); } });
    head.append(run1, step, live); box.append(head);
    if (!r) { box.append(el('div', null, 'STEP SIMULATOR: SIM runs the quest end to end (offer, talk, accept, objectives, hand-in, reward) on the real quest runtime.')); return box; }
    const rows = simSteps(r.result), stale = r.stamp !== simStamp(q);
    const sum = el('div', 'q-simsum ' + (r.result.ok ? 'ok' : 'error'), (r.result.ok ? 'SIM PASS: ' + rows.length + ' steps' : 'SIM FAIL: ' + (r.result.firstFail ? r.result.firstFail.name + ' - ' + r.result.firstFail.detail : '')) + (stale ? ' (edited since this run - run SIM again)' : ''));
    sum.id = 'quest-sim-sum'; box.append(sum);
    if (!r.result.ok) box.append(el('div', 'q-vrow warn', 'This quest fails the simulation. Play live still opens, but it may not complete.'));
    rows.slice(0, r.shown).forEach((s) => {
      const row = el('div', 'q-vrow q-simrow ' + (s.ok ? 'ok' : 'error') + (s.first ? ' first' : '')); row.dataset.step = s.name;
      const go = el('button', 'ed-btn', 'Go to'); go.addEventListener('click', () => goTo({ kind: 'card', id: s.card }));
      row.append(el('span', 'rule', s.status), el('span', null, s.label + (s.detail ? ' - ' + s.detail : '') + ' '));
      if (!s.ok) row.append(go);
      box.append(row);
    });
    return box;
  }
  // ED-QUI-07a: the whole static check of the open quest (lintQuest + format + R19 + conversation + reward), one result for the list, the footer and the strip chip
  const lintCtx = () => ({ ...buildLintCtx({ world: getWorld(), itemDefs, names, floorAt, sites, getMesh: opts.getMesh }), names });
  const validateOf = (q) => {
    try { return validateQuest(model, q, lintCtx(), dm, (qq, items) => (items.some((x) => x.rule === 'QF' && x.target.id === 'rewards' && /rewards nothing/.test(x.text)) ? items : [...items, ...rewardLint(qq, itemDefs, coinFlags)])); }
    catch (e) { return { errors: 0, warnings: 1, ok: true, items: [{ rule: 'R0', severity: 'warn', text: 'Validate failed: ' + (e && e.message), target: { kind: 'field', id: 'title' } }] }; }
  };
  function lintBox(q) {
    const box = el('div', 'q-lint'); box.id = 'quest-lint';
    const res = validateOf(q), ft = validateFooter(model, q, res);
    const head = el('div', 'q-vhead'), vb = el('button', 'ed-btn primary', 'VALIDATE'); vb.id = 'quest-validate'; vb.title = 'Re-run every check for this quest';
    vb.addEventListener('click', () => redraw());
    head.append(vb, el('b', null, res.items.length ? 'Problems (' + res.items.length + ')' : 'No problems')); box.append(head);
    for (const m of res.items) {
      const row = el('div', 'q-vrow q-lint-row ' + m.severity); row.dataset.rule = m.rule;
      const go = el('button', 'ed-btn', 'Go to'); go.addEventListener('click', () => goTo(m.target));
      row.append(el('span', 'rule', m.rule), el('span', null, m.text + ' '), go); box.append(row);
    }
    const foot = el('div', 'q-vfoot'); foot.id = 'quest-vfoot';
    const vd = el('span', 'verdict ' + ft.kind, ft.verdict); vd.id = 'quest-verdict';
    foot.append(el('span', null, 'FILE ' + ft.path), el('span', null, ft.bytes + ' bytes'), vd); box.append(foot);
    box.append(simBox(q));   // ED-QUI-07b2: STEP SIMULATOR (runs questE2eRun on the open documents)
    return box;
  }

  // ED-QUI-01: numbered collapsible card
  function cardBox(c) {
    const box = el('section', 'q-card'); box.dataset.card = c.id;
    const head = el('div', 'q-card-head'), body = el('div', 'q-card-body');
    head.append(el('span', 'q-card-n', '[' + c.n + ']'), el('span', 'q-card-t', c.title)); head.dataset.card = c.id;
    head.addEventListener('click', () => box.classList.toggle('closed'));
    box.append(head, body); return { box, body, head };
  }
  // ED-QUI-01: context strip (id chip, status chip, type + region chips, inline rename, NEW, SIM)
  function stripBox(q, lintMsgs) {
    const box = el('div', 'q-strip'); box.id = 'quest-strip';
    const nb = el('button', 'ed-btn', 'NEW'); nb.id = 'quest-new'; nb.title = 'New side quest';
    nb.addEventListener('click', () => { const c = ed.newSideQuest(model); stack.run(c); current = c.quest; redraw(); });
    if (!q) { box.append(nb); return box; }
    const m = stripModel(q, lintMsgs);
    const row = el('div', 'q-strip-row');
    const sc = el('span', 'q-pill status ' + m.status.kind, m.status.label); sc.id = 'quest-status';
    row.append(el('span', 'q-pill id', 'QUEST ' + m.id), sc, el('span', 'q-pill ' + m.color, m.type === 'side' ? 'SIDE' : 'MAIN'), el('span', 'q-pill', m.region.toUpperCase()));
    const sim = el('button', 'ed-btn primary', 'SIM'); sim.id = 'quest-sim'; sim.title = 'Simulate this quest (STEP SIMULATOR, card [06])';
    sim.addEventListener('click', () => runSim(q, false));
    const wb = el('button', 'ed-btn', wide ? 'NARROW' : 'WIDE'); wb.id = 'quest-wide'; wb.title = 'Toggle the wide quest panel';
    wb.addEventListener('click', () => { wide = !wide; applyWide(); redraw(); });
    row.append(nb, sim, wb);
    box.append(row, field('Title', q.title, (v) => run(ed.setTitle(q, v))));
    return box;
  }
  // ED-QUI-02: card [01] prerequisites
  function prereqCard(q) {
    const pr = prereqRows(model, q), box = el('div', 'q-prereq'); box.id = 'quest-prereq';
    box.append(el('div', 'q-prereq-sum' + (pr.ok < pr.total ? ' bad' : ''), pr.header));
    const ids = pr.rows.map((r) => r.quest);
    for (const r of pr.rows) {
      const row = el('div', 'q-prow' + (r.problem ? ' bad' : '')); row.dataset.req = r.quest;
      const open = el('button', 'ed-btn', 'Open'); open.title = 'Open this quest';
      open.disabled = !model.quests.some((x) => x.id === r.quest);
      open.addEventListener('click', () => { current = model.quests.find((x) => x.id === r.quest) || current; selObj = -1; redraw(); });
      const rm = el('button', 'ed-btn', 'Remove');
      rm.addEventListener('click', () => run(setRequiresKeepShape(q, ids.filter((x) => x !== r.quest))));
      row.append(el('span', 'q-tag', '[REQ]'), el('span', 'q-plabel', r.title), open, rm);
      if (r.problem) row.append(el('div', 'q-ptext', r.text));
      box.append(row);
    }
    const add = el('select'); add.id = 'quest-req-add'; add.append(new Option('+ Add required quest...', ''));
    for (const c of fe.formatChoices(model, getWorld(), names).quests) if (c.id !== q.id && !ids.includes(c.id)) add.append(new Option(c.name, c.id));
    add.addEventListener('change', () => { if (add.value) run(setRequiresKeepShape(q, [...ids, add.value])); });
    const item = el('div', 'q-prow disabled'); item.title = pr.item.note;
    item.append(el('span', 'q-tag', '[ITM]'), el('span', 'q-plabel', 'Required item'));
    const ib = el('button', 'ed-btn', 'Add'); ib.disabled = true; item.append(ib, el('div', 'q-ptext dim', pr.item.note));
    box.append(add, item); return box;
  }

  // ED-QUI-03: card [02] ORIGIN + TURN-IN side by side
  function originBox(q, pickBtn) {
    const oc = originCards(q, getWorld(), names, sites, floorAt), wrap = el('div', 'q-origin'); wrap.id = 'quest-origin';
    const one = (c, title, slot, extra) => {
      const box = el('div', 'q-ocard ' + c.color + (c.problem ? ' bad' : '')); box.dataset.role = slot;
      box.append(el('div', 'q-ohead', c.glyph + '  ' + title), el('div', 'q-oname', c.name + (c.same ? ' (same as giver)' : '')), el('div', 'q-ometa', 'id ' + (c.id || '-') + ' - ' + c.kind));
      box.append(el('div', 'q-ometa', c.pos ? 'X ' + c.pos.x + '  Y ' + c.pos.y + '  Z ' + c.pos.z : 'no position'), el('div', 'q-ometa', 'Talk ' + c.radius + ' m - ' + c.region));
      const row = el('div', 'q-orow'), pk = pickBtn(slot, title.toLowerCase()); pk.textContent = 'Pick in 3D'; row.append(pk); if (extra) row.append(extra);
      const go = el('button', 'ed-btn', 'Go to'); go.disabled = !c.id || !c.pos; go.addEventListener('click', () => opts.onFocus && c.id && opts.onFocus(c.id)); row.append(go);
      box.append(row); if (c.problem) box.append(el('div', 'q-ptext', c.problem));
      return box;
    };
    const same = el('button', 'ed-btn', 'Same as giver'); same.id = 'quest-turnin-same'; same.disabled = oc.turnIn.same;
    same.addEventListener('click', () => { const c = setTurnInSameAsGiver(q); if (c) run(c); });
    wrap.append(one(oc.origin, 'ORIGIN', 'giver'), one(oc.turnIn, 'TURN-IN', 'return', same));
    return wrap;
  }
  // ED-QUI-04: card [03] one card per objective step
  function objectivesBox(q, pickBtn) {
    const oc = objectiveCards(q, getWorld(), { sites, names, floorAt, zones: [...((getWorld().zones) || []), ...model.zones] }), wrap = el('div', 'q-objs'); wrap.id = 'quest-objs';
    const kinds = kindsFor(q);
    oc.cards.forEach((c, i) => {
      const box = el('div', 'q-obj q-ostep' + (selObj === i ? ' active' : '') + (c.textBad ? ' bad' : '')); box.dataset.obj = i;
      box.addEventListener('click', () => { if (selObj !== i) { selObj = i; opts.onMarkers && opts.onMarkers(); box.classList.add('active'); } });
      const head = el('div', 'q-ohead'); head.append(el('span', 'q-card-n', '[' + c.n + ']'));
      const ks = el('select', 'q-kind'); for (const k of kinds) ks.append(new Option(KIND_LABEL[k], k)); ks.value = c.kind;
      ks.title = 'Changing the kind starts a new blank step of that kind'; ks.addEventListener('change', () => { const cmd = setStepKind(q, i, ks.value); if (cmd) run(cmd); });
      head.append(ks); box.append(head);
      box.append(field('Text', c.text, (v) => run(ed.setObjectiveField(q, i, 'text', v))));
      box.append(el('div', 'q-ometa' + (c.textBad ? ' q-ptext' : ''), c.textLen + ' / ' + MAX_TEXT));
      box.append(field('Journal', c.journal, (v) => run(ed.setObjectiveField(q, i, 'journal', v)), true));
      box.append(el('div', 'q-ometa', 'Target: ' + c.target.line + (c.target.pos ? '  (X ' + c.target.pos.x + ' Y ' + c.target.pos.y + (c.target.pos.z != null ? ' Z ' + c.target.pos.z : '') + ')' : '')));
      const row = el('div', 'q-orow');
      if (c.canCount) {   // count only for collect / kill (OB-099)
        const n = el('input'); n.type = 'number'; n.min = 1; n.value = c.count; n.style.width = '4em'; n.dataset.count = i;
        n.addEventListener('change', () => { const cmd = setStepCount(q, i, Number(n.value)); if (cmd) run(cmd); else redraw(); });
        const w = el('label', 'q-field'); w.append(el('span', null, 'Count'), n); row.append(w);
      }
      const pk = pickBtn({ obj: i }, 'the target of step ' + c.n); pk.textContent = 'Pick in 3D'; pk.disabled = !c.canPick; row.append(pk);
      const up = el('button', 'ed-btn', 'Up'), dn = el('button', 'ed-btn', 'Down'), del = el('button', 'ed-btn', 'Delete');
      up.disabled = !c.canUp; dn.disabled = !c.canDown;
      up.addEventListener('click', () => run(ed.moveStep(q, i, i - 1))); dn.addEventListener('click', () => run(ed.moveStep(q, i, i + 1))); del.addEventListener('click', () => run(ed.deleteStep(q, i)));
      row.append(up, dn, del); box.append(row); wrap.append(box);
    });
    const add = el('button', 'ed-btn', 'ADD STEP'); add.id = 'quest-add-step'; add.disabled = !oc.canAdd; if (!oc.canAdd) add.title = oc.addNote;
    add.addEventListener('click', () => { const c = fe.addStepMax(q); if (c) run(c); });
    wrap.append(add); if (oc.addNote) wrap.append(el('div', 'q-ometa', oc.addNote));
    for (const t of oc.problems) wrap.append(el('div', 'q-ptext', t));
    return wrap;
  }

  function renderDetail() {
    detail.textContent = '';
    const q = current;
    const cards = {};
    let host = detail;
    if (!q) { host.append(stripBox(null, [])); host.append(el('div', 'q-hint', 'Pick a quest.')); return; }
    detail.append(stripBox(q, validateOf(q).items));
    for (const c of CARDS) cards[c.id] = cardBox(c);
    const into = (id) => { host = cards[id].body; };
    for (const c of CARDS) detail.append(cards[c.id].box);
    into('prereq'); host.append(prereqCard(q));
    into('objectives');
    into('validate'); host.append(lintBox(q)); into('spatial');
    const pickBtn = (slot, label) => {
      const b = el('button', 'ed-btn' + (picker.slot === slot || (picker.slot && slot && picker.slot.obj === slot.obj && slot.obj !== undefined) ? ' active' : ''), 'Pick');
      b.title = 'Pick ' + label + ' in the 3D view (Esc cancels)'; b.dataset.pick = typeof slot === 'string' ? slot : 'obj' + slot.obj;
      b.addEventListener('click', () => { pickMsg = ''; picker.armed && picker.slot === slot ? picker.cancel() : picker.arm(slot); });
      return b;
    };
    host.append(originBox(q, pickBtn));
    const pm = el('div', 'q-msg', picker.armed ? 'Click in the 3D view (Esc cancels)' : pickMsg); pm.id = 'quest-pick-msg'; host.append(pm);
    into('conversation');
    host.append(renderLineEditor({ q, dm, base: lineBase, model, names, run, setMsg: (m) => { lineMsg = m; const e = document.getElementById('quest-line-msg'); if (e) e.textContent = m; } }));
    const lm = el('div', 'q-msg', lineMsg); lm.id = 'quest-line-msg'; host.append(lm);
    into('objectives');
    host.append(objectivesBox(q, pickBtn));
    into('spatial'); host.append(field('Return text', q.returnText || '', (v) => run(ed.setReturnText(q, v))));
    into('rewards'); host.append(rewardsBox(q));
    into('validate');
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
    tools.append(undo, redo, save, pSel, play, msg); host.append(tools);
  }

  search.addEventListener('input', () => { filter = search.value; renderList(); });
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
