// game/js/quest/sim/lightOrb.js (SPELL-05, docs/epics/ep-spells.md section 2 Light/Light Orb). One teal light that follows the player
// 2.2 m up. While it burns, beasts of level <= the tier's keepOutLevel inside its radius do not START aggro (beastSim.setCalm: the
// "woken waystone light" rule); at tier 3 beasts inside at cast time flee for `flee` seconds. Recast refreshes (one alive).
// All numbers: spellDefs.js (SPELL_DEFS.lightOrb.tiers). Rule 15 (sim/**): no Math.random, no trig, integer steps, 0 alloc in step.
import { SPELL_DEFS } from '../spellDefs.js';

const TIERS = SPELL_DEFS.lightOrb.tiers;

/**
 * @param {{emit:Function}} events @param {() => any} getBeasts live beastSim (rebuilt per world) or null
 * @param {{spendMana?:(n:number)=>boolean, tier?:()=>number}} [hooks]
 */
export function createLightOrbSim(events, getBeasts, hooks) {
  const h = hooks || {};
  let alive = 0, left = 0, cooldown = 0, tick = 0, row = TIERS[0], tierNo = 1, refused = 0;
  const orb = { x: 0, y: 0, z: 0, r: 0 };
  const castPayload = { x: 0, y: 0, z: 0, radius: 0, tier: 1, refresh: false };
  const endPayload = { x: 0, y: 0, z: 0 };

  function place(player) { const t = player.transform; orb.x = t.x; orb.y = t.y; orb.z = t.z + row.height; orb.r = row.lightR; }
  function stop() {
    if (!alive) return;
    alive = 0; left = 0;
    const b = getBeasts(); if (b && b.setCalm) b.setCalm(false, 0, 0, 0, 0);
    endPayload.x = orb.x; endPayload.y = orb.y; endPayload.z = orb.z;
    events.emit('lightOrb:end', endPayload);
  }
  return {
    orb,
    get alive() { return alive === 1; }, get stepsLeft() { return left; }, get cooldown() { return cooldown; }, get refused() { return refused; }, get tier() { return tierNo; },
    /** Dispatcher entry. 'cast' | 'busy' (cooldown) | 'noMana'. */
    cast(player) {
      if (cooldown > 0) return 'busy';
      let t = h.tier ? h.tier() | 0 : 1; t = t < 1 ? 1 : t > 3 ? 3 : t;
      const r = TIERS[t - 1];
      if (h.spendMana && !h.spendMana(r.mana)) { refused++; return 'noMana'; }
      const refresh = alive === 1;
      row = r; tierNo = t; cooldown = Math.round(r.cd * 60); left = Math.round(r.dur * 60); alive = 1;
      place(player);
      const b = getBeasts();
      if (b && b.setCalm) {
        b.setCalm(true, orb.x, orb.y, orb.r, r.keepOutLevel);
        if (r.flee > 0 && b.calmFlee) b.calmFlee(orb.x, orb.y, orb.r, r.keepOutLevel, Math.round(r.flee * 60));
      }
      castPayload.x = orb.x; castPayload.y = orb.y; castPayload.z = orb.z; castPayload.radius = orb.r; castPayload.tier = t; castPayload.refresh = refresh;
      events.emit('lightOrb:cast', castPayload);
      return 'cast';
    },
    step(player) {
      tick++;
      if (cooldown > 0) cooldown--;
      if (alive === 0) return;
      place(player);
      const b = getBeasts(); if (b && b.setCalm) b.setCalm(true, orb.x, orb.y, orb.r, row.keepOutLevel);
      if (--left <= 0) stop();
    },
    stop,
    dispose() { stop(); },
    hashInto(hh) { hh.u32(alive); hh.u32(left); hh.u32(cooldown); hh.u32(tierNo); if (alive) { hh.f64(orb.x); hh.f64(orb.y); hh.f64(orb.z); } },
  };
}
