/**
 * Pure mapping of device calendar events (EventKit via expo-calendar) to busy
 * blocks. Privacy: only start, end, the event's own title and its id leave the
 * device — never attendees, notes or locations. The title stays in the user's
 * own account: friends only see "ocupado" and the AI coach only start/end.
 */
import type { BusyBlockDraft, DateRange } from '@/domain/types';

const DAY_MS = 86_400_000;
const MAX_BLOCK_MS = DAY_MS;
const MAX_TEXT = 200;

/** Subset of `ExpoCalendarEvent` we read. */
export interface CalendarEventLike {
  id: string;
  title?: string | null;
  startDate: string | Date;
  endDate: string | Date;
  allDay?: boolean | null;
  /** 'busy' | 'free' | 'tentative' | 'unavailable' | 'notSupported' */
  availability?: string | null;
  /** 'none' | 'confirmed' | 'tentative' | 'canceled' */
  status?: string | null;
}

export interface TimeWindow {
  start: Date;
  end: Date;
}

function toTime(value: string | Date): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function cleanTitle(title: string | null | undefined): string | null {
  const trimmed = (title ?? '').trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

/** [from 00:00, day after `to` 00:00) in local time. */
export function rangeToWindow(range: DateRange): TimeWindow {
  const [fy, fm, fd] = range.from.split('-').map(Number);
  const [ty, tm, td] = range.to.split('-').map(Number);
  return {
    start: new Date(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1, 0, 0, 0, 0),
    end: new Date(ty ?? 1970, (tm ?? 1) - 1, (td ?? 1) + 1, 0, 0, 0, 0),
  };
}

/** True when the event blocks time: not all-day, not free/transparent, not cancelled. */
export function isBlockingEvent(event: CalendarEventLike): boolean {
  if (event.allDay) return false;
  if (event.availability === 'free') return false;
  if (event.status === 'canceled') return false;
  return true;
}

function toBlock(event: CalendarEventLike, window: TimeWindow): BusyBlockDraft | null {
  const rawStart = toTime(event.startDate);
  const rawEnd = toTime(event.endDate);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) return null;
  const start = Math.max(rawStart, window.start.getTime());
  const end = Math.min(rawEnd, window.end.getTime(), start + MAX_BLOCK_MS);
  if (end <= start) return null;
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    source: 'device_calendar',
    title: cleanTitle(event.title),
    externalId: event.id ? event.id.slice(0, MAX_TEXT) : null,
  };
}

/**
 * Busy blocks for the window: skips all-day / free / cancelled events, clips to
 * the window, clamps each block to 24 h (DB constraint) and drops duplicates
 * (same event id and start, e.g. an event present in two selected calendars).
 */
export function mapEventsToBusyBlocks(events: readonly CalendarEventLike[], window: TimeWindow): BusyBlockDraft[] {
  const seen = new Set<string>();
  return events
    .filter(isBlockingEvent)
    .map((e) => toBlock(e, window))
    .filter((b): b is BusyBlockDraft => b !== null)
    .filter((b) => {
      const key = `${b.externalId ?? ''}|${b.start}|${b.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}
