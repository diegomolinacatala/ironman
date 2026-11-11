/**
 * Weekly training of the demo athletes (base phase towards a half-distance
 * triathlon; ~10 h Diego, ~10 h Álex) as catalog sessions. Each one is built
 * with `specToDraft` (domain/sessions) and the athlete's thresholds, so the
 * demo shows the same concrete prescription the rules engine writes:
 * structure, ppm / pace / watts / RPE, cues, objective and plan B.
 * Weekday 0 = Monday.
 */
import type { SessionSpec } from '@/domain/sessions';
import type { ISOTime, Weekday } from '@/domain/types';

export interface SessionTemplate {
  weekday: Weekday;
  start: ISOTime | null;
  /** Catalog session at scale 1 (its duration follows the week's progression). */
  spec: SessionSpec;
  /** Planned distance at scale 1 (runs, rides); swims take the distance of their sets. */
  distanceM?: number;
}

/** Priority ≤ 2 makes a key session (`specToDraft`). */
export const DIEGO_WEEK: readonly SessionTemplate[] = [
  { weekday: 1, start: '07:00', spec: { code: 'SW_END', durationMin: 60, priority: 4 } },
  { weekday: 1, start: '19:30', spec: { code: 'RN_TEMPO', durationMin: 55, priority: 3 }, distanceM: 10000 },
  { weekday: 2, start: '19:00', spec: { code: 'BK_THR', durationMin: 75, priority: 2 } },
  { weekday: 3, start: '07:00', spec: { code: 'SW_CSS', durationMin: 50, priority: 3 } },
  { weekday: 3, start: '20:00', spec: { code: 'ST_MAINT', durationMin: 40, priority: 6 } },
  { weekday: 4, start: '19:30', spec: { code: 'RN_EASY', durationMin: 45, priority: 5 }, distanceM: 8000 },
  { weekday: 5, start: '08:30', spec: { code: 'BK_LONG', durationMin: 180, priority: 1 }, distanceM: 80000 },
  { weekday: 6, start: '09:00', spec: { code: 'RN_LONG', durationMin: 85, priority: 1 }, distanceM: 15000 },
];

export const ALEX_WEEK: readonly SessionTemplate[] = [
  { weekday: 0, start: '18:30', spec: { code: 'RN_EASY', durationMin: 50, priority: 5 }, distanceM: 9500 },
  { weekday: 1, start: '06:30', spec: { code: 'SW_END', durationMin: 60, priority: 4 } },
  { weekday: 2, start: '18:30', spec: { code: 'BK_SST', durationMin: 90, priority: 2 } },
  { weekday: 3, start: '06:30', spec: { code: 'SW_CSS', durationMin: 45, priority: 4 } },
  { weekday: 3, start: '19:30', spec: { code: 'RN_VO2', durationMin: 50, priority: 3 }, distanceM: 9000 },
  { weekday: 5, start: '08:30', spec: { code: 'BK_LONG', durationMin: 180, priority: 1 }, distanceM: 85000 },
  { weekday: 6, start: '09:30', spec: { code: 'RN_LONG', durationMin: 80, priority: 3 }, distanceM: 15500 },
];
