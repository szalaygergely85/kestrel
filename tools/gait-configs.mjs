// tools/gait-configs.mjs - ANIM-A-01: which clip of which model gets the option A gait, and its tuning (shared by gen-gait + the test).
// G: T = loop ms, v = m/s the clip is tuned for (= the model's `speeds`), beta = duty (stance share), bobM / liftM metres, pitch / nod / roll / yaw degrees.
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_bear.js';
import '../design/models/voxel_otter.js';
import '../design/models/voxel_tortoise.js';
import '../design/models/voxel_bear_cub.js';
import '../design/models/voxel_beast.js';
import '../design/models/voxel_wildlife.js';

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
export function defOf(cfg) { return M()[cfg.model].voxel; }
