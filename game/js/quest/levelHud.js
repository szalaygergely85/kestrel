// PLAYER-LEVEL-01 / SPELL-R8: HUD "Lv N" after the HP number; on a rise it shows "Level up! N" for 2 s.
// The level is recomputed every frame from the worn gear + spell book (power.js, 0 alloc), so equip, unequip, spell
// learn and Spell Scroll use all update it without hooks; it is never saved. No "XP" anywhere (D-084).
import { playerLevel, hudLevelText, levelUpText } from './sim/power.js';

export const LEVEL_UP_SEC = 2;
const FG = [226, 214, 176], UP_FG = [255, 214, 90];
const state = { world: null, level: 0, upUntil: -1, text: '', key: -1 };

/** Pure step (Node-testable): returns the text to show. `world` change = new game / Continue: no flash for that first value. */
export function stepLevelHud(world, level, simTime) {
  if (state.world !== world) { state.world = world; state.level = level; state.upUntil = -1; }
  else if (level > state.level) { state.level = level; state.upUntil = simTime + LEVEL_UP_SEC; }
  else state.level = level;
  const up = simTime < state.upUntil, key = level * 2 + (up ? 1 : 0);
  if (key !== state.key) { state.key = key; state.text = up ? levelUpText(level) : hudLevelText(level); }
  return state.text;
}
export function levelHudFlashing(simTime) { return simTime < state.upUntil; }
export function resetLevelHud() { state.world = null; state.level = 0; state.upUntil = -1; state.key = -1; state.text = ''; }

/** Draws on the HP row, 12 cells right of the HP number (after the heart-piece marks). */
export function drawPlayerLevel(ui, world, style, simTime, visible, spells, defs) {
  if (!style || !world) return;
  const h = world.get('player'), c = h && h.data && h.data.components;
  if (!c || !c.health) return;
  const s = stepLevelHud(world, playerLevel(spells, c.equipment, defs), simTime);
  if (!visible) return;
  const L = style.layout, x0 = L.x + L.numberCol + 12, y = L.hpRow, bg = style.textBg || [0, 0, 0], fg = levelHudFlashing(simTime) ? UP_FG : FG;
  for (let i = 0; i < s.length; i++) ui.setCellRGB(x0 + i, y, s.charCodeAt(i) - 32, fg[0], fg[1], fg[2], bg[0] | 0, bg[1] | 0, bg[2] | 0);
}
