// tools/editor/quest/questStrip.js - ED-QUI-01. Pure view model for the Quest tab's context strip + the card order.
import { isSide, regionOf } from './flow.js';

/** The numbered cards of the Quest tab, in order (owner mockup OB-214). */
export const CARDS = [
  { n: '01', id: 'prereq', title: 'Prerequisites' },
  { n: '02', id: 'spatial', title: 'Origin and turn-in' },
  { n: '03', id: 'objectives', title: 'Objectives' },
  { n: '04', id: 'conversation', title: 'Conversation' },
  { n: '05', id: 'rewards', title: 'Rewards' },
  { n: '06', id: 'validate', title: 'Validate and simulate' },
];

/** lint = liveLint messages [{severity}]. Anything not 'error' counts as a warning. */
export function stripModel(q, lint = []) {
  const errors = lint.filter((m) => m.severity === 'error').length, warnings = lint.length - errors;
  const status = errors ? { kind: 'error', label: errors + (errors === 1 ? ' ERROR' : ' ERRORS') }
    : warnings ? { kind: 'warn', label: warnings + (warnings === 1 ? ' WARNING' : ' WARNINGS') }
      : { kind: 'ok', label: 'VALID' };
  const side = isSide(q);
  return { id: q.id, title: q.title || '', type: side ? 'side' : 'main', color: side ? 'blue' : 'gold', region: regionOf(q), status, counts: { errors, warnings } };
}
