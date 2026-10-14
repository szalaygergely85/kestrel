/* design/ui-region-banner.js - REGION-01: style + place names for the region-entry banner.
 * Classic script (check-deps rule 4), loaded after design/palette.js:  ASSETS.uiRegionBanner = { style, names }.
 * names: world_geo region id -> approved MAP-27 name (docs/story.md "Places on the chart"). A region NOT listed (or null)
 *   shows nothing: no placeholder text (AC2). roadWest = 'The West Road', outwall = 'The Barley Fields' (WMP-10; the village name 'Outwall' stays off screen).
 * style: times in seconds; colour keys are existing palette.js section 8 keys; `plate` is a literal dark RGB like itemGetCard.
 */
(function (g) {
  var A = g.ASSETS = g.ASSETS || {};
  A.uiRegionBanner = {
    style: { scale: 2, y: 6, fadeIn: 0.4, hold: 2.5, fadeOut: 0.6, awaySec: 600, fg: 'gold', plate: '#0a0b10', pad: 1 },
    names: {
      east: "Ferrum's Wall", tower: 'The Watchtower', roadWest: 'The West Road', ford: 'The Crossroads',
      whitecombs: 'The Whitecombs', westFells: 'The West Fells', northwood: 'Northwood', glasswater: 'Glasswater',
      alpine: 'High Pastures', thornwood: 'The Thornwood', outwall: 'The Barley Fields', ashMile: 'The Ash Mile', downs: 'The Downs',
      signalHill: 'Signal Hill', westHeath: 'The Shearcliffs', reedmire: 'The Reedmire', strand: 'The Long Strand',
      heartland: 'The Hollins'
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
