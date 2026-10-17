// VISQA-12/28/08: owner-look stills of the bear den, the sea cave and the SE ford slope (farm gate leaf).
// Thin wrapper over tools/visqa-sweep.mjs (same CDP helpers): node tools/verify-visqa12-28-08.mjs <port> [backend]
// Stills land in docs/test-reports/visqa/ (s2-bear-den*, s2-sea-cave*, ford-*). PC-B ports 9650-9724 for kestrel-3.
import { spawnSync } from 'node:child_process';
import { ROOT, validatePort } from './capture-browser.mjs';
const port = Number(process.argv[2] || 9650); validatePort(port);
const backend = process.argv[3]; // optional, passed through as an env hint to the sweep
const env = { ...process.env, HOURS: '9,13', ...(backend ? { BACKEND: backend } : {}) };
const run = (args, extra) => spawnSync(process.execPath, ['tools/visqa-sweep.mjs', String(port), ...args], { cwd: ROOT, stdio: 'inherit', env: { ...env, ...extra } }).status;
const a = run(['--set', '2'], { ONLY: 'bear-den,sea-cave' });
const b = run([], { ONLY: 'ford' });
process.exit(a || b ? 1 : 0);
