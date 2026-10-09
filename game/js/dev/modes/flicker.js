// US-048: `?flicker=1` dev mode. WG-5c: the GPU row used the removed WebGL2 pipeline (`readback()` of fg + geometry);
// the JS-vs-GPU changed-glyph measurement needs a WgCellPipeline port (follow-up). Until then the mode only says so.
// The CPU flicker metric stays available via `node tools/bench-cast.mjs` (engine/render/gpu/flicker.js `flickerStep`).
export const name = 'flicker';

export function run(ctx) {
  const { rt, overlay } = ctx;
  const msg = '[flicker] the GPU flicker row needs a WebGPU readback port (WebGL2 pipeline removed in WG-5b) - use tools/bench-cast.mjs for the CPU metric.';
  console.error(msg + ' (backend=' + rt.backend + ')');
  overlay.visible = true; overlay.el.style.display = 'block';
  overlay.el.textContent = msg;
}
