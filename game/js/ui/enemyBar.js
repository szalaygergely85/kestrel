// HPBAR-01 (D-086): enemy health bar MODEL. Pure, no draw, no DOM, 0 allocation per call (result objects are reused).
// Beast record (filled by the host adapter, see combatHud.js): { id, name, x, y, z (head), spawnX, spawnY, hp, maxHp, dead, dist,
//   visible, engaged, targeted, hitAt (seconds on the same clock as `now`; -Infinity = never), level (0 = use the band), bossName ('' = none) }.
// band = createBand(...) result (bandAt(x, y) -> 1..10). Tint is a palette key: danger (>= +2 over the player), gold (+-1), uiDim (<= -2).
export const HIT_SHOW_SEC = 4;
export const SHOW_RANGE_M = 30;
export const MAX_BARS = 3;

const DIFF_RED = 2, DIFF_GREY = -2;

/** HPBAR-03: shown-level shift per difficulty name (Easy -1, Normal 0, Hard +1). Unknown / absent -> 0. */
export function diffShift(name) { return name === 'easy' ? -1 : name === 'hard' ? 1 : 0; }

export function makeBarResult() {
  return { show: false, frac: 0, level: 0, name: '', tint: 'gold', id: '', x: 0, y: 0, z: 0, dist: 0, engaged: false, boss: false };
}
const _res = makeBarResult();

/** Fills + returns `out` (default: one shared object - read it before the next call). */
export function enemyBarModel(beast, band, now, playerBand = 1, out = _res, shift = 0) {
  out.show = false;
  if (!beast || beast.dead || !(beast.hp > 0) || !(beast.maxHp > 0) || !beast.visible || !(beast.dist <= SHOW_RANGE_M)) return out;
  const relevant = beast.engaged || beast.targeted || (now - beast.hitAt) <= HIT_SHOW_SEC;
  if (!relevant) return out;
  const f = beast.hp / beast.maxHp;
  out.frac = f < 0 ? 0 : f > 1 ? 1 : f;
  out.boss = !!beast.bossName;
  if (out.boss) { out.level = 0; out.name = beast.bossName; out.tint = 'danger'; }
  else {
    const lv = beast.level > 0 ? beast.level | 0 : (band ? band.bandAt(beast.spawnX, beast.spawnY) : 1);
    const sl = lv + shift; // HPBAR-03: band + difficulty shift, clamped 1..10
    out.level = sl < 1 ? 1 : sl > 10 ? 10 : sl;
    out.name = beast.name;
    const d = out.level - playerBand;
    out.tint = d >= DIFF_RED ? 'danger' : d <= DIFF_GREY ? 'uiDim' : 'gold';
  }
  out.id = beast.id; out.x = beast.x; out.y = beast.y; out.z = beast.z; out.dist = beast.dist; out.engaged = !!beast.engaged;
  out.show = true;
  return out;
}

/** Picks up to MAX_BARS bars from `count` beasts: engaged first, then nearest, ties by id. fill(i, rec) fills the reused record.
 * Returns the number of bars; results live in `bars.list[0..n)` (stable objects, overwritten next call). */
export function createEnemyBars({ band = null, maxBars = MAX_BARS, difficulty = 'normal' } = {}) {
  let shift = diffShift(difficulty);
  const rec = { id: '', name: '', x: 0, y: 0, z: 0, spawnX: 0, spawnY: 0, hp: 0, maxHp: 0, dead: false, dist: 0, visible: true, engaged: false, targeted: false, hitAt: -Infinity, level: 0, bossName: '' };
  const tmp = makeBarResult();
  const list = [];
  for (let i = 0; i < maxBars; i++) list.push(makeBarResult());
  let n = 0;
  const before = (a, b) => (a.engaged !== b.engaged ? a.engaged : a.dist !== b.dist ? a.dist < b.dist : a.id < b.id);
  function copy(to, from) {
    to.show = from.show; to.frac = from.frac; to.level = from.level; to.name = from.name; to.tint = from.tint; to.id = from.id;
    to.x = from.x; to.y = from.y; to.z = from.z; to.dist = from.dist; to.engaged = from.engaged; to.boss = from.boss;
  }
  function select(count, fill, now, playerBand = 1) {
    n = 0;
    for (let i = 0; i < count; i++) {
      fill(i, rec);
      enemyBarModel(rec, band, now, playerBand, tmp, shift);
      if (!tmp.show) continue;
      let at = n;
      while (at > 0 && before(tmp, list[at - 1])) at--;
      if (at >= maxBars) continue;
      const last = n < maxBars ? n : maxBars - 1;
      // shift [at, last) one down by swapping contents (objects stay stable)
      for (let k = last; k > at; k--) copy(list[k], list[k - 1]);
      copy(list[at], tmp);
      if (n < maxBars) n++;
    }
    return n;
  }
  return { select, list, get count() { return n; }, setBand(b) { band = b; }, setDifficulty(name) { shift = diffShift(name); } };
}
