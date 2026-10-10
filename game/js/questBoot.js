// AUD2-09: quest/save boot files, one fetch per file. A missing/bad file is logged by NAME and collected in `errors`
// (the caller shows an on-screen notice) instead of one silent try/catch giving a quest-less game.
export const QUEST_FILES = {
  quest: '../content/quests/m1.quest.json',
  barks: '../content/dialogue/bear.barks.json',
  tower: '../content/quests/tower.blade.quest.json',
  burl: '../content/quests/burl.boars.quest.json',
  charKit: '../content/chargen/human.charkit.json',
};

/** @param {(url:string)=>Promise<any>} getJson @returns {Promise<{questDef,bearBarks,giverDefs,charKit,errors:{file:string,message:string}[]}>} */
export async function loadQuestFiles(getJson, { wantBarks = true, log = console.error } = {}) {
  const errors = [];
  const get = async (key) => {
    try { return await getJson(QUEST_FILES[key]); } catch (e) {
      const message = String((e && e.message) || e);
      errors.push({ file: QUEST_FILES[key], message });
      log(`[boot] cannot load ${QUEST_FILES[key]}: ${message}`);
      return null;
    }
  };
  const questDef = await get('quest');
  const bearBarks = wantBarks ? await get('barks') : null;
  const tower = await get('tower'), burl = await get('burl');
  const charKit = await get('charKit');
  const giverDefs = tower && burl ? [tower, burl] : null; // both or none: a half book would mis-number the givers
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
