// ME-16e (lane B1): `?pointshadows=0|N` -> WgCellPipeline options. Default OFF; only an explicit URL value turns it on
// (gpucompare / capture / bench modes included). `1` or `on` = quality level's default; N>=2 = N lights.
export function parsePointShadows(params, levelName, presetOn = false) {
  const v = params.get('pointshadows');
  const out = { pointShadows: !!presetOn, // AUD-44: high/ultra presets default ON; ?pointshadows=0 turns it off
    pointShadowLevel: levelName || undefined };
  if (v === null || v === '') return out;
  if (v === '0' || v === 'off') { out.pointShadows = false; return out; }
  const n = parseInt(v, 10);
  out.pointShadows = (v === '1' || v === 'on' || v === 'true' || !(n >= 1)) ? true : { n };
  return out;
}
