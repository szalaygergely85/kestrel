// OB-129: every Prop_Chimney2 stands on/in a building: >= 3 wall/floor/roof/corner pieces within 6 m (no lone chimneys in the meadow).
// OB-130: the shelf mushroom Mushroom_Laetiporus is placed nowhere.
import fs from 'node:fs';
const w = JSON.parse(fs.readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const all = w.structures || [];
const bad = [];
for (const c of all.filter((s) => /Prop_Chimney/.test(s.mesh))) {
  const n = all.filter((s) => s !== c && /\/(Wall_|Floor_|Roof_|Corner_|Door|Window)/.test(s.mesh) && Math.hypot(s.origin.x - c.origin.x, s.origin.y - c.origin.y) <= 6).length;
  if (n < 3) bad.push(`${c.id} (${c.origin.x}, ${c.origin.y}) has ${n} building pieces`);
}
const lae = all.filter((s) => /Mushroom_Laetiporus/.test(s.mesh)).map((s) => s.id);
if (bad.length || lae.length) { console.error('FAIL', bad, lae); process.exit(1); }
console.log('chimney-attached: ok (' + all.filter((s) => /Prop_Chimney/.test(s.mesh)).length + ' chimneys, 0 Laetiporus)');
