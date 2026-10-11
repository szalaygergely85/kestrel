// FIX-PASS: a GPU pass left open by a swallowed error must never crash the next present() ("beginPass: previous pass not ended").
// Runs RenderTargetWebGPU.present and WgCellPipeline._runGlow / _abortOpenPass against a tiny mock device with the real guard semantics.
import { RenderTargetWebGPU } from './RenderTargetWebGPU.js';
import { WgCellPipeline } from './gpu/wg/WgCellPipeline.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function mockDevice() {
  const d = {
    _pass: null, aborted: 0, timerOpen: false, submits: 0,
    timer: { begin() { if (d.timerOpen) throw new Error('span already open'); d.timerOpen = true; }, end() { d.timerOpen = false; } },
    writeTexture() {},
    beginPass(t) { if (d._pass) throw new Error('GpuDeviceWebGPU.beginPass: previous pass not ended'); d._pass = { t }; },
    endPass() { if (!d._pass) throw new Error('no open pass'); d._pass = null; },
    abortPass() { if (!d._pass) return null; d._pass = null; d.aborted++; return 'target mock'; },
    bind(p) { if (p && p.gpu === null) throw new Error('pipeline still compiling'); },
    resetFrame() { d._pass = null; d.resets = (d.resets || 0) + 1; },
    draw() {}, submit() { if (d._pass) throw new Error('submit: a pass is still open'); d.submits++; },
  };
  return d;
}
const quiet = (fn) => { const e = console.error, w = console.warn; const log = []; console.error = (...a) => log.push(a.join(' ')); console.warn = (...a) => log.push(a.join(' ')); try { fn(); } finally { console.error = e; console.warn = w; } return log; };

// --- present(): stale pass from earlier code, and a hook that leaves its pass open ---
{
  const d = mockDevice();
  const rt = Object.create(RenderTargetWebGPU.prototype);
  Object.assign(rt, { ready: true, device: d, cells: { fg: null, bg: null }, fgTex: {}, bgTex: {}, atlasTex: {}, _target: {}, _clearOpts: null, cols: 2, rows: 2, stats: {}, _uiLayer: null, _draw() {} });
  d.beginPass({}); // a pass some earlier frame left open
  let log = quiet(() => rt.present());
  ok('present recovers from a stale pass (aborted, frame submitted)', d.aborted === 1 && d.submits === 1 && !d._pass);
  ok('present names the stale pass owner via console.error', log.some((l) => /stale GPU pass .*target mock/.test(l)), log.join('|'));
  rt._cellPass = () => { d.beginPass({}); /* catch swallowed the error, pass left open */ };
  log = quiet(() => rt.present());
  ok('present aborts a pass the cell hook left open', d.aborted === 2 && d.submits === 2 && !d._pass, log.join('|'));
  rt._cellPass = null; rt._draw = () => { throw new Error('bind failed inside the present pass'); };
  let threw = false; try { quiet(() => rt.present()); } catch (_) { threw = true; }
  ok('a throw inside the present pass drops the frame: no rethrow, pass + timer span ended, frame submitted (ring reset)', !threw && !d._pass && !d.timerOpen && d.submits === 3 && rt.failedFrames === 1 && rt.stats.droppedFrames === 1);
  rt._draw = () => {};
  quiet(() => rt.present());
  ok('the next present runs normally', d.submits === 4);
}

// --- WgCellPipeline: glow failure aborts its pass and keeps glow ON ---
{
  const d = mockDevice();
  const p = Object.create(WgCellPipeline.prototype);
  const gp = { enabled: true, pipe: { gpu: {} }, target: {}, configure(P) { this.enabled = !!P; }, run() { d.beginPass({}); d.bind({ gpu: null }); d.endPass(); return true; }, resize() {} };
  Object.assign(p, { device: d, _glowPass: gp, _cellsShaded: true, debugMode: -1, _stableRan: false, _cellPass: null, cols: 2, rows: 2 });
  const t = { texFinalFg: {}, texFinalBg: {} };
  quiet(() => p._runGlow(t));
  ok('glow throw inside its pass: pass aborted', !d._pass && d.aborted === 1);
  ok('glow stays enabled after a failed frame (owner: fix, not disable)', gp.enabled === true && p._glowRan === false);
  gp.pipe.gpu = null; let ran = false; gp.run = () => { ran = true; return true; };
  p._runGlow(t);
  ok('glow pipeline still compiling: skipped, no pass opened', !ran && !d._pass);
  gp.pipe.gpu = {}; p._runGlow(t);
  ok('glow runs again once compiled', ran && p._glowRan === true);
  d.beginPass({}); p._abortOpenPass('test');
  ok('_abortOpenPass ends any open pass', !d._pass);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
