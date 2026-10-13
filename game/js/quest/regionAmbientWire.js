// WMP-03 boot helper: builds the region-ambient object for main.js, or null (no table / no geo / no wild fauna / capture-bench pages).
import { createRegionAmbient } from './regionAmbient.js';

/** @param {{table:Object|null, geo:{regions:Array}|null, wild:{species:Array}|null, skip?:boolean, knownCues?:string[], onCue?:Function}} o */
export function bootRegionAmbient({ table, geo, wild, skip = false, knownCues = [], onCue = null }) {
  if (skip || !table || !geo || !geo.regions || !wild || !wild.species) return null;
  try { return createRegionAmbient({ regions: geo.regions, table, species: wild.species, knownCues, onCue }); }
  catch (e) { console.warn('[regionAmbient] off:', e && e.message); return null; }
}
