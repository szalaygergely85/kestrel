// OB-209 (far silhouette): unit test for the far-shape contrast measure (synthetic stills, no browser).
import assert from 'node:assert/strict';
import { measureFarBand, farGateFails } from './farSilhouette.mjs';

const W = 200, H = 140;
// letterbox rows 0..9 black, sky rows 10..69, far shape rows 50..79 in x >= 170, grass rows 80..129, letterbox 130..139
function still(shapeRGB, skyRGB = [220, 215, 190]) {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; let c = [0, 0, 0];
    if (y >= 10 && y < 80) c = skyRGB;
    if (y >= 50 && y < 80 && x >= 170 && shapeRGB) c = shapeRGB;
    if (y >= 80 && y < 130) c = [50, 70, 30];
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return px;
}
const opts = { groundY: 0.85, cols: 10, minH: 8 };

const pale = measureFarBand(still([180, 200, 160]), W, H, opts); // the owner's pale/green cut-out
assert.ok(pale.shapes >= 2, 'pale shape found');
assert.ok(pale.worst[0].h >= 28); assert.equal(pale.worst[0].top, 50);
assert.ok(pale.worstDist > 36 && farGateFails(pale), `pale cut-out fails (${pale.worstDist})`);

const navy = measureFarBand(still([20, 26, 60]), W, H, opts); // navy far blobs
assert.ok(farGateFails(navy), 'navy far blobs fail');

const melt = measureFarBand(still([214, 210, 186]), W, H, opts); // fogged to ~ the sky horizon colour
assert.ok(!farGateFails(melt), `melted far hill passes (${melt.worstDist})`);

const none = measureFarBand(still(null), W, H, opts); // no far shape at all: sky down to the ground
assert.equal(none.worstDist, 0); assert.ok(!farGateFails(none));

// night: dark grass, dark sky, a slightly lighter far hill still measured (ground step scales with the grass luma)
const night = measureFarBand((() => { const p = still([60, 70, 110], [28, 34, 56]); for (let i = 0; i < p.length; i += 4) { const y = Math.floor(i / 4 / W); if (y >= 80 && y < 130) { p[i] = 8; p[i + 1] = 10; p[i + 2] = 12; } } return p; })(), W, H, opts);
assert.ok(night.shapes >= 2 && farGateFails(night), `night pale hill fails (${night.worstDist})`);
console.log('farSilhouette.test: ok');
