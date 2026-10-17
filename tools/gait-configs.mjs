// tools/gait-configs.mjs - ANIM-A-01: which clip of which model gets the option A gait, and its tuning (shared by gen-gait + the test).
// G: T = loop ms, v = m/s the clip is tuned for (= the model's `speeds`), beta = duty (stance share), bobM / liftM metres, pitch / nod / roll / yaw degrees.
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_bear.js';
import '../design/models/voxel_bear_black.js';
import '../design/models/voxel_otter.js';
import '../design/models/voxel_tortoise.js';
import '../design/models/voxel_bear_cub.js';
import '../design/models/voxel_beast.js';
import '../design/models/voxel_wildlife.js';
import '../design/models/voxel_wolf.js';
import '../design/models/voxel_goat.js';
import '../design/models/voxel_heron.js';
import '../design/models/voxel_goblin.js';

const M = () => globalThis.ASSETS.models;
const QUAD = { FL: 'armL', FR: 'armR', HL: 'legL', HR: 'legR' };
export const CONFIGS = [
  { id: 'otter.walk', model: 'otter', file: 'voxel_otter.js', clip: 'walk', body: 'body', head: 'head', tail: 'tail', legs: QUAD,
    gait: 'lateral', keys: 12, G: { T: 600, v: 0.4, beta: 0.7, bobM: 0.004, liftM: 0.012, pitch: 1.5, nod: 2, roll: 2, yaw: 2.5, tail: 5 } },
  { id: 'tortoise.walk', model: 'tortoise', file: 'voxel_tortoise.js', clip: 'walk', body: 'shell', head: 'head', neck: 'neck',
    legs: { FL: 'legFL', FR: 'legFR', HL: 'legBL', HR: 'legBR' },
    gait: 'lateral', keys: 20, G: { T: 2000, v: 0.12, beta: 0.78, bobM: 0.003, liftM: 0.012, pitch: 0.8, nod: 1.5, roll: 1.5, yaw: 1.5 } },
  { id: 'cub.walk', model: 'bearCub', file: 'voxel_bear_cub.js', clip: 'walk', body: 'body', head: 'head', ears: 'ears', legs: QUAD,
    gait: 'amble', keys: 12, G: { T: 600, v: 0.5, beta: 0.68, bobM: 0.006, liftM: 0.02, pitch: 1.5, nod: 1.5, roll: 3.5, yaw: 3 } },
  { id: 'cub.trot', model: 'bearCub', file: 'voxel_bear_cub.js', clip: 'trot', body: 'body', head: 'head', ears: 'ears', legs: QUAD,
    gait: 'diagonal', keys: 10, G: { T: 500, v: 1.2, beta: 0.5, bobM: 0.012, liftM: 0.03, pitch: 2, nod: 2, roll: 1.5, yaw: 2 } },
  { id: 'boar.walk', model: 'boarPlaceholder', file: 'voxel_beast.js', clip: 'walk', body: 'body', head: 'head', tail: 'tail', tailBase: 20,
    legs: { FL: 'legFL', FR: 'legFR', HL: 'legBL', HR: 'legBR' }, mirror: { flash: 'body' }, mirrorDz: -64,
    gait: 'diagonal', keys: 8, G: { T: 400, v: 1.5, beta: 0.5, bobM: 0.008, liftM: 0.03, pitch: 1.5, nod: 1.5, roll: 1.5, yaw: 2, tail: 6 } },
  { id: 'rabbit.walk', model: 'rabbit', file: 'voxel_wildlife.js', clip: 'walk', isNew: true, body: 'body', head: 'head', ears: ['earL', 'earR'],
    legs: { FL: 'legFL', FR: 'legFR', HL: 'legBL', HR: 'legBR' },
    gait: 'lateral', keys: 12, G: { T: 600, v: 0.15, beta: 0.7, bobM: 0.002, liftM: 0.008, pitch: 2, nod: 2.5, roll: 2, yaw: 2 } }
];
// ANIM-B-01b knee rigs (legs = { upper, lower, kind }): wolf + fox. G.v = tunedMps (legRig.gaits), beta = duty; heel / foldF / foldH degrees.
const K = (a, b, kind) => ({ upper: a, lower: b, kind });
const WOLF_LEGS = { FL: K('legFL', 'legFL2', 'fore'), FR: K('legFR', 'legFR2', 'fore'), HL: K('legBL', 'legBL2', 'hind'), HR: K('legBR', 'legBR2', 'hind') };
CONFIGS.push(
  { id: 'wolf.walk', model: 'wolf', file: 'voxel_wolf.js', clip: 'walk', body: 'body', head: 'head', tail: 'tail', tailBase: 18, legs: WOLF_LEGS,
    gait: 'diagonal', keys: 12, G: { T: 600, v: 1.1, beta: 0.55, bobM: 0.006, liftM: 0.05, pitch: 1.2, nod: 1.5, roll: 1, yaw: 1.5, tail: 4, heel: 15, foldF: 30, foldH: 25 } },
  { id: 'wolf.run', model: 'wolf', file: 'voxel_wolf.js', clip: 'run', body: 'body', head: 'head', tail: 'tail', tailBase: 70, legs: WOLF_LEGS,
    gait: 'gallop', keys: 8, G: { T: 400, v: 2.4, beta: 0.4, bobM: 0.03, liftM: 0.1, pitch: 4, nod: 3, roll: 1.5, yaw: 1.5, tail: 4, heel: 15, foldF: 25, foldH: 15 } });
const FOX_LEGS = { FL: K('legFL', 'legFL2', 'fore'), FR: K('legFR', 'legFR2', 'fore'), HL: K('legBL', 'legBL2', 'hind'), HR: K('legBR', 'legBR2', 'hind') };
const FOX = { model: 'fox', from: '// ---- legs: black stockings; forelegs', file: 'voxel_wildlife.js', body: 'body', head: 'head', tail: 'tail', ears: 'ears', legs: FOX_LEGS };
CONFIGS.push(
  Object.assign({ id: 'fox.walk', mark: 'fox.walk', clip: 'walk', gait: 'lateral', keys: 8, tailBase: 6, G: { T: 400, v: 0.45, beta: 0.625, bobM: 0.004, liftM: 0.0625, pitch: 1, nod: 2, roll: 1.5, yaw: 1.5, tail: 6, heel: 6, foldF: 30, foldH: 25 } }, FOX),
  Object.assign({ id: 'fox.trot', mark: 'fox.trot', clip: 'trot', gait: 'diagonal', keys: 6, tailBase: 16, G: { T: 300, v: 1.0, beta: 0.5, bobM: 0.01, liftM: 0.0875, pitch: 1.5, nod: 2, roll: 1, yaw: 1, tail: 4, heel: 6, foldF: 35, foldH: 30 } }, FOX),
  Object.assign({ id: 'fox.run', mark: 'fox.run', clip: 'run', gait: 'gallop', keys: 8, tailBase: 22, G: { T: 400, v: 1.3, beta: 0.35, bobM: 0.02, liftM: 0.05, pitch: 4, nod: 3, roll: 1.5, yaw: 1.5, tail: 4, heel: 6, foldF: 25, foldH: 15 } }, FOX));
export function defOf(cfg) { return M()[cfg.model].voxel; }
// ANIM-B-01c knee rigs: deer (doe + buck share buildDeer; clips are generated once) + goat. Deer 'gallop' = the flee clip.
const DEER_LEGS = { FL: K('legFL', 'legFL2', 'fore'), FR: K('legFR', 'legFR2', 'fore'), HL: K('legBL', 'legBL2', 'hind'), HR: K('legBR', 'legBR2', 'hind') };
const DEER = { model: 'deer', from: 'function buildDeer', file: 'voxel_wildlife.js', body: 'body', head: 'head', tail: 'tail', ears: 'ears', legs: DEER_LEGS };
CONFIGS.push(
  Object.assign({ id: 'deer.walk', mark: 'deer.walk', clip: 'walk', gait: 'lateral', keys: 10, tailBase: 0, G: { T: 1000, v: 0.75, beta: 0.65, bobM: 0.006, liftM: 0.05, pitch: 0.6, nod: 3, roll: 1, yaw: 1.5, tail: 3, heel: 10, foldF: 30, foldH: 25 } }, DEER),
  Object.assign({ id: 'deer.trot', mark: 'deer.trot', clip: 'trot', gait: 'diagonal', keys: 12, tailBase: 15, G: { T: 600, v: 2.4, beta: 0.5, bobM: 0.012, liftM: 0.075, pitch: 0.8, nod: 2, roll: 1, yaw: 0.5, tail: 3, heel: 10, foldF: 35, foldH: 30 } }, DEER),
  Object.assign({ id: 'deer.gallop', mark: 'deer.gallop', clip: 'gallop', gait: 'gallop', keys: 8, tailBase: 70, G: { T: 400, v: 4.2, beta: 0.35, bobM: 0.03, liftM: 0.05, pitch: 4, nod: 3, roll: 1.5, yaw: 1.5, tail: 4, heel: 10, foldF: 25, foldH: 15 } }, DEER));
CONFIGS.push(
  { id: 'goat.walk', mark: 'goat.walk', model: 'goat', file: 'voxel_goat.js', clip: 'walk', body: 'body', head: 'head', ears: 'ears', legs: { FL: K('legFL', 'legFL2', 'fore'), FR: K('legFR', 'legFR2', 'fore'), HL: K('legBL', 'legBL2', 'hind'), HR: K('legBR', 'legBR2', 'hind') },
    gait: 'lateral', keys: 8, G: { T: 800, v: 0.6, beta: 0.7, bobM: 0.004, liftM: 0.02, pitch: 1, nod: 1.5, roll: 1.5, yaw: 1.5, heel: 8, foldF: 25, foldH: 20 } });
// ANIM-B-01d biped knee rigs (gait 'biped': HL = left leg, HR = right leg). Heron: ankle bends BACK ('hind', heel / foldH); goblin: forward knee ('fore', foldF).
// Goblin configs are `only` (body + legs; `var` = the generated array the model file composes with its hand-keyed arms / chest / javelin).
const HERON_LEGS = { HL: { ...K('legL', 'legL2', 'hind'), k: 0.1 }, HR: { ...K('legR', 'legR2', 'hind'), k: 0.1 } };   // k 0.1: the toes stay almost flat (ankle flexes)
const GOB_LEGS = { HL: { ...K('legL', 'legL2', 'fore'), k: 0.35 }, HR: { ...K('legR', 'legR2', 'fore'), k: 0.35 } };   // k 0.2: flat feet
CONFIGS.push(
  { id: 'heron.stalk', mark: 'heron.stalk', model: 'heron', file: 'voxel_heron.js', clip: 'stalk', body: 'body', head: 'head', neck: 'neck', legs: HERON_LEGS,
    gait: 'biped', keys: 10, G: { T: 2000, v: 0.1, beta: 0.7, bobM: 0.002, liftM: 0.1, pitch: 1, nod: 3, roll: 1, yaw: 0.5, heel: 0, foldH: 20 } },
  { id: 'goblin.walk', mark: 'goblin.walk', model: 'goblin', file: 'voxel_goblin.js', clip: 'walk', var: 'GOB_WALK', only: ['body', 'legL', 'legL2', 'legR', 'legR2'], body: 'body', head: 'head', legs: GOB_LEGS,
    gait: 'biped', keys: 6, G: { T: 500, v: 1.6, beta: 0.5, bobM: 0.006, liftM: 0.05, pitch: 0, nod: 0, roll: 2, yaw: 0, foldF: 35 } },
  { id: 'goblin.run', mark: 'goblin.run', model: 'goblin', file: 'voxel_goblin.js', clip: 'run', var: 'GOB_RUN', only: ['body', 'legL', 'legL2', 'legR', 'legR2'], body: 'body', head: 'head', legs: GOB_LEGS,
    gait: 'biped', keys: 6, G: { T: 360, v: 2.6, beta: 0.5, bobM: 0.02, liftM: 0.06, pitch: 0, nod: 0, roll: 2, yaw: 0, foldF: 25 } });
// ANIM-B-01 follow-up: bear + black bear (was a bespoke ASSETS.bearGait copy). Hind fold sign +: G.hindSign 1 (the hock flexes the foot BACK), heelF = 0.4 heel.
const BEAR_LEGS = { FL: { ...K('armL', 'armL2', 'fore'), k: 0.5 }, FR: { ...K('armR', 'armR2', 'fore'), k: 0.5 }, HL: { ...K('legL', 'legL2', 'hind'), k: 0.35 }, HR: { ...K('legR', 'legR2', 'hind'), k: 0.35 } };
CONFIGS.push(
  { id: 'bear.walk', mark: 'bear.walk', model: 'bear', file: 'voxel_bear.js', clip: 'walk', body: 'body', head: 'head', ears: 'ears', legs: BEAR_LEGS,
    gait: 'amble', keys: 16, G: { T: 800, v: 1.0, beta: 0.65, bobM: 0.025, liftM: 0.07, pitch: 1.5, nod: 1.5, ears: 3, roll: 5, yaw: 4, heel: 28, heelF: 11.2, foldF: 32, foldH: 12, hindSign: 1 } },
  { id: 'bear.charge', mark: 'bear.charge', model: 'bearBlack', file: 'voxel_bear.js', clip: 'charge', var: 'BEAR_CHARGE', body: 'body', head: 'head', ears: 'ears', legs: BEAR_LEGS,
    gait: 'gallop', keys: 10, G: { T: 500, v: 3.0, beta: 0.45, bobM: 0.075, liftM: 0.15, pitch: 4, nod: 3, ears: 0, roll: 2, yaw: 2, heel: 20, heelF: 8, foldF: 40, foldH: 20, hindSign: 1 } });
