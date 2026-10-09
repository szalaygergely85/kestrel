// HIT-SPARK-WIRE (lane B1): `combat:hit` (player's sword) -> engine/fx/hitSparks.js burst at the hit point.
// Normal points back toward the attacker (-dir); fallback is target -> player. Gold normally, red (hue 1) on a kill.
import { defineHitSparks, hitSparks } from '../../../engine/index.js';

export function hitSparksEnabled(params, captureLike) {
  return params.get('hitsparks') === '1' && !captureLike && params.get('capture') !== '1' && params.get('fx') !== '0'; // opt-in (main session 2026-10-09): quest/particleHooks.js already bursts design 'sparks' on every hit - owner compares, then one is kept
}

/** Spark count 8..12 from damage (1 dmg = 8, +1 per extra damage, capped). */
export function sparkCount(damage) {
  const d = damage > 0 ? damage : 1;
  return Math.max(8, Math.min(12, 7 + Math.round(d)));
}

/** @returns {{dispose():void}|null} null when disabled. getPlayer() -> {x,y,z} for the fallback normal. */
export function wireHitSparks(events, particles, getPlayer, enabled) {
  if (!enabled || !particles || !events) return null;
  defineHitSparks(particles); // idempotent
  const off = events.on('combat:hit', (p) => {
    if (!p || p.source !== 'player') return;
    let nx = -(p.dirX || 0), ny = -(p.dirY || 0), nz = 0.3;
    if (nx === 0 && ny === 0) {
      const pl = getPlayer && getPlayer();
      if (pl) { nx = pl.x - p.px; ny = pl.y - p.py; nz = (pl.z - p.pz) * 0.5; } else nz = 1;
    }
    hitSparks(particles, p.px, p.py, p.pz, nx, ny, nz, sparkCount(p.damage), p.killed || p.kill ? 1 : 0);
  });
  return { dispose: off };
}
