// game/js/quest/sim/archetypes.test.js (BEAST-03a). Validates archetypes.js + beastKinds.js + the new state numbers.
// Run: node game/js/quest/sim/archetypes.test.js
import { ARCHETYPES, ARCH_NAMES, ARCH_AGGRO, ARCH_ROLES, ARCH_MEDIA, ARCH_WHEN, archIndex } from './archetypes.js';
import { KINDS, KIND_NAMES, kindIndex, kindOfEntity, archetypeOf } from './beastKinds.js';
import { COMBAT_TARGETS, BEAST_DEFAULTS } from './beastConfig.js';
import { wolfOverrides } from './wolfBrain.js';
import { bearOverrides } from './bearBrain.js';
import { goblinOverrides } from './goblinBrain.js';
import * as S from './beastSim.js';

let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) pass++; else fails.push(n + (d ? ' :: ' + d : '')); };
const inR = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

ok('11 archetypes', ARCH_NAMES.length === 11, String(ARCH_NAMES.length));
for (const n of ARCH_NAMES) {
  const a = ARCHETYPES[n];
  ok(n + ' frozen', Object.isFrozen(a));
  ok(n + ' ranges', inR(a.noticeR, 1, 40) && inR(a.nearR, 0, a.noticeR) && inR(a.coneCos, -1, 1) && inR(a.noticeSec, 0.1, 2) &&
    inR(a.loseR, 5, 100) && inR(a.loseSightSec, 1, 20) && inR(a.leashR, 5, 1e9) && inR(a.walk, 0.3, 4) && inR(a.run, 1, 10) && a.run >= a.walk &&
    inR(a.keepMin, 0, 30) && inR(a.keepMax, a.keepMin, 30) && inR(a.backOffR, 0, 20), n);
  ok(n + ' enums', ARCH_AGGRO.includes(a.aggro) && ARCH_ROLES.includes(a.role) && ARCH_MEDIA.includes(a.medium) && ARCH_WHEN.includes(a.when), n);
  ok(n + ' index', archIndex(n) === ARCH_NAMES.indexOf(n) && archIndex(n) >= 0);
}
ok('arch count fits Uint8', ARCH_NAMES.length < 256);

ok('33 kinds', KIND_NAMES.length === 33, String(KIND_NAMES.length));
const names = new Set(), models = [];
const RESP = ['grazer', 'common', 'pack', 'elite', 'camp', 'boss'];
for (const k of KIND_NAMES) {
  const d = KINDS[k];
  ok(k + ' frozen', Object.isFrozen(d) && Object.isFrozen(d.attacks));
  ok(k + ' arch exists', !!ARCHETYPES[d.arch], d.arch);
  ok(k + ' plain name', /^[A-Z][A-Za-z'-]*( [A-Za-z'-]+)*$/.test(d.name) && !/relay/i.test(d.name) && !/\d|_/.test(d.name), d.name);
  ok(k + ' unique name', !names.has(d.name)); names.add(d.name);
  ok(k + ' model', typeof d.model === 'string' && d.model.length > 0 && typeof d.todo === 'string');
  ok(k + ' lv', Array.isArray(d.lv) && inR(d.lv[0], 1, 10) && inR(d.lv[1], d.lv[0], 10));
  ok(k + ' hpF/dmgF', inR(d.hpF, 0.1, 6) && inR(d.dmgF, 0.1, 3));
  ok(k + ' group', Number.isInteger(d.group[0]) && Number.isInteger(d.group[1]) && d.group[0] >= 1 && d.group[1] >= d.group[0] && d.group[1] <= 10);
  ok(k + ' respawn', RESP.includes(d.respawn), d.respawn);
  ok(k + ' attacks 1..3', d.attacks.length >= 1 && d.attacks.length <= 3);
  const ids = new Set();
  for (const a of d.attacks) {
    ok(k + '.' + a.id + ' fields', inR(a.range, 0.5, 30) && inR(a.activeSec, 0.1, 4) && inR(a.recoverSec, 0.3, 4) && inR(a.cooldownSec, 0.5, 60) && inR(a.dmgF, 0, 3) && inR(a.weight, 1, 10) &&
      ['melee', 'charge', 'lunge', 'projectile', 'aoe', 'grab', 'dive', 'heal', 'cast'].includes(a.type));
    ok(k + '.' + a.id + ' windup >= floor', a.windupSec >= COMBAT_TARGETS.windupMinSec, String(a.windupSec));
    ok(k + '.' + a.id + ' big attack windup', !(['aoe', 'grab'].includes(a.type) && a.dmgF >= 1.5) || a.windupSec >= 0.8, a.id);
    ok(k + '.' + a.id + ' unique', !ids.has(a.id)); ids.add(a.id);
  }
  if (d.walk !== undefined) ok(k + ' speed override', inR(d.walk, 0.3, 4) && inR(d.run, d.walk, 10));
  ok(k + ' kindIndex', kindIndex(k) === KIND_NAMES.indexOf(k));
  ok(k + ' archetypeOf', archetypeOf(k) === ARCHETYPES[d.arch]);
}
ok('kind count fits Uint8', KIND_NAMES.length < 256);
ok('night kinds exist', KIND_NAMES.some((k) => KINDS[k].when === 'night'));

// the four live brains: kind speeds/windups equal what beastSim actually uses (no behaviour change)
const near = (a, b) => Math.abs(a - b) < 1e-9;
const wo = wolfOverrides(BEAST_DEFAULTS), bo = bearOverrides(BEAST_DEFAULTS), go = goblinOverrides(BEAST_DEFAULTS, 'melee'), gt = goblinOverrides(BEAST_DEFAULTS, 'thrower');
ok('wolf kind speeds = live', near(KINDS.grey_wolf.walk, wo.walk) && near(KINDS.grey_wolf.run, wo.chase));
const wbite = KINDS.grey_wolf.attacks.find((x) => x.id === 'bite'); // OB-220: wolves bite in melee (data row `bite`)
ok('wolf bite windup/range = live', near(wbite.windupSec, wo.windupSec) && near(wbite.range, wo.windupR));
ok('bear kind speeds/windup = live', near(KINDS.black_bear.walk, bo.walk) && near(KINDS.black_bear.run, bo.chase) && near(KINDS.black_bear.attacks[0].windupSec, bo.windupSec) && near(KINDS.black_bear.attacks[0].range, bo.windupR));
ok('goblin kind speeds/windup = live', near(KINDS.goblin_warrior.walk, go.walk) && near(KINDS.goblin_warrior.run, go.chase) && near(KINDS.goblin_warrior.attacks[0].windupSec, go.windupSec));
ok('thrower windup = live', near(KINDS.goblin_spear_thrower.attacks[0].windupSec, gt.windupSec));
ok('boar run/walk = defaults', near(archetypeOf('boar').run, BEAST_DEFAULTS.chase) && near(archetypeOf('boar').walk, BEAST_DEFAULTS.walk));

// entity -> kind mapping for the built-in brains
const E = (b) => ({ components: { brain: b } });
ok('map boar', kindOfEntity(E({ kind: 'beast' })) === 'boar');
ok('map wolf', kindOfEntity(E({ kind: 'beast', species: 'wolf' })) === 'grey_wolf');
ok('map bear', kindOfEntity(E({ kind: 'beast', species: 'bear' })) === 'black_bear');
ok('map goblin', kindOfEntity(E({ kind: 'beast', species: 'goblin', role: 'melee' })) === 'goblin_warrior');
ok('map thrower', kindOfEntity(E({ kind: 'beast', species: 'goblin', role: 'thrower' })) === 'goblin_spear_thrower');
ok('map explicit', kindOfEntity(E({ kind: 'beast', beastKind: 'lynx' })) === 'lynx');

// states: 0-13 unchanged, 14-23 new and unique
const old = [S.STATE_WANDER, S.STATE_NOTICE, S.STATE_CHASE, S.STATE_WINDUP, S.STATE_CHARGE, S.STATE_RECOVER, S.STATE_RETURN, S.STATE_STAGGER, S.STATE_FLINCH, S.STATE_DYING, S.STATE_CORPSE, S.STATE_SINK, S.STATE_GONE, S.STATE_EAT];
ok('states 0-13 unchanged', old.every((v, i) => v === i));
const nw = [S.STATE_GRAZE, S.STATE_PATROL, S.STATE_FLEE, S.STATE_STUCK, S.STATE_CIRCLE, S.STATE_HIDDEN, S.STATE_SUBMERGED, S.STATE_GRAB, S.STATE_AIRBORNE, S.STATE_CAST];
ok('states 14-23 as specified', nw.every((v, i) => v === 14 + i));

console.log(`archetypes: ${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
