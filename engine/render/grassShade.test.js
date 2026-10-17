// OB-217: shaded grass keeps a value range (lift + spread by ramp position); sunlit and night unchanged; ?grassshade=0 = old look. Node only.
import { shadeGrass, grassTableFor, setGrassShade, grassShadeS } from './terrainShade.js';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const cfg = { seed: 3, radiusM: 8, classJitterM: 0.3, variants: [{ name: 'meadow', ground: ['grass'], density: 0.9, heightM: [0.15, 0.25], ramp: [[10, 40, 10], [60, 160, 40], [180, 230, 90]] }] };
const tab = grassTableFor(cfg);
const sctx = { shading: { fgMin: 0.2, fgGamma: 1, fgMaxGain: 1.5, floorLum: 0, wetness: 0 }, fog: { start: 50, full: 1500, curve: 1, nearRGB: [0, 0, 0], farRGB: [90, 90, 90] } };
const out = { glyph: 0, level: 255, fg: new Uint8Array(3), bg: new Uint8Array(3) };
const lum = () => out.fg[0] * 0.3 + out.fg[1] * 0.59 + out.fg[2] * 0.11;
// patch = 11 ramp positions (h01 0..1) at the given lit term b and sunI; returns { lums, spread, mean, max }
function patch(b, sunI) {
  const lums = [], levels = new Set(), glyphs = new Set();
  for (let h = 0; h <= 1.0001; h += 0.1) { shadeGrass(5, 1, h, 0, 0, b, tab, sctx, out, 0, sunI); lums.push(lum()); levels.add(out.level); glyphs.add(out.glyph); }
  const mx = Math.max(...lums), mn = Math.min(...lums);
  return { lums, max: mx, min: mn, spread: mx - mn, mean: lums.reduce((a, c) => a + c, 0) / lums.length, levels: levels.size, glyphs: glyphs.size };
}
const SHADE_B = 0.3, SUN = 1.0;
setGrassShade(0); const offShade = patch(SHADE_B, SUN), offSun = patch(1.2, SUN), offNight = patch(0.15, 0);
setGrassShade(1); const onShade = patch(SHADE_B, SUN), onSun = patch(1.2, SUN), onNight = patch(0.15, 0);
check(onShade.spread >= offShade.spread * 1.25 && onShade.spread > 8, `shade spread ${offShade.spread.toFixed(1)} -> ${onShade.spread.toFixed(1)} (>= x1.25)`);
check(onShade.glyphs >= 3 && onShade.levels >= 8, `shade patch keeps ${onShade.glyphs} glyphs / ${onShade.levels} levels`);
check(onShade.mean > offShade.mean && onShade.max < offSun.max, `shade lifted (mean ${offShade.mean.toFixed(1)} -> ${onShade.mean.toFixed(1)}) but below sunlit max ${offSun.max.toFixed(1)}`);
check(JSON.stringify(onSun.lums) === JSON.stringify(offSun.lums), 'sunlit patch unchanged');
check(JSON.stringify(onNight.lums) === JSON.stringify(offNight.lums) && onNight.max <= offNight.max, `night patch unchanged (max ${onNight.max.toFixed(1)})`);
check(grassShadeS(0.3, 1, 0) === 0 && grassShadeS(1.2, 1, 1) === 0 && grassShadeS(0.3, 0, 1) === 0 && grassShadeS(0.3, 1, 1) > 0.9, 'grassShadeS gates (off / lit / night / shade)');
console.log(fails ? fails + ' FAILED' : 'grassShade: all ok');
process.exit(fails ? 1 : 0);
