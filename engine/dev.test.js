// ENG-API-01d: every engine internal the 5 formerly allowlisted tools use is reachable through engine/dev.js.
import * as devMod from './dev.js';
import * as idx from './index.js';

const NAMES = [ // dev.js-owned:
  'createSunShadowMatrix', 'shadowSunMatrix', 'sunShadowCentre', 'shadowInputHash', 'SUN_SHADOW_DEFAULTS',
  'createShadowList', 'buildShadowList', 'shadowWorldZ', 'LevelMeshCache', 'DrawList', 'addStructures',
  'VoxelMeshCache', 'addVoxelInstances', 'InstanceGroups', 'writeUnitInstance', 'compactGroup',
  'frustumPlanes', 'classifyAABB', 'CULL_OUT', 'frameMatrix', 'packVoxelModel', 'quadruped12', 'quadruped16',
  'WgShadowPass', 'WgPointShadowPass', 'WgRasterPass', 'GBuffer', 'bindShading', 'bindLevel',
  'computeDerivatives', 'shadeSurfaces', 'edgePass', 'ambientL', 'loadLevel', 'meshFromBin', 'makeMockGpuDevice',
];
let fail = 0;
for (const n of NAMES) if ((n in idx ? idx : devMod)[n] === undefined) { console.error('FAIL dev.js does not export ' + n); fail++; }
console.log(`dev.test: ${NAMES.length - fail}/${NAMES.length} names defined`);
if (fail) process.exit(1);
