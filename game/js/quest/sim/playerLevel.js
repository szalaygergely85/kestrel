// PLAYER-LEVEL-01 (D-105/D-106): HIDDEN character level from gear + spell tiers; only used to gate quests (minLevel). Never displayed.
// Level = clamp(round(1 + wGear*G + wSpell*T)); G = mean iL of the top-5 equipped items (missing = 0), T = tMax*min(S,cap)/cap, S = sum of spell tiers.
// Pure, 0 alloc. Legacy plain gear (no instance) counts iL 1; spells in a hand slot are not gear.
import { EQUIP_SLOTS } from './equipment.js';
import { itemLevelOf, wornIt } from './itemInst.js';
import { PLAYER_LEVEL as CFG } from '../playerLevelConfig.js';

const top = new Float64Array(CFG.top), probe = { id: null, it: null };

/** @param eq player equipment ({slot: id, it?}) @param spellbook components.spellbook ({learned:{id:tier}}) or null @param defs item defs @param cfg optional weights */
export function playerLevel(eq, spellbook, defs, cfg = CFG) {
  const n = cfg.top; for (let i = 0; i < n; i++) top[i] = 0;
  if (eq) for (let i = 0; i < EQUIP_SLOTS.length; i++) {
    const s = EQUIP_SLOTS[i], id = eq[s];
    if (id == null || s === 'quiver') continue;
    const d = defs && defs[id]; if (d && d.kind === 'spell') continue;
    probe.id = id; probe.it = wornIt(eq, s, defs || {});
    let v = itemLevelOf(probe, defs); if (v < 1 && !(d && d.equip)) continue; if (v < 1) v = 1;
    // insert into the sorted-descending top list (smallest at the end)
    if (v > top[n - 1]) { let k = n - 1; while (k > 0 && top[k - 1] < v) { top[k] = top[k - 1]; k--; } top[k] = v; }
  }
  let sum = 0; for (let i = 0; i < n; i++) sum += top[i];
  const G = sum / n;
  let S = 0; const l = spellbook && spellbook.learned;
  if (l) for (const k in l) S += l[k] > 0 ? l[k] : 0;
  const T = cfg.tMax * Math.min(S, cfg.spellTierCap) / cfg.spellTierCap;
  const lv = Math.round(1 + cfg.wGear * G + cfg.wSpell * T);
  return lv < cfg.min ? cfg.min : lv > cfg.max ? cfg.max : lv;
}
