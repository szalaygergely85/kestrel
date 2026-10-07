// game/js/quest/startConfig.js (HANDS-01b, 37.8a): the two start states of the player's inventory. main.js picks
// `?demo=0` -> START_FULL (empty, play from scratch), otherwise START_DEMO (owner answer 2: the fireball is
// known from the start in the right hand; the sword is taken in the tower and goes to the left hand).
export const START_DEMO = Object.freeze({ pack: Object.freeze([Object.freeze({ id: 'spell.fireball', n: 1 })]), left: null, right: 'spell.fireball' });
export const START_FULL = Object.freeze({ pack: Object.freeze([]), left: null, right: null });
