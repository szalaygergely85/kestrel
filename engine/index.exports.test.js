// RE-EXP: every RTS-layer name exported from engine/index.js is defined.
// Run: node engine/index.exports.test.js
import * as E from './index.js';

const names = [
  'PROJ_PITCHED_VFOV_DEG', 'createPitchedTerms', 'pitchedTerms', 'pitchedProjection', 'screenRay',
  'unprojectPitched', 'worldToCell', 'pitchedEyeFromFocus', 'pitchedFogScale', 'frameMatrix',
  'rayTerrain', 'pickNearest', 'selectInRect',
  'createFlowField', 'FlowCache', 'createSteer', 'Visibility',
  'createMinimap', 'minimapToWorld', 'worldToMinimap', 'updateMinimap', 'bakeMinimapTerrain', 'bindMinimapFog',
  'createRtsCamera', 'updateRtsCamera', 'zoomRtsCamera',
  'PROP_SCALE_MIN', 'PROP_SCALE_MAX', 'createCommandQueue', 'createRng', 'createHasher', 'createRecorder', 'createReplayPlayer', 'SIM_STEP',
  'createParticles', 'PARTICLE_CAP', 'PARTICLE_MAX_EMITTERS', 'createEntityEmitters',
];
const missing = names.filter((n) => E[n] === undefined);
console.log(`index.exports.test.js: ${names.length - missing.length} defined, ${missing.length} missing`);
if (missing.length) { console.log('  MISSING: ' + missing.join(', ')); process.exit(1); }
