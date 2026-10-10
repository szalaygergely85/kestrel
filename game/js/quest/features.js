// Feature flags (owner D-065, 2026-10-10): the fireball spell (fist charge cast, projectile, explosion, MP cost, MP bar)
// is OFF for now. `?fireball=1` brings it back for dev; the modules (sim/fireball.js, fireballView.js) stay untouched.
export function featuresFromParams(params) {
  return { fireball: !!params && params.get('fireball') === '1' };
}
