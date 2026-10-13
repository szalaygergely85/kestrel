// WM-12 boot helper: spawn the regional herds once on the default grid world (not ?grid=0 legacy, not capture/bench pages).
import { spawnRegionalBeasts } from './regionalBeasts.js';
import { gridEnabled } from '../bandPose.js';

export function bootRegionalBeasts(world, geo, params, isCaptureOrBench, spawn = spawnRegionalBeasts) {
  if (!world || !world.terrainGrid || !gridEnabled(params) || isCaptureOrBench || !geo) return false;
  spawn(world, geo, 12);
  return true;
}
