// game/js/dev/webgpuProbe.js - WG-1a/WG-1b2. Runs the engine's probeWebGpu() and (WG-1b2) createGpuDevice +
// selfTestDevice; publishes window.__webgpuProbe (the probe JSON plus `.selfTest`), window.__webgpuSelfTest
// (read by tools/capture-browser.mjs).
import { probeWebGpu, createGpuDevice, selfTestDevice } from '../../../engine/index.js';

const out = document.getElementById('out');
try {
  const result = await probeWebGpu();
  let st = { ok: false, error: 'skipped: probe not requiredOk' };
  if (result.requiredOk) {
    try {
      const device = await createGpuDevice({ backend: 'webgpu', canvas: null, selfTest: false, fallback: false });
      st = await selfTestDevice(device);
      device.dispose();
    } catch (e) { st = { ok: false, error: String(e && e.message || e) }; }
  }
  window.__webgpuSelfTest = st;
  result.selfTest = st;
  window.__webgpuProbe = result; // set last: the capture tool polls this global
  out.textContent = JSON.stringify(result, null, 2);
  out.className = result.requiredOk && st.ok ? 'ok' : 'error';
} catch (e) {
  window.__webgpuProbe = { available: false, requiredOk: false, missing: ['probe threw'], error: String(e && e.message || e) };
  window.__webgpuSelfTest = { ok: false, error: String(e && e.message || e) };
  out.textContent = String(e && e.stack || e);
  out.className = 'error';
}
