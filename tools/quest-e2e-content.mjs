// ED-QUI-07b1 (architecture 38.85): Node loader for the quest e2e runner (game/js/quest/questE2eRun.js).
// Builds the content bundle from disk: { fetchJson, raws, snip, itemDefs, areaIds, entDlg, onDiskIds }.
// entDlg also takes entities from the git-ignored overlay content/local/placements.json when present.
// `root` (default: repo root) lets tests point the loader at a fixture tree; item defs always come from loadDesignAssets (repo).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDesignAssets } from './validate-content.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));

/** -> bundle for runQuestE2e / createQuestE2e. */
export async function loadQuestE2eBundle({ root = REPO, itemDefs } = {}) {
  if (!root.endsWith('/') && !root.endsWith('\\')) root += '/';
  const rd = (p) => JSON.parse(readFileSync(root + p, 'utf8'));
  if (!itemDefs) { const assets = await loadDesignAssets(); itemDefs = assets.items?.defs || {}; }
  const raws = {};
  for (const f of readdirSync(root + 'content/dialogue')) if (f.endsWith('.dialogue.json')) raws[f.replace('.dialogue.json', '')] = rd('content/dialogue/' + f);
  const snip = rd('content/dialogue/quest-snippets.json');
  const areaIds = new Set(Object.keys(rd('content/quests/areas.json').areas || {}));
  const entDlg = {}; // world entity id -> dialogue id (components.dialogue), as the game wires it
  const addEnt = (e) => { const c = e && e.components && e.components.dialogue; if (e && e.id && c) entDlg[e.id] = typeof c === 'string' ? c : c.id; };
  for (const w of readdirSync(root + 'content/worlds').filter((f) => f.endsWith('.world.json') && f !== 'waterfall_test.world.json')) for (const e of rd('content/worlds/' + w).entities || []) addEnt(e);
  if (existsSync(root + 'content/local/placements.json')) { // git-ignored overlay: same entity shape if present
    try { const ov = rd('content/local/placements.json'); for (const e of Array.isArray(ov) ? ov : ov.entities || []) addEnt(e); } catch { /* unreadable overlay: ignored, as localOverlay.js does */ }
  }
  // every *.quest.json under content/quests (the e2e's untracked-on-disk check)
  const onDiskIds = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(d + '/' + e.name); else if (e.name.endsWith('.quest.json')) onDiskIds.push(rd(d.slice(root.length) + '/' + e.name).id); } };
  walk(root + 'content/quests');
  const fetchJson = (u) => rd(u.replace(/^(\.\.\/)+/, ''));
  return { fetchJson, raws, snip, itemDefs, areaIds, entDlg, onDiskIds };
}
