// OB-097: every objective of the main line (m1, tower.blade, burl.boars, mq.*) has a journal text.
import fs from 'fs';
const D = new URL('../content/quests/', import.meta.url);
let fails = 0;
const need = (q, ob) => { const j = ob.journal || (q.steps && 0); if (typeof ob.journal !== 'string' || !ob.journal || ob.journal.length > 110) { console.log('FAIL journal missing/too long:', q.id, ob.id); fails++; } };
for (const f of fs.readdirSync(D).filter(f => /^(m1|tower\.blade|burl\.boars|mq\..*)\.quest\.json$/.test(f))) {
  const q = JSON.parse(fs.readFileSync(new URL(f, D), 'utf8'));
  for (const ob of q.objectives) need(q, ob);
}
const pack = JSON.parse(fs.readFileSync(new URL('ch3/pack.json', D), 'utf8'));
for (const q of pack.quests.filter(q => q.id.startsWith('mq.'))) {
  if (q.objectives) for (const ob of q.objectives) need(q, ob);
  else for (const st of q.steps || [q]) need(q, { id: st.template, journal: st.journal });
}
console.log(fails ? 'journal-mainline: ' + fails + ' FAIL' : 'journal-mainline: PASS');
process.exit(fails ? 1 : 0);
