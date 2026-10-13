// game/js/quest/equipPlay.test.js (EQ-07 + EQ-09). Run: node game/js/quest/equipPlay.test.js
// Input routing (LMB / RMB / Q per weapon set), shield raise + sword lockout + walk scale, bow draw / release / dry, arrow HUD count.
import { createHands, createStubItemSim } from './sim/hands.js';
import { createShieldSim } from './sim/shield.js';
import { syncHands } from './sim/equipment.js';
import { createEquipPlay, registerGearItems, SWAP_STEPS } from './equipPlay.js';
import { BOW_CFG } from './bowConfig.js';
import { drawArrowCount } from './vitalsView.js';
import { BOW_MIN_DRAW } from './sim/bowDraw.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL', m); } };

const defs = { sword: { equip: { slot: 'main' } }, shield: { equip: { slot: 'off' } }, bow: { equip: { slot: 'ranged' } }, arrow: { stackMax: 30, equip: { slot: 'quiver' } } };
function setup(opts = {}) {
  const events = { emit() {}, on() { return () => {}; } };
  const hands = createHands(events);
  const sword = createStubItemSim();
  hands.register('sword', sword);
  registerGearItems(hands, defs, () => createStubItemSim());
  const shots = [];
  const arrows = { stuck: { x: [], y: [], z: [] }, shoot(eq, x, y, z, fx, fy, fz, d, dmg) { if (!eq.quiver || eq.quiver.n <= 0) return false; eq.quiver.n--; shots.push({ d, dmg, fx, fz }); return true; }, step() {}, nearestPickable() { return -1; }, pickup() { return 0; } };
  const said = [];
  const shield = createShieldSim();
  const eq = { main: 'sword', off: 'shield', ranged: opts.noBow ? null : 'bow', quiver: { id: 'arrow', n: opts.arrows === undefined ? 3 : opts.arrows }, set: 'melee' };
  const player = { components: { equipment: eq, inventory: { left: null, right: null, slots: [] } } };
  const play = createEquipPlay({ hands, shield, arrows, defs, bowCfg: BOW_CFG, swordDamage: 1, say: (t) => said.push(t) });
  const ctx = { gate: true, fx: 0, fy: -1, fz: 0, ex: 0, ey: 0, ez: 1.6, px: 0, py: 0, pz: 0, interact: false };
  // one sim step exactly as main.js does it: LEFT hand follows RMB, RIGHT hand follows LMB
  function step(lmb, rmb, q = false) {
    syncHands(player.components.inventory, eq);
    const held = play.pre(player, q, ctx.gate);
    hands.step(player, !held && lmb, !held && rmb, ctx.gate) // OB-017: left hand = main = LMB;
    play.post(player, ctx);
  }
  const run = (n, l, r) => { for (let i = 0; i < n; i++) step(l, r); };
  return { play, eq, shield, shots, said, step, run, hands };
}

// --- melee set: RMB raises the shield, LMB swings the sword ---
{
  const t = setup();
  t.run(3, false, false);
  t.run(3, true, false);
  ok(t.play.swordDown === true && !t.shield.raised, 'LMB alone = sword down, shield stays low');
  t.run(3, false, false);
  t.run(10, false, true);
  ok(t.shield.raised && t.shield.blocking, 'RMB held raises + blocks the shield');
  ok(t.play.speedScale === 0.6, 'walk speed x0.6 while raised');
  ok(t.play.swordDown === false, 'sword idle while RMB alone');
  t.run(2, true, true);
  ok(t.play.swordDown === false, 'sword cannot attack while the shield is raised');
  t.run(12, false, false);
  ok(!t.shield.raised && t.play.speedScale === 1, 'releasing RMB lowers the shield and restores the speed');
}
// --- Q swaps the set (0.3 s), never locks the player beyond that ---
{
  const t = setup();
  t.step(false, false, true);
  ok(t.eq.set === 'ranged' && t.play.swapT > 0, 'Q: melee -> ranged starts the 0.3 s swap');
  t.run(SWAP_STEPS + 1, false, false);
  ok(t.play.swapT === 0, 'swap ends after 0.3 s (18 steps)');
  t.step(false, false, true);
  ok(t.eq.set === 'melee', 'Q again: back to sword + shield');
  const n = setup({ noBow: true });
  n.step(false, false, true);
  ok(n.eq.set === 'melee' && n.said.includes('No bow'), 'Q without a bow stays melee + toast');
}
// --- ranged set: hold LMB draws, release shoots; RMB does nothing ---
{
  const t = setup();
  t.step(false, false, true); t.run(SWAP_STEPS + 1, false, false);
  t.run(20, false, true);
  ok(!t.shield.raised && t.shots.length === 0, 'RMB in the bow set raises nothing');
  t.run(BOW_CFG.drawSteps + 5, true, false);
  ok(t.shots.length === 0 && t.play.bow.drawing, 'holding LMB draws (no shot yet)');
  t.run(1, false, false);
  ok(t.shots.length === 1 && t.eq.quiver.n === 2, 'release shoots one arrow, quiver 3 -> 2');
  ok(Math.abs(t.shots[0].d - 1) < 1e-9 && t.shots[0].dmg === 3, 'full draw = draw 1, damage 3');
  t.run(30, false, false);
  t.run(BOW_MIN_DRAW - 2, true, false); t.run(1, false, false);
  ok(t.shots.length === 1, 'a release before the minimum draw cancels');
  t.run(30, false, false);
  t.run(20, true, false); t.run(1, false, false);
  ok(t.shots.length === 2 && t.shots[1].d < 0.5, 'a short draw shoots weaker');
}
// --- no arrows: toast once per press, no shot ---
{
  const t = setup({ arrows: 0 });
  t.step(false, false, true); t.run(SWAP_STEPS + 1, false, false);
  t.run(40, true, false);
  ok(t.shots.length === 0 && t.said.filter((s) => s === 'No arrows').length === 1, 'empty quiver: "No arrows" once, no shot');
}
// --- HUD: arrow count next to the hearts ---
{
  const cells = [];
  const ui = { setCellRGB(x, y, code) { cells.push([x, y, String.fromCharCode(code + 32)]); } };
  const style = { layout: { x: 2, hpRow: 1, numberCol: 26 }, textBg: [0, 0, 0] };
  drawArrowCount(ui, style, 12, true);
  const text = cells.filter((c) => c[1] === 1).map((c) => c[2]).join('');
  ok(text.trim() === '}> 12', 'arrow count text ' + text);
  const before = cells.length; drawArrowCount(ui, style, 5, false);
  ok(cells.length === before, 'hidden HUD draws nothing');
}
console.log(`equipPlay.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
