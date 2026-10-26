/**
 * Minimal RFC 5545 writer: TEXT escaping, 75-octet line folding (UTF-8 safe),
 * CRLF line endings, Europe/Madrid VTIMEZONE, timed and all-day VEVENTs.
 */
import { addDays, timeToMinutes } from '../dates.ts';
import type { ISODate, ISOTime } from '../types.ts';

export const ICS_TZID = 'Europe/Madrid';
const CRLF = '\r\n';
const MAX_OCTETS = 75;

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting UTF-8 sequences. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = out.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (octets + size > limit) {
      out.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join(CRLF);
}

const compactDate = (date: ISODate): string => date.replace(/-/g, '');

export function formatLocalDateTime(date: ISODate, time: ISOTime): string {
  return `${compactDate(date)}T${time.replace(':', '')}00`;
}

export function formatUtcStamp(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Wall-clock end of a timed event (may roll over to the next day). */
export function localEnd(date: ISODate, start: ISOTime, durationMin: number): { date: ISODate; time: ISOTime } {
  const total = timeToMinutes(start) + Math.max(15, Math.round(durationMin));
  const dayOffset = Math.floor(total / 1440);
  const minutes = total % 1440;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return { date: addDays(date, dayOffset), time: `${hh}:${mm}` };
}

export const VTIMEZONE_MADRID: readonly string[] = [
  'BEGIN:VTIMEZONE',
  `TZID:${ICS_TZID}`,
  `X-LIC-LOCATION:${ICS_TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

export interface IcsEvent {
  uid: string;
  stamp: Date;
  summary: string;
  description: string;
  date: ISODate;
  /** null → all-day event. */
  startTime: ISOTime | null;
  durationMin: number;
  categories: string[];
  location?: string | null;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
}

function eventLines(e: IcsEvent): string[] {
  const timing = e.startTime
    ? (() => {
        const end = localEnd(e.date, e.startTime, e.durationMin);
        return [
          `DTSTART;TZID=${ICS_TZID}:${formatLocalDateTime(e.date, e.startTime)}`,
          `DTEND;TZID=${ICS_TZID}:${formatLocalDateTime(end.date, end.time)}`,
        ];
      })()
    : [`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(e.date, 1))}`];
  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${formatUtcStamp(e.stamp)}`,
    ...timing,
    `SUMMARY:${escapeText(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    ...(e.categories.length ? [`CATEGORIES:${e.categories.map(escapeText).join(',')}`] : []),
    `STATUS:${e.status ?? 'CONFIRMED'}`,
    e.startTime ? 'TRANSP:OPAQUE' : 'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

export function buildCalendar(events: readonly IcsEvent[], name: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Road to Ironman//Plan de entrenamiento//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-CALDESC:${escapeText('Tus entrenos y quedadas planificados en Road to Ironman')}`,
    `X-WR-TIMEZONE:${ICS_TZID}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE_MADRID,
    ...events.flatMap(eventLines),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
