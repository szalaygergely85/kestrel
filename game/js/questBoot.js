// AUD2-09: quest/save boot files, one fetch per file. A missing/bad file is logged by NAME and collected in `errors`
// (the caller shows an on-screen notice) instead of one silent try/catch giving a quest-less game.
import { expandAll } from './quest/sim/templates.js';
import { normalizeQuestDef } from './quest/sim/questFormat.js';
export const QUEST_FILES = {
  quest: '../content/quests/m1.quest.json',
  barks: '../content/dialogue/bear.barks.json',
  tower: '../content/quests/tower.blade.quest.json',
  burl: '../content/quests/burl.boars.quest.json',
  charKit: '../content/chargen/human.charkit.json',
};

const QDIR = '../content/quests/';
const DEFAULT_LEGACY = ['m1', 'tower.blade', 'burl.boars'];
export const QUEST_INDEX = QDIR + 'index.json';

/**
 * QL-T1 (38.44 item 1): content/quests/index.json = {packs:[region...], legacy:[file names]}. legacy[0] 'm1' is the main quest, the rest
 * are plain giver / giverless defs (<name>.quest.json); packs (<region>/pack.json + sites.json + rewards.json) are template rows expanded here.
 * A missing/invalid index falls back to the three Chapter 1 files. Pack errors are collected like file errors (never throw).
 * @param {(url:string)=>Promise<any>} getJson @returns {Promise<{questDef,bearBarks,giverDefs,charKit,errors:{file:string,message:string}[]}>}
 */
export async function loadQuestFiles(getJson, { wantBarks = true, log = console.error, items = [] } = {}) {
  const errors = [];
  const fetchUrl = async (url) => {
    try { return await getJson(url); } catch (e) {
      const message = String((e && e.message) || e);
      errors.push({ file: url, message });
      log("[boot] cannot load " + url + ": " + message);
      return null;
    }
  };
  const get = (key) => fetchUrl(QUEST_FILES[key]);
  let index = null;
  try { index = await getJson(QUEST_INDEX); } catch (e) { index = null; } // optional: the defaults below are the Chapter 1 files
  const legacy = index && Array.isArray(index.legacy) && index.legacy[0] === 'm1' ? index.legacy : DEFAULT_LEGACY;
  const packNames = index && Array.isArray(index.packs) ? index.packs : [];
  const questDef = await get('quest');
  const bearBarks = wantBarks ? await get('barks') : null;
  const names = legacy.slice(1);
  const loaded = await Promise.all(names.map((n) => fetchUrl(n === 'tower.blade' ? QUEST_FILES.tower : n === 'burl.boars' ? QUEST_FILES.burl : QDIR + n + '.quest.json')));
  const charKit = await get('charKit');
  let giverDefs = loaded.every(Boolean) ? loaded : null; // all or none: a half book would mis-number the givers
  if (giverDefs && packNames.length) {
    const [sitesF, rewardsF, ...packs] = await Promise.all([fetchUrl(QDIR + 'sites.json'), fetchUrl(QDIR + 'rewards.json'), ...packNames.map((p) => fetchUrl(QDIR + p + '/pack.json'))]);
    const ctx = { sites: (sitesF && sitesF.sites) || {}, rewards: (rewardsF && rewardsF.tables) || {}, items };
    const ex = expandAll(packs.filter(Boolean), ctx);
    for (const e of ex.errors) { errors.push({ file: 'pack:' + (e.region || '?') + ':' + e.id, message: e.message }); log('[boot] quest ' + e.id + ': ' + e.message); }
    giverDefs = giverDefs.concat(ex.defs);
  }
  if (giverDefs) giverDefs = giverDefs.map(normalizeQuestDef); // QUEST-FORMAT (D-106): new-format files read as the legacy shape everywhere
  return { questDef, bearBarks, giverDefs, charKit, errors };
}

/** Short on-screen notice (DOM); returns the element. */
export function showBootErrors(doc, errors) {
  if (!errors.length) return null;
  const el = doc.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99;max-width:90vw;padding:8px 14px;background:#400;color:#fdd;font:14px monospace;border:1px solid #f66;white-space:pre-wrap';
  el.textContent = 'Game data missing, quests and saves are off:\n' + errors.map((e) => e.file.replace(/^.*\//, '')).join(', ');
  doc.body.appendChild(el);
  return el;
}
