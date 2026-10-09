// ME-16e (lane B1): `?pointshadows=0|N` -> WgCellPipeline options. Default OFF; only an explicit URL value turns it on
// (gpucompare / capture / bench modes included). `1` or `on` = quality level's default; N>=2 = N lights.
export function parsePointShadows(params, levelName) {
  const v = params.get('pointshadows');
  const out = { pointShadows: false, pointShadowLevel: levelName || undefined };
  if (v === null || v === '' || v === '0' || v === 'off') return out;
  const n = parseInt(v, 10);
  out.pointShadows = (v === '1' || v === 'on' || v === 'true' || !(n >= 1)) ? true : { n };
  return out;
}
