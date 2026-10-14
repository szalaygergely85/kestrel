// HPBAR-02 / DMGNUM-01: the Settings "Combat HUD" switches. Live module flags (same pattern as comfort.js): set at boot from the saved
// blob and by the Settings panel; both default On. Off -> the HUD modules do nothing (no model calls, no spawns).
let bars = true, nums = true;
export function setEnemyBarsOn(v) { bars = v !== false; }
export function enemyBarsOn() { return bars; }
export function setDamageNumbersOn(v) { nums = v !== false; }
export function damageNumbersOn() { return nums; }
