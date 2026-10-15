// R6-FIX A: the ONE table of NPC display names (talk prompt "[E] Talk to X", errand labels) + object labels + the generic Talk list.
export const NPC_NAMES = { bear: 'Burl', rook: 'Rook', hesk: 'Hesk', dorrin: 'Dorrin', postkeeper: 'Bram', joss: 'Joss', warden_ashmile: 'Tull', warden_downs: 'Edda', warden_glasswater: 'Lin', warden_heath: 'Nell', warden_highpastures: 'Ewan', warden_northwood: 'Brenna', warden_reedmire: 'Orla', warden_signalhill: 'Ivo', warden_strand: 'Kit', warden_whitecombs: 'Sten' }; // OB-054b / OB-058 writer names (docs/story.md)
export const OBJECT_LABELS = { relayBend: 'Bend Waystone', relayFord: 'Ford Waystone', owBoard: 'Notice board', pierStone: 'Pier stone', relay_glasswater: 'Glasswater Waystone', relay_northwood: 'Northwood Waystone', relay_highPastures: 'Pasture Waystone', relay_ashMile: 'Ash Mile Waystone', relay_downs: 'Downs Waystone', relay_signalHill: 'Signal Hill Waystone', relay_heath: 'Heath Waystone', relay_reedmire: 'Reedmire Waystone', relay_strand: 'Strand Waystone', relay_whitecombs: 'Combfoot Waystone', post: 'trade basket', notePost: 'notice post', gondola: 'wrecked airship', packet: 'cloth packet', noteKeepLight: 'pinned note', noteSteelHush: 'pinned note', noteLeave: 'pinned note' };

/** Entity ids of every giver npc / turn-in npc (not object givers) that has a compiled dialogue: each gets an [E] Talk interactable. */
export function talkNpcIds(giverDefs, dialogues) {
  const out = new Set();
  for (const d of giverDefs || []) {
    const g = d && d.giver; if (!g || d.objectGiver) continue;
    for (const id of [g.npc, g.turnIn]) if (typeof id === 'string' && dialogues && dialogues[id]) out.add(id);
  }
  return [...out];
}
