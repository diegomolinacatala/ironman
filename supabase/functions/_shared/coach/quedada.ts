/**
 * Validation of the quedada the coach suggests (`quedada` in its structured
 * output). It is only a suggestion: nothing is written, the app shows a card
 * that opens the prefilled "nueva quedada" form. Pure.
 */
import { addDays, isIsoDate } from '../dates.ts';
import type { Result } from '../schema.ts';
import type { CoachQuedada, ISODate, UUID } from '../types.ts';
import { quedadaOutputSchema } from './output.ts';

export const QUEDADA_LIMITS = {
  minDuration: 5,
  maxDuration: 720,
  titleMax: 120,
  locationMax: 200,
  reasonMax: 300,
} as const;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface QuedadaCheck {
  /** `CoachRequest.friendIds`: the friends the athlete asked about. */
  friendIds: readonly UUID[];
  /** `PlanningContext.friends`: accepted friends (source of the display name). */
  friends: readonly { friendId: UUID; name: string }[];
  today: ISODate;
  weekStart: ISODate;
}

const clip = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max);

const fail = (error: string): Result<CoachQuedada> => ({ ok: false, error: `quedada: ${error}` });

/** Structured-output `quedada` → camelCase suggestion, or an error (the caller logs it and stores null). */
export function toCoachQuedada(raw: unknown, check: QuedadaCheck): Result<CoachQuedada> {
  const parsed = quedadaOutputSchema.parse(raw, 'quedada');
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const friend = check.friends.find((f) => f.friendId === q.friend_id);
  if (!check.friendIds.includes(q.friend_id) || !friend) return fail('friend_id no es un amigo de la petición');
  if (!isIsoDate(q.date)) return fail('fecha no válida');
  if (q.date < check.today || q.date > addDays(check.weekStart, 13)) return fail('fecha fuera de rango');
  if (q.sport === 'rest') return fail('deporte no válido');
  if (!Number.isInteger(q.duration_min) || q.duration_min < QUEDADA_LIMITS.minDuration || q.duration_min > QUEDADA_LIMITS.maxDuration) {
    return fail('duración fuera de rango');
  }
  const startTime = q.start_time === null ? null : q.start_time.trim();
  if (startTime !== null && !HHMM_RE.test(startTime)) return fail('start_time debe ser HH:mm');
  const title = q.title.replace(/\s+/g, ' ').trim();
  if (title.length < 1 || title.length > QUEDADA_LIMITS.titleMax) return fail('título vacío o demasiado largo');
  const location = q.location === null ? null : q.location.replace(/\s+/g, ' ').trim();
  if (location !== null && location.length > QUEDADA_LIMITS.locationMax) return fail('lugar demasiado largo');
  return {
    ok: true,
    value: {
      friendId: q.friend_id,
      friendName: friend.name,
      sport: q.sport,
      date: q.date,
      startTime,
      durationMin: q.duration_min,
      intensity: q.intensity,
      title,
      location: location ? location : null,
      reason: clip(q.reason, QUEDADA_LIMITS.reasonMax),
    },
  };
}
