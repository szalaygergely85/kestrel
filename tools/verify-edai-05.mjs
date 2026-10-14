// ED-AI-05 + ED-AI-06 (editor part) verify: node tools/verify-edai-05.mjs <port 9500-9999>. Node only (no browser, no puppeteer):
// syntax-checks every touched module and runs the unit suites. The port is accepted for the lane convention and unused.
import { spawnSync } from 'node:child_process';
const port = Number(process.argv[2] || 9500);
if (!(port >= 9000 && port <= 9999)) { console.error('port must be 9000-9999'); process.exit(2); }
const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit' }).status;
let bad = 0;
for (const f of ['tools/editor/aiPanel.js', 'tools/editor/aiAreaTool.js', 'tools/editor/aiAreaOverlay.js', 'tools/editor/main.js',
  'game/js/main.js', 'game/js/quest/aiPatchRecv.js', 'game/js/quest/sim/aiReserve.js', 'game/js/dev/aiLabels.js']) bad += run(['--check', f]) ? 1 : 0;
for (const t of ['tools/editor/aiAreaTool.test.mjs', 'game/js/quest/aiPatchRecv.test.js', 'game/js/dev/aiLabels.test.js']) bad += run([t]) ? 1 : 0;
console.log(bad ? 'verify-edai-05 FAIL' : 'verify-edai-05 OK');
process.exit(bad ? 1 : 0);
