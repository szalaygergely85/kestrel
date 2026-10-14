// game/js/quest/sim/brains/layers.js (BEAST-03b). LAYERS[archIdx] = the layer function of that archetype (fixed array,
// index = ARCH_NAMES order). Every archetype uses the ground layer until its own layer lands (04 pack/ranged/caster,
// 08 water, flyer, ambush, swarm, tank): the table below is the single place to swap one in.
import { ARCH_NAMES } from '../archetypes.js';
import { groundLayer } from './ground.js';

const BY_ARCH = Object.freeze({}); // name -> layer; empty until BEAST-04+
export const LAYERS = Object.freeze(ARCH_NAMES.map((n) => BY_ARCH[n] || groundLayer));
