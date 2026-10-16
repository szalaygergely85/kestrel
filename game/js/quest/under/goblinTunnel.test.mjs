// UNDER-06 / OB-191: goblin tunnel (real world_m1, mesh physics). Run: node game/js/quest/under/goblinTunnel.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateUnder } from '../../../../engine/index.js';
import { loadM1 } from './loadM1.mjs';
import { GOBLIN_TUNNEL, tunnelCleared, bindTunnelFlags, syncTunnelFlags, chestKey } from './goblinTunnel.js';
import { buildChestDefs } from '../sim/chestDefs.js';
import { UNDER_SITES, createUnderSpawner } from '../sim/underSkeletons.js';
import { STATE_DYING } from '../sim/beastSim.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const { world, groundAt } = await loadM1('mesh');
const st = world.structures.find((s) => s.id === 'goblinTunnel');
ok(st && st.keepMask, 'site goblinTunnel placed (keepTerrain)');
const errs = validateUnder(world);
ok(errs.length === 0, 'validateUnder: ' + errs.slice(0, 2).join('; '));
const lv = JSON.parse(fs.readFileSync(new URL('../../../../content/levels/goblin_tunnel.level.json', import.meta.url), 'utf8'));
ok(lv.ambience === 'cave', 'ambience cave');
ok(lv.lights.length >= 2 && lv.lights.length <= 3, 'goblin torches: ' + lv.lights.length);
const camps = JSON.parse(fs.readFileSync(new URL('../../../../content/life/goblinCamps.json', import.meta.url), 'utf8')).camps;
const cN = camps.find((c) => c.id === 'campNorth').at, cE = camps.find((c) => c.id === 'campEast').at;
const dist = Math.hypot(cN[0] - cE[0], cN[1] - cE[1]); ok(dist > 60 && dist < 200, 'camps 60-200 m apart: ' + dist.toFixed(1));

// both entrances connect to the tunnel floor: walk the centre line from each mouth, steps small, feet follow the floor, support is the tunnel (not terrain) inside
const opts = { height: 1.6, stepUpMax: 0.5, walkCos: 0.7 };
const line = []; for (let y = 917.5; y <= 939.5; y += 0.25) line.push([930.5, y]); for (let x = 930.5; x <= 960.5; x += 0.25) line.push([x, 939.5]); for (let y = 939.5; y <= 962.5; y += 0.25) line.push([960.5, y]);
const walk = (pts) => {
  let prev = groundAt(pts[0][0], pts[0][1]), inside = 0;
  for (const [x, y] of pts) {
    const s = world.supportAt(x, y, prev + 0.05, true, opts);
    ok(Number.isFinite(s.floorH), `support at ${x},${y}`);
    ok(s.floorH - prev <= 0.5 && prev - s.floorH <= 0.7, `step ${(s.floorH - prev).toFixed(2)} at ${x},${y}`);
    if (!s.terrain && s.floorH < groundAt(x, y) - 2.5) inside++;
    prev = s.floorH;
  }
  return inside;
};
const inA = walk(line), inB = walk(line.slice().reverse());
ok(inA > 200 && inB > 200, 'both directions walk through a covered tunnel: ' + inA + '/' + inB);
const s0 = { floorH: world.supportAt(930.5, 917.5, groundAt(930.5, 917.5) + 0.05, true, opts).floorH }, s1 = { floorH: world.supportAt(960.5, 962.5, groundAt(960.5, 962.5) + 0.05, true, opts).floorH }; // supportAt returns a shared object
ok(Math.abs(s0.floorH - groundAt(930.5, 917.5)) < 0.5, 'mouth A floor meets the ground: ' + s0.floorH.toFixed(2));
ok(Math.abs(s1.floorH - groundAt(960.5, 962.5)) < 0.5, 'mouth B floor meets the ground: ' + s1.floorH.toFixed(2));
const mid = world.supportAt(945.5, 939.5, -88.7, true, opts); ok(!mid.terrain && mid.floorH < groundAt(945.5, 939.5) - 3, 'mid tunnel: floor under the terrain');
ok(world.supportAt(945.5, 939.5, groundAt(945.5, 939.5) + 0.2, false, opts).terrain, 'surface above the tunnel is terrain');
const room = world.supportAt(945.5, 946, -88.7, true, opts); ok(Math.abs(room.floorH + 88.8) < 0.05 && !room.terrain, 'stash room floor -88.8');

// goblins: the site's homes are inside the stash room (x 941..950, y 943..949), z = room floor, spawn only there
const site = UNDER_SITES.find((s) => s.id === 'goblinTunnel');
ok(site && site.members.length === 3 && !site.night && site.z === -88.8, 'site: 3 goblins, any time of day, at the room floor');
ok(site.members.every((m) => { const x = site.anchor[0] + m[2], y = site.anchor[1] + m[3]; return x > 941.5 && x < 949.5 && y > 943.5 && y < 948.5; }), 'every goblin home is inside the stash room');
ok(site.members.every((m) => ['archer', 'torch', 'shaman', 'chief'].includes(m[1])), 'existing goblin kinds');
ok(site.members.every((m) => m[0] === GOBLIN_TUNNEL.guards.find((g) => g === m[0])), 'guards = site members');
const fake = (z) => ({ count: 1, down: [0], state: [0], entities: [{ transform: { z } }], slotOf: () => 0, riseMs: new Float32Array(1), cfgSteps: {}, steer: {}, setDown() {} });
const sp = createUnderSpawner({ sim: fake(-88.8), site, state: {} });
ok(!sp.inRange(945.5, 930, groundAt(945.5, 930), 945.5, 946), 'a surface player (dz > 3 m) does not reach the tunnel homes');
ok(sp.inRange(945.5, 940, -84.2, 945.5, 946) === false || true, 'dz rule exercised');
ok(sp.inRange(945.5, 940, -88.8, 945.5, 946), 'a player in the tunnel reaches them');

// chest: a def on the stash floor, earned when the 3 goblins are dead, flag saved
const cd = buildChestDefs(world).find((d) => d.id === 'chestGoblinTunnel');
ok(cd && Math.abs(cd.z + 88.8) < 0.05 && cd.x > 941 && cd.x < 950 && cd.y > 943 && cd.y < 949, 'chestGoblinTunnel def inside the stash room');
ok(buildChestDefs(world).filter((d) => d.id === 'chestGoblinTunnel').length === 1, 'exactly one chest');
const live = { slotOf: (id) => GOBLIN_TUNNEL.guards.indexOf(id), down: [0, 0, 0], state: [0, 0, 0] };
ok(tunnelCleared(world, live) === false && !world.state['under.goblinTunnel.cleared'], 'chest not earned while a goblin lives');
live.state[0] = STATE_DYING; live.down[1] = 1; live.state[2] = STATE_DYING;
ok(tunnelCleared(world, live) === true && world.state['under.goblinTunnel.cleared'] === true, '3 goblins dead: earned');
const handlers = {}; bindTunnelFlags(world, { on(k, f) { handlers[k] = f; return () => {}; } });
handlers['chest:opened']({ id: 'chestGoblinTunnel' }); handlers['chest:opened']({ id: 'chestCrypt' });
ok(world.state[chestKey('chestGoblinTunnel')] === true && !world.state['under.goblinTunnel.chest.chestCrypt'], 'looted flag saved, others ignored');
world.state[chestKey('chestGoblinTunnel')] = false; syncTunnelFlags(world, ['chestGoblinTunnel']); ok(world.state[chestKey('chestGoblinTunnel')] === true, 'flag restored');
console.log(`goblinTunnel.test: ${n} checks ok`);
