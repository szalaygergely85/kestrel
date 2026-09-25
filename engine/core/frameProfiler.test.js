// US-018 spike hunt: FrameProfiler worst-frame snapshot. node engine/core/frameProfiler.test.js
import { FrameProfiler } from './FrameProfiler.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }

const p = new FrameProfiler(['a', 'b']);
ok('no frame yet', p.format() === 'worst frame: none');
p.beginFrame(); p.add(0, 1); p.add(0, 0.5); p.endFrame(1.5, 0.5, 1);
p.beginFrame(); p.add(1, 9); p.endFrame(0.2, 10, 2);
p.beginFrame(); p.add(0, 3); p.endFrame(3, 0, 1);
ok('worst is frame 1', p.worstFrame === 1);
ok('worst js', Math.abs(p.worstJsMs - 10.2) < 1e-9);
ok('worst sections', p.worst[0] === 0 && p.worst[1] === 9);
ok('worst steps', p.worstSteps === 2);
ok('format names section + unattributed', /b 9\.00/.test(p.format()) && /unattributed 1\.20/.test(p.format()));
ok('accumulates per frame', (() => { p.beginFrame(); p.add(0, 2); p.add(0, 2); return p.cur[0] === 4; })());
p.reset();
ok('reset', p.worstFrame === -1 && p.worstJsMs === 0 && p.worst[1] === 0 && p.frame === 0);

console.log(`frameProfiler.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
