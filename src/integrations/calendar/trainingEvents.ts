/**
 * Pure builders for the "Road to Ironman" device calendar (unit-tested):
 * workout → event details + signature, and the create / update / delete plan of a sync.
 *
 * Which workouts get an event (window [today − 1, today + 21]):
 * - planned sessions (not rest days);
 * - completed ones only if they already have an event (title gets " ✓");
 * - skipped / deleted / moved-out workouts lose theirs.
 * Events outside the window (history) are never touched. Our events are recognised by the
 * stored mapping or by their `…://workout/<id>` URL (survives a lost mapping / id change).
 */
import { addDays, formatDistance, formatDuration } from '@/domain/dates';
import { intensityLabel, sportLabel } from '@/domain/labels';
import type { DateRange, ISODate, Sport, Workout, WorkoutStep } from '@/domain/types';
import { stepLabel } from '@/features/workouts/steps';

import { atLocal, isValidTimeZone, localDate, parseTimeMinutes, zonedDateTime } from '../time';
import type { EventLink } from './trainingCalendarStore';

export const WINDOW_PAST_DAYS = 1;
export const WINDOW_FUTURE_DAYS = 21;
const MIN_EVENT_MIN = 15;
const MAX_NOTES = 4000;

const SPORT_EMOJI: Record<Sport, string> = {
  swim: '🏊',
  bike: '🚴',
  run: '🏃',
  brick: '🔁',
  strength: '🏋️',
  mobility: '🧘',
  other: '🏅',
  rest: '😴',
};

export interface TrainingEventDetails {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  notes: string;
  url: string;
  alarms: { relativeOffset: number }[];
  /** IANA zone for timed events; absent for all-day (floating) ones. */
  timeZone?: string;
}

export interface EventOptions {
  /** "roadtoironman://" */
  linkBase: string;
  alarmMinutes: number;
  /** Profile time zone; null → device local time. */
  timeZone: string | null;
}

/** Workouts that may have an event: [today − 1, today + 21]. */
export function trainingCalendarWindow(today: ISODate): DateRange {
  return { from: addDays(today, -WINDOW_PAST_DAYS), to: addDays(today, WINDOW_FUTURE_DAYS) };
}

export function workoutLink(linkBase: string, workoutId: string): string {
  return `${linkBase}workout/${workoutId}`;
}

/** Workout id of one of our event URLs ("roadtoironman://workout/<id>", any scheme). */
export function workoutIdFromUrl(url: string | null | undefined): string | null {
  const match = url ? /^[a-z][a-z0-9+.-]*:\/\/workout\/([A-Za-z0-9_-]+)\/?$/i.exec(url.trim()) : null;
  return match?.[1] ?? null;
}

/** "🏃 Rodaje suave · 50'" (+ " ✓" when done). */
export function eventTitle(w: Pick<Workout, 'sport' | 'title' | 'durationMin' | 'status'>): string {
  const base = `${SPORT_EMOJI[w.sport] ?? '🏅'} ${w.title.trim()} · ${formatDuration(w.durationMin)}`;
  return w.status === 'completed' ? `${base} ✓` : base;
}

function stepLine(step: WorkoutStep, sport: Sport): string {
  const intensity = step.intensity ? ` (${intensityLabel(step.intensity)})` : '';
  const note = step.note?.trim() ? ` — ${step.note.trim()}` : '';
  return `• ${stepLabel(step, sport)}${intensity}${note}`;
}

/** Intensity, structure and the deep link back into the app. */
export function eventNotes(w: Workout, link: string): string {
  const facts = [sportLabel(w.sport), intensityLabel(w.intensity), formatDuration(w.durationMin)];
  const distance = w.distanceM != null && w.distanceM > 0 ? [formatDistance(w.distanceM, w.sport)] : [];
  const lines = [
    [...facts, ...distance].join(' · '),
    ...(w.status === 'completed' ? ['Hecho ✓'] : []),
    ...(w.description?.trim() ? ['', w.description.trim()] : []),
    ...(w.steps.length > 0 ? ['', 'Estructura:', ...w.steps.map((s) => stepLine(s, w.sport))] : []),
    '',
    `Abrir en la app: ${link}`,
  ];
  const text = lines.join('\n');
  return text.length <= MAX_NOTES ? text : `${text.slice(0, MAX_NOTES - link.length - 2)}…\n${link}`;
}

export function eventDetails(w: Workout, opts: EventOptions): TrainingEventDetails {
  const url = workoutLink(opts.linkBase, w.id);
  const common = { title: eventTitle(w), notes: eventNotes(w, url), url };
  const start = parseTimeMinutes(w.startTime);
  if (start == null) {
    // All-day ("Hoy toca…"): the morning briefing already covers it, so no alarm.
    return { ...common, startDate: atLocal(w.date, 0), endDate: atLocal(w.date, 24 * 60 - 1), allDay: true, alarms: [] };
  }
  const timeZone = isValidTimeZone(opts.timeZone) ? opts.timeZone : undefined;
  const startDate = zonedDateTime(w.date, start, timeZone);
  const endDate = new Date(startDate.getTime() + Math.max(MIN_EVENT_MIN, w.durationMin) * 60_000);
  const alarms = opts.alarmMinutes > 0 ? [{ relativeOffset: -opts.alarmMinutes }] : [];
  return { ...common, startDate, endDate, allDay: false, alarms, ...(timeZone ? { timeZone } : {}) };
}

/** Short stable hash (FNV-1a, 32 bit) of what we write: only changed events are rewritten. */
export function eventSignature(details: TrainingEventDetails): string {
  const text = JSON.stringify([
    details.title,
    details.startDate.toISOString(),
    details.endDate.toISOString(),
    details.allDay,
    details.notes,
    details.url,
    details.alarms.map((a) => a.relativeOffset),
    details.timeZone ?? '',
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}${text.length.toString(16)}`;
}

/** What we read back from the calendar. */
export interface ExistingEvent {
  id: string;
  url?: string | null;
  startDate: string | Date;
}

export interface PlannedWrite {
  workoutId: string;
  details: TrainingEventDetails;
  signature: string;
}

export interface CalendarSyncPlan {
  creates: PlannedWrite[];
  updates: (PlannedWrite & { eventId: string })[];
  deletes: string[];
  /** Mapping after the sync, without the events still to be created. */
  mapping: Record<string, EventLink>;
  unchanged: number;
}

export interface CalendarSyncInput extends EventOptions {
  workouts: readonly Workout[];
  today: ISODate;
  existing: readonly ExistingEvent[];
  mapping: Readonly<Record<string, EventLink>>;
}

/** Our events grouped by workout id (the mapped event first). */
function groupOurEvents(existing: readonly ExistingEvent[], mapping: Readonly<Record<string, EventLink>>): Map<string, ExistingEvent[]> {
  const byEventId = new Map(Object.entries(mapping).map(([workoutId, link]) => [link.eventId, workoutId]));
  const groups = new Map<string, ExistingEvent[]>();
  for (const event of existing) {
    const workoutId = byEventId.get(event.id) ?? workoutIdFromUrl(event.url);
    if (!workoutId) continue;
    const mapped = mapping[workoutId]?.eventId === event.id;
    const list = groups.get(workoutId) ?? [];
    groups.set(workoutId, mapped ? [event, ...list] : [...list, event]);
  }
  return groups;
}

function eventDate(event: ExistingEvent): ISODate | null {
  const time = event.startDate instanceof Date ? event.startDate.getTime() : Date.parse(event.startDate);
  return Number.isFinite(time) ? localDate(new Date(time)) : null;
}

function wantsEvent(w: Workout, window: DateRange, hasEvent: boolean): boolean {
  if (w.date < window.from || w.date > window.to || w.sport === 'rest') return false;
  if (w.status === 'planned') return true;
  return w.status === 'completed' && hasEvent;
}

export function planCalendarSync(input: CalendarSyncInput): CalendarSyncPlan {
  const window = trainingCalendarWindow(input.today);
  const groups = groupOurEvents(input.existing, input.mapping);
  const plan: CalendarSyncPlan = { creates: [], updates: [], deletes: [], mapping: {}, unchanged: 0 };
  const handled = new Set<string>();

  for (const w of input.workouts) {
    const events = groups.get(w.id) ?? [];
    if (handled.has(w.id) || !wantsEvent(w, window, events.length > 0)) continue;
    handled.add(w.id);
    const details = eventDetails(w, input);
    const signature = eventSignature(details);
    const [primary, ...duplicates] = events;
    plan.deletes.push(...duplicates.map((e) => e.id));
    if (!primary) {
      plan.creates.push({ workoutId: w.id, details, signature });
      continue;
    }
    const link = input.mapping[w.id];
    if (link?.eventId === primary.id && link.signature === signature) plan.unchanged += 1;
    else plan.updates.push({ workoutId: w.id, eventId: primary.id, details, signature });
    plan.mapping[w.id] = { eventId: primary.id, signature };
  }

  for (const [workoutId, events] of groups) {
    if (handled.has(workoutId)) continue;
    const inWindow = events.filter((e) => {
      const date = eventDate(e);
      return date !== null && date >= window.from && date <= window.to;
    });
    plan.deletes.push(...inWindow.map((e) => e.id));
  }
  return plan;
}
