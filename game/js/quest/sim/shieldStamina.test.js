// game/js/quest/sim/shieldStamina.test.js (SHIELD-STAMINA-01). Run: node game/js/quest/sim/shieldStamina.test.js
import { World } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS as CFG } from './vitalsConfig.js';
import { createShieldSim, SHIELD_DEFAULTS as SC } from './shield.js';
import { createStaminaState } from '../stamina.js';

const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
function makeEvents() {
  const l = new Map();
  return { on(n, fn) { let s = l.get(n); if (!s) { s = new Set(); l.set(n, s); } s.add(fn); return () => s.delete(fn); },
    emit(n, p) { const s = l.get(n); if (s) for (const fn of Array.from(s)) fn(p); } };
}
function setup(noStamina) {
  const ents = [
    { id: 'player', type: 'player', x: 0, y: 0, z: 0, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } } },
    { id: 'b1', type: 'beast', x: 0, y: 0, z: 0, components: {} },
  ];
  const world = World.load({ name: 't', terrain: null, structures: [], entities: ents, state: {} }, assets, {});
  const events = makeEvents();
  const shield = createShieldSim(), sta = createStaminaState();
  if (!noStamina) shield.attachStamina(sta);
  const vitals = createVitals(world, events, CFG, { block: shield });
  const player = world.get('player').data;
  vitals.step(player, false);
  for (let i = 0; i < 20; i++) shield.step(true, true, 1, 0);
  return { world, events, shield, sta, vitals, player, src: world.get('b1').data };
}
function hit(t, ang, damage, cause) {
  const a = ang * Math.PI / 180;
  t.src.transform.x = Math.cos(a) * 3; t.src.transform.y = Math.sin(a) * 3;
  const hp0 = t.player.components.health.hp;
  const p = { source: 'b1', target: 'player', damage, heavy: 0, cause: cause || 'bite', blocked: 0, dirX: 0, dirY: 0 };
  if (cause === 'arrow') { p.ranged = 1; p.dirX = -Math.cos(a); p.dirY = -Math.sin(a); }
  t.events.emit('combat:hit', p);
  return { lost: hp0 - t.player.components.health.hp, blocked: p.blocked };
}

{ const t = setup(); ok(t.shield.blocking, 'raised');
  const r = hit(t, 0, 2); ok(r.blocked === 1 && r.lost === 0, 'melee blocked, no damage');
  ok(t.sta.stamina === 100 - (SC.blockDrainBase + SC.blockDrainPerDamage * Math.round(2 * CFG.beastDamageScale)) || t.sta.stamina < 100, 'drain per block');
  const s1 = t.sta.stamina; hit(t, 0, 6); ok(100 - t.sta.stamina > 100 - s1 + 0 && t.sta.stamina < s1, 'bigger hit drains more than none');
  const bigDrain = s1 - t.sta.stamina;
  const t2 = setup(); hit(t2, 0, 1); const d1 = 100 - t2.sta.stamina;
  ok(bigDrain > d1, 'drain scales with damage (' + bigDrain + ' > ' + d1 + ')'); }
{ const t = setup(); let n = 0;
  while (t.sta.stamina > 0 && n++ < 50) hit(t, 0, 4);
  ok(t.sta.stamina === 0 && t.shield.locked && !t.shield.blocking && !t.shield.raised, 'shield drops at 0 stamina');
  for (let i = 0; i < 20; i++) t.shield.step(true, true, 1, 0);
  ok(!t.shield.raised, 'cannot raise while locked');
  const r = hit(t, 0, 4); ok(r.blocked === 0 && r.lost > 0, 'unblocked hit hurts while down');
  t.sta.stamina = SC.reraiseAt - 1; t.shield.step(true, true, 1, 0); ok(t.shield.locked, 'still locked below threshold');
  t.sta.stamina = SC.reraiseAt; for (let i = 0; i < 20; i++) t.shield.step(true, true, 1, 0);
  ok(!t.shield.locked && t.shield.blocking, 're-raise at threshold'); }
{ const t = setup(true); const r = hit(t, 0, 4, 'arrow'); // R6-FIX D: stamina NOT attached -> a raised shield still blocks arrows fully (as before SHIELD-STAMINA-01)
  ok(r.lost === 0 && r.blocked === 1 && !t.shield.hasStamina, 'no stamina attached: front arrow fully blocked'); }
{ const t = setup(); const r = hit(t, 0, 4, 'arrow'), full = Math.round(4 * CFG.beastDamageScale);
  ok(r.lost === Math.round(full * 0.5) && r.lost > 0, 'front arrow takes 50% (' + r.lost + ' of ' + full + ')');
  ok(t.sta.stamina < 100, 'arrow block drains stamina');
  const t2 = setup(); const s = hit(t2, 90, 4, 'arrow'); ok(s.lost === full && s.blocked === 0, 'side arrow full');
  const b = hit(t2, 180, 4, 'arrow'); ok(b.lost === full, 'back arrow full');
  ok(t2.sta.stamina === 100, 'no drain on unblocked'); }
console.log('shieldStamina: ' + pass + ' pass, ' + fail + ' fail'); if (fail) { console.log(failures.join('\n')); process.exit(1); }
