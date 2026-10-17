// QUEST-WALK-OWNER chapter 2: runs the full walk (opening chain + Burl side quests) and then the Outwall / Hesk / Dorrin / warden quests (tools/quest-walk-next.mjs).
// Run: node tools/verify-quest-walk2.mjs <port 9500-9999>  (CDP = port+1). Exit code = the walk's.
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['tools/verify-quest-walk.mjs', process.argv[2] || '9600', '--next'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
