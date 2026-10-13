// game/js/life/chat.js (LIFE-05, architecture.md 38.56 b): NPC-NPC chat for the living world.
// Two NPCs whose schedule picks `chat` pair when within PAIR_R, both social > 0.5, both off cooldown, neither talking to the player.
// Paired: both stop (stopped(i)), face each other (partner(i): the view turns to it, yawFromDelta), alternate the talk clip every
// TURN_STEPS (talker()), 8-14 s long (hash). Lines are repeat-mode barks, shown only when the player is within HEAR_R, 6 s apart.
// Determinism: integer step timers, hashU only, no Math.random / clock / Map. Fixed step, 0 alloc (strings are precomputed).
import { hashU } from './schedule.js';

export const PAIR_R = 3, HEAR_R = 8, SOCIAL_MIN = 0.5, SOCIAL_DROP = 0.4;
export const PAIR_PERIOD = 60, COOLDOWN_STEPS = 90 * 60, TURN_STEPS = 150, BARK_GAP_STEPS = 6 * 60;
export const DUR_MIN = 8 * 60, DUR_SPAN = 6 * 60 + 1; // 8..14 s
export const KEY_PREFIX = 'life.chat.';

/**
 * @param {{schedule:object, x:ArrayLike<number>, y:ArrayLike<number>, player:{x:number,y:number}, barks:{play:Function,has:Function,cancel:Function,speaker:any},
 *   data?:{barks:object}, talkingToPlayer?:(i:number)=>boolean, canChat?:(i:number)=>boolean, seed?:number}} opt
 *  x/y are the live NPC positions (updated by the host); canChat(i) is false while an NPC walks/is scripted.
 */
export function createChat(opt) {
  const s = opt.schedule, n = s.n, npcs = s.life.npcs, seed = opt.seed | 0;
  const pairWith = new Int16Array(n).fill(-1), left = new Int32Array(n), cool = new Int32Array(n);
  const turnT = new Int32Array(n), turnNo = new Int32Array(n);
  let tick = 0, lastBark = -BARK_GAP_STEPS, nextSeq = 0;
  // Key tables built once. any[k] = 'life.chat.any.<k+1>'; pair entries parsed from the data (a, b ids, keys by turn).
  const any = [], pairs = [];
  const bd = opt.data && opt.data.barks ? opt.data.barks : {};
  for (let k = 1; opt.barks.has(KEY_PREFIX + 'any.' + k); k++) any.push(KEY_PREFIX + 'any.' + k);
  for (const key of Object.keys(bd)) {
    if (!key.startsWith(KEY_PREFIX) || key.startsWith(KEY_PREFIX + 'any.')) continue;
    const parts = key.slice(KEY_PREFIX.length).split('.');
    if (parts.length !== 3) continue;
    let e = null;
    for (let j = 0; j < pairs.length; j++) if (pairs[j].a === parts[0] && pairs[j].b === parts[1]) e = pairs[j];
    if (!e) pairs.push(e = { a: parts[0], b: parts[1], keys: [], ia: -1, ib: -1 });
    e.keys[(parseInt(parts[2], 10) | 0) - 1] = key;
  }
  const idxOf = (id) => { for (let i = 0; i < n; i++) if (npcs[i].id === id) return i; return -1; };
  for (const e of pairs) { e.ia = idxOf(e.a); e.ib = idxOf(e.b); e.keys = e.keys.filter(Boolean); }

  function lineKey(a, b, turn, h) {
    for (let j = 0; j < pairs.length; j++) {
      const e = pairs[j];
      if (((e.ia === a && e.ib === b) || (e.ia === b && e.ib === a)) && e.keys.length) return e.keys[(h + turn) % e.keys.length];
    }
    return any.length ? any[(h + turn) % any.length] : null;
  }
  function eligible(i) {
    const k = s.act[i];
    return k >= 0 && npcs[i].activities[k].kind === 'chat' && pairWith[i] < 0 && s.social[i] > SOCIAL_MIN && tick >= cool[i]
      && (!opt.canChat || opt.canChat(i)) && !(opt.talkingToPlayer && opt.talkingToPlayer(i));
  }
  function endPair(i) {
    const j = pairWith[i];
    if (j < 0) return;
    pairWith[i] = -1; pairWith[j] = -1;
    cool[i] = cool[j] = tick + COOLDOWN_STEPS;
    left[i] = left[j] = 0;
    if (opt.barks.speaker === i || opt.barks.speaker === j) opt.barks.cancel();
  }
  function say(speaker, other, turn) {
    if (tick - lastBark < BARK_GAP_STEPS) return;
    const dx = opt.x[speaker] - opt.player.x, dy = opt.y[speaker] - opt.player.y;
    if (dx * dx + dy * dy > HEAR_R * HEAR_R) return; // out of earshot: the chat runs silent
    const lo = speaker < other ? speaker : other, hi = speaker < other ? other : speaker;
    const key = lineKey(speaker, other, turn, hashU(seed, lo, hi) & 0xffff);
    if (key !== null && opt.barks.play(key, speaker, true)) lastBark = tick;
  }

  return {
    /** Partner index of NPC i, or -1. The view faces i toward it. */
    partner: (i) => pairWith[i],
    /** True while NPC i is in a chat: the host holds it still. */
    stopped: (i) => pairWith[i] >= 0,
    /** True while NPC i is the one talking (play the `talk` clip; the other idles/listens). */
    talker: (i) => { const j = pairWith[i]; return j >= 0 && ((turnNo[i] & 1) === (i < j ? 0 : 1)); },
    /** The player started talking to NPC i (or it was otherwise taken): ends its chat. */
    interrupt: (i) => endPair(i),
    /** Fixed step (60 Hz). */
    step() {
      tick++;
      for (let i = 0; i < n; i++) {
        const j = pairWith[i];
        if (j < 0 || i > j) continue; // handle each pair once, from its lower index
        if ((opt.talkingToPlayer && (opt.talkingToPlayer(i) || opt.talkingToPlayer(j))) || (opt.canChat && !(opt.canChat(i) && opt.canChat(j)))) { endPair(i); continue; }
        if (--left[i] <= 0) {
          s.social[i] = Math.max(0, s.social[i] - SOCIAL_DROP); s.social[j] = Math.max(0, s.social[j] - SOCIAL_DROP);
          endPair(i); continue;
        }
        if (--turnT[i] <= 0) {
          turnT[i] = TURN_STEPS; const t = ++turnNo[i]; turnNo[j] = t;
          if ((t & 1) === 0) say(i, j, t); else say(j, i, t);
        }
      }
      if (tick % PAIR_PERIOD !== 0) return;
      for (let i = 0; i < n; i++) {
        if (!eligible(i)) continue;
        for (let j = i + 1; j < n; j++) {
          if (!eligible(j)) continue;
          const dx = opt.x[i] - opt.x[j], dy = opt.y[i] - opt.y[j];
          if (dx * dx + dy * dy > PAIR_R * PAIR_R) continue;
          pairWith[i] = j; pairWith[j] = i;
          left[i] = left[j] = DUR_MIN + (hashU(seed, i * 64 + j, nextSeq++) % DUR_SPAN);
          turnT[i] = TURN_STEPS; turnNo[i] = turnNo[j] = 0;
          say(i, j, 0);
          break;
        }
      }
    },
  };
}
