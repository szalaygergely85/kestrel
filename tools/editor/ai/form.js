// tools/editor/ai/form.js - ED-AI-03. Field-spec tables the Creatures form is generated from (label, unit, min, max, step,
// group). Ranges of the archetype fields mirror validate.js (form.test.mjs probes the validator to keep them equal).
// Pure, no DOM, no game/ import.
import { LEASH_NEVER, ARCH_ENUMS, WINDUP_MIN_SEC, BIG_WINDUP_MIN_SEC } from './validate.js';

export const ARCH_GROUPS = Object.freeze(['Senses', 'Movement', 'Fighting']);
export const ARCH_FIELDS = Object.freeze([
  { key: 'noticeR', label: 'Notice distance', unit: 'm', min: 1, max: 80, step: 0.5, group: 'Senses' },
  { key: 'nearR', label: 'Always notices within', unit: 'm', min: 0, max: 80, step: 0.5, group: 'Senses' },
  { key: 'coneCos', label: 'Field of view (cosine)', unit: '', min: -1, max: 1, step: 0.05, group: 'Senses' },
  { key: 'noticeSec', label: 'Time to notice', unit: 's', min: 0.1, max: 3, step: 0.05, group: 'Senses' },
  { key: 'loseR', label: 'Give-up distance', unit: 'm', min: 1, max: 200, step: 1, group: 'Senses' },
  { key: 'loseSightSec', label: 'Give-up time', unit: 's', min: 0.5, max: 60, step: 0.5, group: 'Senses' },
  { key: 'walk', label: 'Walk speed', unit: 'm/s', min: 0, max: 12, step: 0.1, group: 'Movement' },
  { key: 'run', label: 'Run speed', unit: 'm/s', min: 0, max: 12, step: 0.1, group: 'Movement' },
  { key: 'leashR', label: 'Leash distance', unit: 'm', min: 5, max: 500, step: 1, group: 'Movement', special: LEASH_NEVER, specialLabel: 'No leash' },
  { key: 'role', label: 'Fighting style', enum: ARCH_ENUMS.role, group: 'Fighting' },
  { key: 'keepMin', label: 'Keeps distance (min)', unit: 'm', min: 0, max: 100, step: 0.5, group: 'Fighting' },
  { key: 'keepMax', label: 'Keeps distance (max)', unit: 'm', min: 0, max: 100, step: 0.5, group: 'Fighting' },
  { key: 'backOffR', label: 'Backs off within', unit: 'm', min: 0, max: 100, step: 0.5, group: 'Fighting' },
]);
// Attack numbers: the validator only gives a lower bound (0 or more); the upper ends are slider conveniences.
export const ATTACK_FIELDS = Object.freeze([
  { key: 'type', label: 'Type', text: true },
  { key: 'range', label: 'Range', unit: 'm', min: 0, max: 60, step: 0.5 },
  { key: 'windupSec', label: 'Wind-up', unit: 's', min: WINDUP_MIN_SEC, max: 5, step: 0.05, windup: true },
  { key: 'activeSec', label: 'Strike', unit: 's', min: 0, max: 5, step: 0.05 },
  { key: 'recoverSec', label: 'Recover', unit: 's', min: 0, max: 8, step: 0.05 },
  { key: 'cooldownSec', label: 'Cooldown', unit: 's', min: 0, max: 30, step: 0.1 },
  { key: 'dmgF', label: 'Damage', unit: 'x', min: 0, max: 5, step: 0.05 },
  { key: 'weight', label: 'Weight', unit: '', min: 0.05, max: 10, step: 0.05 },
]);
export const specOf = (list, key) => list.find((s) => s.key === key);

/** Big attack = area attack or damage >= 2.4 (validate.js). */
export const isBigAttack = (at) => !!at && (at.type === 'aoe' || (typeof at.dmgF === 'number' && at.dmgF >= 2.4));
export const attackNote = (at) => (isBigAttack(at) ? 'needs ground marker' : '');
/** Effective [min, max] of a spec for the current row (wind-up of a big attack cannot go under 0.8 s). */
export function boundsOf(spec, attack) {
  if (spec.windup && isBigAttack(attack)) return [BIG_WINDUP_MIN_SEC, spec.max];
  return [spec.min, spec.max];
}
/** Clamp typed input. Returns { value, clamped } (clamped = flagged in the UI). NaN keeps `fallback`. */
export function clampField(spec, raw, attack, fallback) {
  if (spec.enum) return { value: spec.enum.includes(raw) ? raw : fallback, clamped: !spec.enum.includes(raw) };
  if (spec.text) return { value: String(raw || fallback), clamped: !raw };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { value: fallback, clamped: true };
  if (spec.special !== undefined && n === spec.special) return { value: n, clamped: false };
  const [lo, hi] = boundsOf(spec, attack);
  const v = Math.min(hi, Math.max(lo, n));
  return { value: v, clamped: v !== n };
}
