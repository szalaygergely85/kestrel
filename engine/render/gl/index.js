// engine/render/gl/index.js - WG-5a-4: the ONE barrel for every WebGL2-only export.
// Only the WebGL2 fallback path (RenderTarget.js gl2 branch, createGpuDevice gl2 branch) and the
// `// WG-5: remove` re-exports in engine/index.js import this file. WG-5 deletes this folder + those lines.
export { GpuCellPipeline, PASS_NAMES } from '../gpu/GpuCellPipeline.js';
export { isSoftwareRenderer } from '../gpu/glUtil.js';
export { GpuOverlayPass } from '../gpu/overlayPass.js';
export { GpuSpritePass } from '../gpu/spritesPass.js';
export { RenderTargetGL, FRAGMENT_SRC } from '../RenderTargetGL.js';
export { GpuDeviceGL2 } from '../gpu/device/GpuDeviceGL2.js';
