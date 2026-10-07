// game/js/dev/webgpuProbe.js - WG-1a. Runs the engine's probeWebGpu() and
// publishes the result as window.__webgpuProbe (read by tools/capture-browser.mjs).
import { probeWebGpu } from '../../../engine/index.js';

const out = document.getElementById('out');
try {
  const result = await probeWebGpu();
  window.__webgpuProbe = result;
  out.textContent = JSON.stringify(result, null, 2);
  out.className = result.requiredOk ? 'ok' : 'error';
} catch (e) {
  window.__webgpuProbe = { available: false, requiredOk: false, missing: ['probe threw'], error: String(e && e.message || e) };
  out.textContent = String(e && e.stack || e);
  out.className = 'error';
}
