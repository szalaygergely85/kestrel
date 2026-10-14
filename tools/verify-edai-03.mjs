// ED-AI-03 verify: node tools/verify-edai-03.mjs <port 9500-9574>. Node only (no browser): syntax-checks the editor modules
// and runs the unit suite. The port is accepted for the lane convention and unused.
import { spawnSync } from 'node:child_process';
const port = Number(process.argv[2] || 9500);
if (!(port >= 9500 && port <= 9574)) { console.error('port must be 9500-9574'); process.exit(2); }
const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit' }).status;
let bad = 0;
for (const f of ['tools/editor/aiPanel.js', 'tools/editor/ai/form.js', 'tools/editor/ai/patchBridge.js', 'tools/editor/main.js']) bad += run(['--experimental-default-type=module', '--check', f]) ? 1 : 0;
bad += run(['tools/editor/ai/form.test.mjs']) ? 1 : 0;
console.log(bad ? 'verify-edai-03 FAIL' : 'verify-edai-03 OK');
process.exit(bad ? 1 : 0);
