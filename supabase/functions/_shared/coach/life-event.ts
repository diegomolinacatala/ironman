/**
 * Validation of the imprevisto the coach wants to log (`life_event` in its
 * structured output) and duplicate detection against the events already in
 * the planning context. Pure.
 */
import { addDays, diffDays, isIsoDate } from '../dates.ts';
import type { LifeEventInsert } from '../planning/store.ts';
import type { Result } from '../schema.ts';
import type { ISODate } from '../types.ts';
import { lifeEventOutputSchema } from './output.ts';

/** How far back / ahead the coach may date an imprevisto, and its longest span. */
export const LIFE_EVENT_PAST_DAYS = 30;
export const LIFE_EVENT_FUTURE_DAYS = 180;
/** Same as the `life_events` check (end_date - start_date <= 120). */
export const LIFE_EVENT_MAX_SPAN_DAYS = 120;

const clip = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max);

/** Structured-output `life_event` → insert row (end defaults to start; end ≥ start; sane date window). */
export function toLifeEventInsert(raw: unknown, today: ISODate): Result<LifeEventInsert> {
  const parsed = lifeEventOutputSchema.parse(raw, 'life_event');
  if (!parsed.ok) return parsed;
  const e = parsed.value;
  const start = e.start_date;
  const end = e.end_date ?? start;
  if (!isIsoDate(start) || !isIsoDate(end)) return { ok: false, error: 'life_event: fechas no válidas' };
  if (end < start) return { ok: false, error: 'life_event: end_date anterior a start_date' };
  if (start < addDays(today, -LIFE_EVENT_PAST_DAYS) || start > addDays(today, LIFE_EVENT_FUTURE_DAYS)) {
    return { ok: false, error: 'life_event: start_date fuera de rango' };
  }
  if (diffDays(end, start) > LIFE_EVENT_MAX_SPAN_DAYS) return { ok: false, error: 'life_event: demasiado largo' };
  const title = clip(e.title, 120);
  if (!title) return { ok: false, error: 'life_event: título vacío' };
  const notes = e.notes === null ? null : clip(e.notes, 1000) || null;
  return {
    ok: true,
    value: {
      kind: e.kind,
      title,
      startDate: start,
      endDate: end,
      startTime: null,
      durationMin: null,
      severity: e.severity,
      bodyArea: e.body_area,
      notes,
    },
  };
}

const norm = (v: unknown): string =>
  typeof v === 'string'
    ? v
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
    : '';

/**
 * True when an overlapping event of the same kind is already logged with the
 * same body area or title (the athlete mentioning the same knee twice).
 */
export function isDuplicateLifeEvent(candidate: LifeEventInsert, existing: readonly Record<string, unknown>[]): boolean {
  return existing.some((e) => {
    if (e.kind !== candidate.kind) return false;
    const start = typeof e.startDate === 'string' ? e.startDate : '';
    const end = typeof e.endDate === 'string' ? e.endDate : start;
    const overlaps = start <= candidate.endDate && end >= candidate.startDate;
    const sameArea = candidate.bodyArea !== null && e.bodyArea === candidate.bodyArea;
    return overlaps && (sameArea || norm(e.title) === norm(candidate.title));
  });
}
