// tools/editor/quest/originCards.js - ED-QUI-03. Card [02]: ORIGIN (giver, `!`) and TURN-IN (`?`) as plain view models + the turn-in writer.
// Pure (imports model.js, format.js, flow.js, targets.js). Turn-in must be a CHARACTER (OB-156 / D-108); an object giver is allowed as giver only (D-087).
import { setQuestField } from './model.js';
import { isFormatDef } from './format.js';
import { regionOf, isSide } from './flow.js';
import { resolveTarget } from './targets.js';

export const TALK_RADIUS_M = 2.5;   // the talk prompt radius shown read-only (editor mirror of the game's NPC talk range)
const KIND = { character: 'Character', object: 'Object', enemy: 'Beast' };
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

/** The raw refs of a quest in any shape: { giver, turnIn, objectGiver } (null when absent). */
export function originRefs(q) {
  const r = q.raw, g = r.giver || {};
  const begin = r.begin ? (r.begin.npc !== undefined ? r.begin.npc : r.begin.object) : null;
  const giver = begin ?? g.npc ?? r.site ?? null;
  const turnIn = (r.end && r.end.npc) ?? g.turnIn ?? r.turnIn ?? null;
  return { giver: giver || null, turnIn: turnIn || null, objectGiver: r.objectGiver === true || (!!r.begin && r.begin.object !== undefined) };
}

/** -> { origin, turnIn, problems:[string] }; each card { glyph, color, ref, name, id, kind, pos:{x,y,z}|null, radius, region, same, problem|null }. */
export function originCards(q, world, names, sites = {}, floorAt) {
  const refs = originRefs(q), color = isSide(q) ? 'blue' : 'gold', region = regionOf(q);
  const nameOf = (ref) => (names && names.npc ? names.npc(ref) : ref);
  const card = (glyph, ref, same, want) => {
    const t = ref ? resolveTarget(world || { entities: [] }, ref, { sites, floorAt }) : null;
    const c = { glyph, color, ref, name: ref ? nameOf(ref) : '(nobody)', id: t ? t.id : ref, kind: t ? KIND[t.kind] : (ref ? 'Missing' : 'None'), pos: t ? { x: r1(t.x), y: r1(t.y), z: r1(t.z) } : null, radius: TALK_RADIUS_M, region, same, problem: null };
    if (!ref) c.problem = want === 'giver' ? 'No giver: pick a character who offers the quest' : 'No turn-in: pick a character to hand in to';
    else if (!t) c.problem = 'Not found in the world: "' + ref + '"';
    else if (want === 'turnIn' && t.kind !== 'character') c.problem = 'The turn-in must be a character, not ' + (t.kind === 'enemy' ? 'a beast' : 'an object') + ' (D-108)';
    else if (want === 'giver' && t.kind !== 'character' && !(t.kind === 'object' && refs.objectGiver)) c.problem = 'The giver is ' + (t.kind === 'enemy' ? 'a beast' : 'an object') + ', not a character';
    return c;
  };
  const origin = card('!', refs.giver, false, 'giver');
  const same = !refs.turnIn || refs.turnIn === refs.giver;
  const turnIn = card('?', same ? refs.giver : refs.turnIn, same, 'turnIn');
  if (same && refs.giver && origin.kind === 'Object') turnIn.problem = 'An object giver needs a turn-in character (D-108)';
  const problems = [origin.problem, turnIn.problem].filter(Boolean);
  return { origin, turnIn, problems };
}

/** "Same as giver": removes the separate turn-in, keeping the file's shape (format `end` becomes the giver's npc). null when nothing to change. */
export function setTurnInSameAsGiver(q) {
  const refs = originRefs(q), r = q.raw;
  if (r.end !== undefined || isFormatDef(r)) return refs.giver ? setQuestField(q, 'end', { npc: refs.giver }) : null;
  if (r.giver && r.giver.turnIn !== undefined) { const g = { ...r.giver }; delete g.turnIn; return setQuestField(q, 'giver', g); }
  if (r.turnIn !== undefined) return setQuestField(q, 'turnIn', undefined);
  return null;
}
