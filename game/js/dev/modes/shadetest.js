// US-048: `?shadetest=1` dev mode - the material/ramp reference grid
// (runShadeTest) plus the v2 detail-pass reference grid (runDetailShadeTest,
// only when the content pack actually has a detail pass bound). Moved
// verbatim out of game/js/main.js's dispatch branch.
import { runShadeTest, runDetailShadeTest } from '../../../../engine/dev.js';

export const name = 'shadetest';

export function run(ctx) {
  runShadeTest(ctx.assets.palette);
  if (ctx.assets.detailPass) runDetailShadeTest(ctx.assets.palette, ctx.assets.detailPass);
}
