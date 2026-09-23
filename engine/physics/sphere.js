// engine/physics/sphere.js (US-013, docs/architecture.md 5 and 7.4 "Rollers").
//
// A rolling sphere (the boulder) reuses `moveCapsule` exactly: a sphere of
// radius r is a capsule of `height = 2r` whose feet sit at the sphere's
// bottom (`z`, same convention as a capsule's `footZ`), always `grounded`
// and with `stepUpMax = 0` - so a drop is always allowed (you fall) and any
// rise at all blocks (D-015 evaluation: this is why Rapier was not adopted
// for one sphere - see docs/backlog.md US-013 tech notes item 1).
//
// `opts` is caller-owned and reused every call (architecture.md section 9:
// no per-step allocation) - this function only overwrites its two fields,
// it never allocates a fresh options object.
import { moveCapsule } from './capsule.js';

/**
 * @param {{sectorAt:Function, outsideSector?:Function}} world
 * @param {number} x
 * @param {number} y
 * @param {number} dx
 * @param {number} dy
 * @param {number} radius
 * @param {number} z - the sphere's bottom (capsule footZ convention)
 * @param {{height:number, stepUpMax:number}} opts - caller-owned scratch, overwritten in place
 * @param {{x:number, y:number, blockedX:boolean, blockedY:boolean, nx:number, ny:number}} out - caller-owned scratch
 * @returns {typeof out}
 */
export function moveSphere(world, x, y, dx, dy, radius, z, opts, out) {
  opts.height = radius * 2;
  opts.stepUpMax = 0;
  return moveCapsule(world, x, y, dx, dy, radius, z, /* grounded */ true, opts, out);
}
