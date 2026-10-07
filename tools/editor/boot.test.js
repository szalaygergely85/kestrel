// EDITOR-LOAD-01: execute the actual classic bootstrap with a minimal DOM and deterministic clock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./boot.js', import.meta.url), 'utf8');
function fixture() {
  const elements = Object.fromEntries(['status', 'outliner', 'gate-message'].map((id) => [id, { textContent: '', style: {} }]));
  const logs = [], errors = [], timers = new Map();
  let now = 0, nextId = 0, importCalls = 0;
  const context = {
    document: { getElementById(id) { return elements[id]; } }, performance: { now() { return now; } },
    console: { log(...args) { logs.push(args); }, error(...args) { errors.push(args); } },
    setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, context, { filename: 'boot.js' });
  return {
    boot: context.__editorBoot, elements, logs, errors, timers,
    tick(ms) {
      now += ms;
      for (const [id, t] of timers) if (t.at <= now) { timers.delete(id); t.fn(); }
    },
    importer(promise) { return () => { importCalls++; return promise; }; },
    calls() { return importCalls; },
  };
}
{
  // Stage/time logs begin even before dynamic import or design scripts complete.
  const f = fixture();
  assert.equal(f.boot.state.stage, 'design assets'); assert.equal(f.logs.length, 1);
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const first = f.boot.start(f.importer(delayed));
  assert.equal(f.boot.start(() => { throw new Error('must not retry'); }), first);
  await Promise.resolve(); assert.equal(f.calls(), 1);
  // renderOutliner can finish before the final asset-folder await. Pending must not replace its DOM.
  let outlinerWrites = 0;
  const treeText = 'World\nTerrain\nProps';
  Object.defineProperty(f.elements.outliner, 'textContent', {
    get() { return treeText; }, set() { outlinerWrites++; },
  });
  f.boot.stage('content load', 'Loading content');
  f.tick(9999); assert.equal(f.elements['gate-message'].style.display, undefined);
  f.tick(1);
  assert.equal(f.boot.state.phase, 'loading'); assert.equal(f.boot.state.slow, true);
  assert.match(f.elements.status.textContent, /Still loading: Loading content/);
  assert.equal(f.elements.outliner.textContent, treeText); assert.equal(outlinerWrites, 0);
  assert.equal(f.elements['gate-message'].style.display, 'flex'); assert.equal(f.errors.length, 0);
  f.boot.stage('renderer init', 'Starting renderer');
  assert.match(f.elements['gate-message'].textContent, /Starting renderer/);
  release(); await first;
  assert.equal(f.boot.state.phase, 'ready'); assert.equal(f.elements['gate-message'].style.display, 'none');
  assert.equal(f.timers.size, 0); assert.equal(f.calls(), 1);
  assert.equal(f.elements.outliner.textContent, treeText); assert.equal(outlinerWrites, 0);
  const text = f.elements.status.textContent; f.tick(30000); assert.equal(f.elements.status.textContent, text);
  assert.equal(f.boot.state.history.at(-1).stage, 'ready');
}
{
  // Successful initialization clears the timer while preserving main.js's existing backend gate.
  const f = fixture();
  const start = f.boot.start(f.importer(Promise.resolve()));
  f.elements['gate-message'].textContent = 'editor needs WebGL2'; f.elements['gate-message'].style.display = 'flex';
  await start;
  assert.equal(f.boot.state.phase, 'ready'); assert.equal(f.timers.size, 0);
  assert.equal(f.elements['gate-message'].textContent, 'editor needs WebGL2');
  assert.equal(f.elements['gate-message'].style.display, 'flex');
}
{
  // A dependency import rejection is visible before main.js can execute a single stage call.
  const f = fixture();
  await f.boot.start(f.importer(Promise.reject(new Error('module fetch failed'))));
  assert.equal(f.boot.state.phase, 'failed'); assert.equal(f.boot.state.stage, 'module import');
  assert.equal(f.boot.phase, 'failed'); assert.equal(f.boot.error, 'module fetch failed');
  for (const id of ['status', 'outliner', 'gate-message']) assert.match(f.elements[id].textContent, /module fetch failed/);
  assert.equal(f.elements['gate-message'].style.display, 'flex'); assert.equal(f.errors.length, 1);
  assert.equal(f.timers.size, 0); assert.equal(f.calls(), 1);
  await f.boot.start(() => { throw new Error('must not re-import'); }); assert.equal(f.calls(), 1);
}
{
  // Top-level await/world initialization rejection reports the last stage, including after a slow notification.
  const f = fixture(); let reject;
  const pending = new Promise((resolve, no) => { reject = no; });
  const start = f.boot.start(f.importer(pending));
  await Promise.resolve(); f.boot.stage('asset/world init', 'Preparing assets and world'); f.tick(10000);
  reject(new Error('unknown world missing-editor-world')); await start;
  assert.equal(f.boot.state.phase, 'failed'); assert.equal(f.boot.state.stage, 'asset/world init');
  assert.match(f.elements.outliner.textContent, /Preparing assets and world/i);
  assert.match(f.elements.status.textContent, /unknown world missing-editor-world/);
  const failed = f.elements['gate-message'].textContent;
  f.boot.stage('ready', 'Editor ready'); f.tick(10000);
  assert.equal(f.elements['gate-message'].textContent, failed); assert.equal(f.errors.length, 1);
}
{
  const f = fixture();
  await f.boot.start(() => { throw new Error('sync import failure'); });
  assert.equal(f.boot.state.phase, 'failed'); assert.match(f.elements.status.textContent, /sync import failure/);
}
console.log('editor boot: single import, early/async errors, stages, pending notice, success cancellation and gate preservation PASS');
