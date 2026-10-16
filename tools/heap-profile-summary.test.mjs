// PERF-08: summariseHeap / summariseCpu on tiny synthetic CDP profiles.
import assert from 'node:assert/strict';
import { summariseHeap, summariseCpu, renderMd } from './heap-profile-summary.mjs';

const cf = (functionName, url = '', lineNumber = -1) => ({ functionName, url, lineNumber, columnNumber: 0 });
const MB = 1048576;
const heap = { head: { callFrame: cf('(root)'), selfSize: 0, children: [
  { callFrame: cf('streamBand', 'http://127.0.0.1:9500/engine/world/band.js', 9), selfSize: MB, children: [
    { callFrame: cf('heightAt', 'http://127.0.0.1:9500/design/levels/g.js?v=1', 99), selfSize: 3 * MB, children: [] }] },
  { callFrame: cf('tick', 'http://127.0.0.1:9500/game/js/main.js', 4), selfSize: 0, children: [
    { callFrame: cf('heightAt', 'http://127.0.0.1:9500/design/levels/g.js?v=1', 99), selfSize: MB, children: [] }] }] } };
const h = summariseHeap(heap, 5);
assert.equal(h.totalMb, 5);
assert.equal(h.rows[0].site, 'heightAt design/levels/g.js:100');
assert.equal(h.rows[0].mb, 4);
assert.equal(h.rows[0].caller, 'streamBand engine/world/band.js:10 < (root) (native):-');
assert.equal(h.rows[1].site, 'streamBand engine/world/band.js:10');

const cpu = { nodes: [{ id: 1, callFrame: cf('(root)') }, { id: 2, callFrame: cf('f', 'http://x/a.js', 0) }], samples: [2, 2, 1], timeDeltas: [1000, 3000, 500] };
const c = summariseCpu(cpu, 5);
assert.equal(c.rows[0].site, 'f a.js:1');
assert.equal(c.rows[0].ms, 4);
assert.ok(renderMd({ title: 't', heap: h, cpu: c }).includes('| 1 | 4.0 | 80.0 | heightAt design/levels/g.js:100 |'));
console.log('heap-profile-summary: ok');
