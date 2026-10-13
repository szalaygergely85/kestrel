// CH1-04a: game text table for notice banners (WRITER strings, docs/story.md q05/q06). A waypoint's `waystone.notice` names a key here.
// title <= 30 chars, up to 3 lines <= 38 chars each (architecture 38.37 item 4).
export const NOTICE_TEXT = Object.freeze({
  waystone: Object.freeze({ title: 'WAYSTONE AWAKENED', lines: Object.freeze(['Your journey is remembered here.', 'You will return here if you fall.', 'Find more Waystones to unlock travel.']) }),
  relay: Object.freeze({ title: 'BEND RELAY AWAKENED', lines: Object.freeze(['Travel unlocked.', 'You can now travel between', 'awakened Waystones.']) }),
});
