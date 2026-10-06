/*
 * Preview-only stand-in for what World.load injects into the terrain recipe (CO-2/CO-8/CO-9):
 * design/levels/overworld_far.js structures[i].bbox + .ringHAt. The recipe has no x/y/w/h/ringH any more,
 * so a preview that calls OW.util.heightAt without World.load would crash in structureBlend. Load AFTER
 * content-shim.js and ../levels/overworld_far.js. Source of truth = content/worlds/world_m1.world.json
 * (origin) + content/levels/tower.level.json (size, outer ring) - nothing is hard-coded here.
 * Also sets st.x/y/w/h/ringH (convenience aliases for the old preview checks).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS, OW = A && A.levels && A.levels.overworld_far, WM = A && A.worlds && A.worlds.world_m1;
  if (!OW || !WM) return;
  (OW.structures || []).forEach(function (rs) {
    var p = (WM.structures || []).filter(function (s) { return s.id === rs.id; })[0], lv = A.levels[rs.level];
    if (!p || !lv) return;
    var ring = lv.legend[lv.rows[0].charAt(0)].floorH;          // outer ring is flat (authoring rule)
    var o = p.origin;
    rs.bbox = { x0: o.x, y0: o.y, x1: o.x + lv.size.w, y1: o.y + lv.size.h };   // yawSteps 0 only
    rs.ringHAt = function () { return o.z + ring; };
    if (!OW.origin) OW.origin = { x: o.x, y: o.y, z: o.z };   // old alias: the tower's world origin (was recipe.origin)
    rs.x = rs.bbox.x0; rs.y = rs.bbox.y0; rs.w = lv.size.w; rs.h = lv.size.h; rs.ringH = o.z + ring;
  });
})(typeof window !== 'undefined' ? window : globalThis);
