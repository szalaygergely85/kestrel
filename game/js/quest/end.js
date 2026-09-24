// game/js/quest/end.js (US-017, D-006/D-008, D-011 reskin). The real body of
// `quest.end`, named by `design/levels/tower.js`'s trigger `{ id: 'end',
// cells: [...], walkTo: {x,y}, pitchTo, trigger: 'quest.end' }`. No literal
// coordinate here (US-010 tech note 1 rule): the walk target is `origin +
// def.walkTo`, `origin` resolved from `world.structures[]` by the
// `structId` the engine hands the behaviour (`updateTriggers`/
// `World.fireTrigger`, engine/world/triggers.js), never a constant.
//
// Tech notes (architect, 2026-09-23), docs/backlog.md US-017 item 2:
// `quest.end` sets `world.state['quest.endT'] = 0` and returns `true`; a
// per-step function (`stepEnd`, called from main.js's fixed step, after
// `updateTriggers`) advances it and drives the scripted walk + pitch.
// `main.js` reads `endT` itself to drive the scene fade and the end card.
//
// Timings: `WALK_SEC`/`FADE_SEC`/`GAP_SEC`/`TYPE_CPS` are the AC fallback
// (1.5 s walk, 2 s fade, 1.5 s gap, 30 chars/s) - `ASSETS.uiStyle.endText`/
// `uiStyle.fade` don't exist yet (US-015 is still `design`, per its story's
// "Known limitations" note on US-012); `readTimings` already reads them
// when present, so no code changes are needed once that art lands.

export const WALK_SEC = 1.5;
export const FADE_SEC = 2.0;
export const GAP_SEC = 1.5;
export const TYPE_CPS = 30;

/** @param {Object} [uiStyle] - `ASSETS.uiStyle`, may be undefined. */
export function readEndTimings(uiStyle) {
  const e = uiStyle && uiStyle.endText;
  const f = uiStyle && uiStyle.fade;
  return {
    walkSec: (e && typeof e.walkSec === 'number') ? e.walkSec : WALK_SEC,
    fadeSec: (f && typeof f.sec === 'number') ? f.sec : FADE_SEC,
    gapSec: (e && typeof e.gapSec === 'number') ? e.gapSec : GAP_SEC,
    cps: (e && typeof e.cps === 'number') ? e.cps : TYPE_CPS,
  };
}

function ease(t) { return t * t * (3 - 2 * t); } // smoothstep, same curve World.js's sector animation uses

/**
 * `quest.end` behaviour (fired once, on the trigger's enter edge). Stores
 * the scripted walk on the actor's own `components.body` under a `_`
 * prefixed key - transient scratch, stripped by `serialize.js`'s
 * `stripScratch` (same convention as `integrate.js`'s `_move`/
 * `_collideOpts`), never part of a save.
 */
export function questEnd(ctx) {
  const { world, def, entity, structId } = ctx;
  if (!entity || !entity.transform) return false;

  const struct = world.structures.find((s) => s.id === structId);
  const ox = struct ? struct.origin.x : 0, oy = struct ? struct.origin.y : 0;
  const tx = ox + ((def.walkTo && def.walkTo.x) || 0);
  const ty = oy + ((def.walkTo && def.walkTo.y) || 0);

  const x0 = entity.transform.x, y0 = entity.transform.y;
  const dx = tx - x0, dy = ty - y0;
  const len = Math.hypot(dx, dy);

  const body = entity.components.body || (entity.components.body = {});
  body._endWalk = {
    x0, y0,
    dirX: len > 1e-6 ? dx / len : 0,
    dirY: len > 1e-6 ? dy / len : 0,
    pitch0: entity.transform.pitchDeg,
    pitchTo: typeof def.pitchTo === 'number' ? def.pitchTo : entity.transform.pitchDeg,
  };

  world.state['quest.endT'] = 0;
  return true;
}

/**
 * Per fixed step, while `world.state['quest.endT'] >= 0` (main.js calls this
 * unconditionally after `updateTriggers`; a no-op the rest of the time).
 * Advances `endT` by `dt`, and - only through `WALK_SEC` - moves the actor
 * toward the stored walk target (capped at 1 m total, through `moveCapsule`
 * so it cannot clip) and eases its pitch toward `pitchTo`. Reuses the
 * actor's own collision scratch (`body._move`/`_collideOpts`, already
 * populated by `integrate()` this same step, which always runs first in the
 * fixed-step order) - no allocation here (rule 9).
 * @param {import('../../../engine/index.js').World} world
 * @param {{transform:Object, components:{body:Object}}} actor
 * @param {number} dt
 * @param {Object|undefined} uiStyle - `ASSETS.uiStyle`, may be undefined.
 * @param {Function} moveCapsule
 */
export function stepEnd(world, actor, dt, uiStyle, moveCapsule) {
  const endT = world.state['quest.endT'];
  if (typeof endT !== 'number' || endT < 0) return;

  const t = endT + dt;
  world.state['quest.endT'] = t;

  const { walkSec } = readEndTimings(uiStyle);
  const body = actor.components.body;
  const ew = body && body._endWalk;
  if (!ew || t > walkSec) return; // walk/pitch phase only - the fade/text phases are timing only (main.js reads endT itself)

  const frac = t / walkSec > 1 ? 1 : t / walkSec;
  const wantX = ew.x0 + ew.dirX * frac; // total displacement capped to 1 m (the unit direction * frac<=1)
  const wantY = ew.y0 + ew.dirY * frac;
  const dx = wantX - actor.transform.x, dy = wantY - actor.transform.y;
  if (dx !== 0 || dy !== 0) {
    const out = body._move || { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0 };
    const opts = body._collideOpts || { height: body.height, stepUpMax: 0 };
    moveCapsule(world, actor.transform.x, actor.transform.y, dx, dy, body.radius, actor.transform.z, body.grounded, opts, out);
    actor.transform.x = out.x;
    actor.transform.y = out.y;
  }
  actor.transform.pitchDeg = ew.pitch0 + (ew.pitchTo - ew.pitch0) * ease(frac);
}

/**
 * Current scene-fade amount for `fb.sceneFade` (1 = no fade, 0 = fully
 * faded) - main.js reads this every rendered frame while `endT >= 0`.
 */
export function endFadeAmount(world, uiStyle) {
  const endT = world.state['quest.endT'];
  if (typeof endT !== 'number' || endT < 0) return 1;
  const { walkSec, fadeSec } = readEndTimings(uiStyle);
  if (endT <= walkSec) return 1;
  const f = (endT - walkSec) / fadeSec;
  return 1 - (f > 1 ? 1 : f);
}
