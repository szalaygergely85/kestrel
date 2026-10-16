// ED-QUI-07b2 (architecture 38.85): the quest simulator's editor side. buildEditorBundle builds the content bundle that
// game/js/quest/questE2eRun.js (runQuestE2e) takes - the same shape tools/quest-e2e-content.mjs builds from disk - from fetch plus the
// editor's OPEN in-memory documents (unsaved quest text + dialogue lines, the same text liveSend sends). simSteps is the pure view model.
// Browser-safe: no node:*; fetch is injected as fetchText(repoRelativePath) -> text | null (null = 404, ignored when optional).
import { fileText } from './model.js';
import { dialogueText } from './lines.js';

const QDIR = 'content/quests/';

/** '../content/quests/../items/x.json' -> 'content/items/x.json' (what the page's fetch must ask for, repo-relative). */
export function normPath(u) {
  const out = [];
  for (const s of String(u).split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); } else out.push(s);
  }
  return out.join('/');
}

/**
 * @param {{ model, dm, itemDefs, fetchText:(p:string)=>Promise<string|null>, openEntities?: object[] }} ctx
 *   model = loadQuests model (open quest files), dm = loadDialogues model (open dialogue files), openEntities = entities of the world open in the editor.
 * @returns {Promise<{fetchJson, raws, snip, itemDefs, areaIds:Set, entDlg}>}
 */
export async function buildEditorBundle({ model, dm, itemDefs, fetchText, openEntities = [] }) {
  // quest-folder files from the open model: legacy quests, packs, sites, areas (unsaved edits included)
  const overlay = new Map();
  for (const [name, f] of model.files) overlay.set(QDIR + name, fileText(f));
  const cache = new Map();
  const need = async (p, optional) => {
    if (cache.has(p)) return cache.get(p);
    const t = await fetchText(p);
    if (t == null && !optional) throw new Error(p + ' not found');
    cache.set(p, t); return t;
  };
  // pre-fetch every non-overlay file the quest loader may ask for, so fetchJson itself stays synchronous
  const want = [QDIR + 'index.json', QDIR + 'rewards.json', QDIR + 'm1.quest.json', 'content/dialogue/bear.barks.json', 'content/chargen/human.charkit.json', 'content/items/sources.json'];
  for (const p of want) if (!overlay.has(p)) await need(p, true);
  const idxText = overlay.has(QDIR + 'index.json') ? overlay.get(QDIR + 'index.json') : cache.get(QDIR + 'index.json');
  if (idxText) {
    try {
      const idx = JSON.parse(idxText);
      for (const n of idx.legacy || []) { const p = QDIR + n + '.quest.json'; if (!overlay.has(p)) await need(p, true); }
      for (const r of idx.packs || []) { const p = QDIR + r + '/pack.json'; if (!overlay.has(p)) await need(p, true); }
    } catch (e) { /* a bad index: the runner reports it */ }
  }
  const fetchJson = (u) => {
    const p = normPath(u);
    const text = overlay.has(p) ? overlay.get(p) : cache.get(p);
    if (text == null) throw new Error(p + ' not found');
    return JSON.parse(text);
  };

  const raws = {};
  for (const [name, f] of dm.files) {
    let t = null; try { t = dialogueText(f); } catch (e) { t = null; }
    raws[name.replace(/\.dialogue\.json$/, '')] = t != null ? JSON.parse(t) : JSON.parse(JSON.stringify(f.obj));
  }
  const snip = JSON.parse(await need('content/dialogue/quest-snippets.json'));
  const areasF = model.files.get('areas.json');
  const areaIds = new Set(Object.keys((areasF && areasF.obj.areas) || {}));

  // world entity id -> dialogue id, as the game wires it: every world file in the manifest, then the git-ignored overlay
  const entDlg = {};
  const addEnt = (e) => { const c = e && e.components && e.components.dialogue; if (e && e.id && c) entDlg[e.id] = typeof c === 'string' ? c : c.id; };
  let worlds = ['worlds/world_m1.world.json'];
  try {
    const man = JSON.parse(await need('content/manifest.json'));
    const w = Object.values(man).flat().filter((x) => typeof x === 'string' && /^worlds\/[^/]+\.world\.json$/.test(x) && x !== 'worlds/waterfall_test.world.json');
    if (w.length) worlds = w;
  } catch (e) { /* default list */ }
  for (const w of worlds) { const t = await need('content/' + w, true); if (t) for (const e of JSON.parse(t).entities || []) addEnt(e); }
  const lp = await need('content/local/placements.json', true);
  if (lp) { try { const ov = JSON.parse(lp); for (const e of Array.isArray(ov) ? ov : ov.entities || []) addEnt(e); } catch (e) { /* unreadable overlay: ignored */ } }
  for (const e of openEntities) addEnt(e);   // the world open in the editor (unsaved placements)
  return { fetchJson, raws, snip, itemDefs: itemDefs || {}, areaIds, entDlg };
}

/** Editor card a step belongs to (data-card id), for the "Go to" button. */
export function stepCard(name) {
  const n = String(name || '').replace(/^\d+\s+/, '');
  if (/^offered-only|requires/.test(n)) return 'prereq';
  if (/^(giver-character|mark-offer|mark-ready|marks-gone)/.test(n)) return 'spatial';
  if (/^(talk-offer|exit-keeps|accept|handin-talk)/.test(n)) return 'conversation';
  if (/^objectives/.test(n)) return 'objectives';
  if (/^reward/.test(n)) return 'rewards';
  if (/^main-handoff/.test(n)) return 'prereq';
  return 'validate';
}

/** result of runQuestE2e -> rows for the card: { name, label, ok, status, detail, card, first }. */
export function simSteps(result) {
  const ff = result && result.firstFail ? result.firstFail.name : null;
  return ((result && result.steps) || []).map((s) => ({
    name: s.name, label: String(s.name).replace(/^\d+\s+/, '').replace(/-/g, ' '), ok: !!s.ok, status: s.ok ? 'PASS' : 'FAIL',
    detail: s.detail || '', card: stepCard(s.name), first: !s.ok && s.name === ff,
  }));
}
