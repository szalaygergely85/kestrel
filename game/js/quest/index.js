// game/js/quest/index.js (US-010, D-006/D-008). Registers, BY NAME, every
// behaviour the tower level data refers to (`def.interactables[].interact`,
// `def.triggers[].trigger` in design/levels/tower.js). The engine only ever
// sees the names; the meaning lives here.
//
// US-010 ships stubs: each logs `not implemented (US-0xx)` once and returns
// false. US-012/014/015/017/022 replace the BODIES, never the names.
//
// Rule (architect, US-010 tech note 1): no literal coordinate anywhere under
// game/js/quest/. Positions come from `world.structures[i].origin` +
// `structure.level.def.*` at call time, never from constants.
import { registerBehaviour } from '../../../engine/index.js';
import { leverPull } from './lever.js';
import { lanternTake } from './lantern.js';
import { beaconLight } from './beacon.js';
import { questEnd } from './end.js';
import { request as requestHint } from './hints.js';

/** name -> the story that gives it a real body */
export const QUEST_BEHAVIOURS = {
  'lantern.take': 'US-012',
  'lever.pull': 'US-014',
  'beacon.light': 'US-022',
  'quest.end': 'US-017',
  'hint.show': 'US-015',
};

const logged = new Set();

function stub(name, story) {
  return function notImplemented(/* ctx: {world, engine, entity?, def} */) {
    if (!logged.has(name)) {
      logged.add(name);
      console.warn(`[quest] ${name}: not implemented (${story})`);
    }
    return false;
  };
}

/**
 * US-015 `hint.show` (tower.js `hintBurner`/`hintClimb`/`hintJump` triggers'
 * `trigger` name): forwards to `hints.request` with `ctx.engine.assets.uiStyle`
 * (behaviours don't otherwise see `ASSETS` - `engine.assets` is the one
 * place a named behaviour can legally reach it, same precedent as `lever.js`/
 * `lantern.js` reaching `ctx.world`/`ctx.def`). Always returns `true`: the
 * once-trigger flag is consumed even when `request` itself skips the hint
 * (`skipIfState` - a permanent skip for that hint id, per hints.js).
 */
function hintShow(ctx) {
  const uiStyle = ctx.engine && ctx.engine.assets && ctx.engine.assets.uiStyle;
  if (uiStyle && ctx.def && ctx.def.hint) requestHint(ctx.world, uiStyle, ctx.def.hint);
  return true;
}

/** name -> real implementation, for the stories that have landed (US-014: `lever.pull`). Everything else stays a stub. */
const REAL_BEHAVIOURS = {
  'lever.pull': leverPull,
  'lantern.take': lanternTake,
  'beacon.light': beaconLight,
  'quest.end': questEnd,
  'hint.show': hintShow,
};

/** (Re)registers every quest behaviour. Idempotent; the tests call it to restore a removed registration. */
export function registerQuestBehaviours() {
  for (const name of Object.keys(QUEST_BEHAVIOURS)) {
    registerBehaviour(name, REAL_BEHAVIOURS[name] || stub(name, QUEST_BEHAVIOURS[name]));
  }
}

registerQuestBehaviours();
