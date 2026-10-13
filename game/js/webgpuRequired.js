// WG-5: "WebGPU required" screen. Pure DOM, no deps/assets. Styled like the boot card (dark plate, cream text, gold accent).
/** @param {{gpu?: any}|null|undefined} nav navigator-like; @param {{adapter?: any, deviceFailed?: boolean}} [probe]
 *  @returns {'no-api'|'no-adapter'|'device-failed'} */
export function webGpuMissingReason(nav, probe = {}) {
  if (!nav || !nav.gpu) return 'no-api';
  if (probe.deviceFailed) return 'device-failed';
  if (probe.adapter === null) return 'no-adapter';
  return 'no-adapter';
}

export const REASON_TEXT = {
  'no-api': 'This browser has no WebGPU (the WebGPU API is missing).',
  'no-adapter': 'WebGPU is present, but no graphics adapter was found (driver blocklisted, or GPU unavailable).',
  'device-failed': 'WebGPU started, but the graphics device failed or was lost.',
};

const FIX_TEXT = 'Use a current Chrome or Edge (version 113 or newer) with hardware acceleration on. ' +
  'Firefox and Safari: WebGPU is only partly available or behind a flag; try their latest release or Chrome/Edge.';

/** Builds the screen once (idempotent: a second call returns the existing element). */
export function showWebGpuRequired(root, { reason = 'no-api', docsUrl } = {}, doc = root.ownerDocument || globalThis.document) {
  const existing = root.__webgpuRequired;
  if (existing) return existing;
  const el = doc.createElement('div');
  el.id = 'webgpu-required';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-labelledby', 'webgpu-required-h');
  el.setAttribute('aria-describedby', 'webgpu-required-d');
  el.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:100;display:flex;align-items:center;justify-content:center;' +
    'background:#0a0806;color:#e8d9a8;font:16px/1.5 Consolas,"DejaVu Sans Mono",monospace;text-align:center';
  const plate = doc.createElement('div');
  plate.style.cssText = 'max-width:560px;padding:20px 28px;background:rgba(10,8,6,.92);border:1px solid #6b5a30';
  const h = doc.createElement('h1');
  h.id = 'webgpu-required-h';
  h.textContent = 'ASCII QUEST needs WebGPU';
  h.style.cssText = 'margin:0 0 12px;font-size:22px;font-weight:normal;color:#e0b030';
  const why = doc.createElement('p');
  why.id = 'webgpu-required-d';
  why.textContent = REASON_TEXT[reason] || REASON_TEXT['no-api'];
  const fix = doc.createElement('p');
  fix.textContent = FIX_TEXT;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.textContent = '[ Try again ]';
  btn.style.cssText = 'font:inherit;color:#0a0806;background:#e0b030;border:1px solid #6b5a30;padding:6px 18px;cursor:pointer';
  btn.addEventListener('click', () => (doc.defaultView || globalThis).location.reload());
  plate.append(h, why, fix);
  if (docsUrl) {
    const a = doc.createElement('a');
    a.href = docsUrl; a.textContent = 'More about WebGPU support'; a.style.cssText = 'display:block;margin:0 0 12px;color:#e0b030';
    plate.append(a);
  }
  plate.append(btn);
  el.append(plate);
  root.appendChild(el);
  root.__webgpuRequired = el;
  if (btn.focus) btn.focus();
  return el;
}
