// EDITOR-LOAD-01: classic script, available before module dependencies or content can fail.
// One import promise; a slow boot reports its current stage without retrying or declaring failure.
(function (root) {
  'use strict';
  var doc = root.document, startMs = root.performance.now();
  var state = { phase: 'loading', stage: 'design assets', label: 'Loading editor assets', slow: false, error: null, history: [] };
  var importPromise = null, ownedGateText = null;
  var timer = root.setTimeout(function () {
    if (state.phase !== 'loading') return;
    state.slow = true;
    showPending();
  }, 10000);

  function text(id, value) {
    var el = doc.getElementById(id);
    if (el) el.textContent = value;
  }

  function gate(value) {
    var el = doc.getElementById('gate-message');
    if (el) { el.textContent = value; el.style.display = 'flex'; }
    ownedGateText = value;
  }

  function showPending() {
    var message = 'Still loading: ' + state.label + '. Please wait.';
    // The tree may already be interactive while asset-folder loading is pending.
    text('status', message); gate(message);
  }

  function stage(name, label) {
    if (state.phase !== 'loading') return;
    state.stage = name; state.label = label;
    var elapsed = Math.round(root.performance.now() - startMs);
    state.history.push({ stage: name, elapsedMs: elapsed });
    root.console.log('[editor boot] ' + name + ' (' + elapsed + ' ms)');
    text('status', label + '...');
    if (state.slow) showPending();
  }

  function ready() {
    if (state.phase !== 'loading') return;
    root.clearTimeout(timer);
    state.phase = 'ready'; state.stage = 'ready'; state.label = 'Editor ready';
    var elapsed = Math.round(root.performance.now() - startMs);
    state.history.push({ stage: 'ready', elapsedMs: elapsed });
    root.console.log('[editor boot] ready (' + elapsed + ' ms)');
    // main.js may have replaced the pending text with its existing WebGL2 gate.
    var el = doc.getElementById('gate-message');
    if (el && ownedGateText !== null && el.textContent === ownedGateText) {
      el.textContent = ''; el.style.display = 'none';
    }
    text('status', state.label);
  }

  function failed(error) {
    if (state.phase !== 'loading') return;
    root.clearTimeout(timer);
    state.phase = 'failed'; state.error = String(error && error.message || error);
    var message = 'Editor could not start while ' + state.label.toLowerCase() + '.\n' + state.error;
    text('outliner', message); text('status', message); gate(message);
    root.console.error('[editor boot] failed at ' + state.stage, error);
  }

  function start(importMain) {
    if (importPromise) return importPromise;
    stage('module import', 'Loading editor');
    importPromise = Promise.resolve().then(importMain).then(ready, failed);
    return importPromise;
  }

  root.__editorBoot = {
    state: state, stage: stage, start: start,
    get phase() { return state.phase; },
    get error() { return state.error; }
  };
  stage('design assets', 'Loading editor assets');
})(globalThis);
