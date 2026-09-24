// US-045 (D-017 item 2): the "WebGL2 required" gate + the software-renderer
// warning. Game-only DOM UI - no engine changes (`isSoftwareRenderer` was
// already a public `engine/index.js` export, US-029 tech notes item 9).
//
// Two independent checks, both from a THROWAWAY canvas (never the real
// `#screen` canvas - see RenderTarget.js's own comment on why: committing
// the real canvas to a context type is irreversible):
//   1. No WebGL2 context at all -> block. Caller must not create the engine
//      or start the game loop (AC "no game loop running underneath").
//   2. WebGL2 context, but UNMASKED_RENDERER_WEBGL looks like a software
//      renderer -> not blocked, just a dismissible warning; caller proceeds
//      exactly as before (real RenderTarget() still runs its own probe and
//      picks the gl2 back-end normally, D-017 item 2 "the game still starts
//      on the GPU path").
//
// `probeGpuSupport` never touches the DOM beyond a detached <canvas>, so it
// is safe to call before any other bootstrap work.

export function probeGpuSupport(isSoftwareRenderer) {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return { supported: false, isSoftware: false, renderer: '' };
  const { isSoftware, renderer } = isSoftwareRenderer(probe);
  return { supported: true, isSoftware, renderer };
}

// AC 1: full-screen message replaces the game canvas; no crash, no console
// error. Styled from the designer's palette (uiStyle text colors are a
// scene-space text-layer spec, US-005/015 - this is a plain DOM screen, so
// it borrows the same semantic hex values via `assets.palette`, not the
// uiStyle layout rules meant for the canvas UI layer).
export function showWebgl2RequiredScreen(canvas, assets) {
  canvas.style.display = 'none';
  const P = assets.palette;
  const div = document.createElement('div');
  div.id = 'webgl2-required';
  Object.assign(div.style, {
    position: 'fixed', inset: '0', zIndex: '3000',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    textAlign: 'center', padding: '2em', background: P.colors.black,
    color: P.colors[P.ui.text], font: '16px "Courier New", monospace', lineHeight: '1.6',
  });
  div.innerHTML =
    `<div style="font-size:1.4em;color:${P.colors.gold};margin-bottom:0.6em;">WebGL2 required to play</div>` +
    `<div style="color:${P.colors[P.ui.hint]};max-width:32em;">` +
    `Update your browser, or enable hardware acceleration in your browser's settings, then reload this page.</div>`;
  document.body.appendChild(div);
}

// AC 2: one-line dismissible warning, top-center (F3 overlay is top-left,
// the pause menu is canvas-centered - no overlap at any grid). Auto-hides
// after `timeoutMs`; click also dismisses. Logged once via console.warn
// (not .error - AC 1's "no console error" is about the blocked case only).
export function showSoftwareRendererWarning(assets, renderer, timeoutMs = 6000) {
  console.warn(`[webgl2Gate] software renderer detected (${renderer}) - performance may be poor`);
  const P = assets.palette;
  const div = document.createElement('div');
  div.id = 'gpu-software-warning';
  Object.assign(div.style, {
    position: 'fixed', top: '4px', left: '50%', transform: 'translateX(-50%)', zIndex: '2500',
    background: 'rgba(0,0,0,0.75)', color: P.colors[P.ui.hint],
    border: `1px solid ${P.colors.gold}`, borderRadius: '3px',
    padding: '0.3em 0.8em', font: '13px "Courier New", monospace', cursor: 'pointer',
    userSelect: 'none',
  });
  div.textContent = 'Performance may be poor on this device';
  div.title = 'Click to dismiss';
  const remove = () => div.remove();
  div.addEventListener('click', remove);
  document.body.appendChild(div);
  setTimeout(remove, timeoutMs);
}
