/**
 * iCalendar feeds (TrainingPeaks › Settings › Account › Calendar, any .ics):
 * VEVENTs → imported sessions. TrainingPeaks puts the workout type and title
 * in SUMMARY and the coach's description (planned time, distance, structure
 * as text) in DESCRIPTION; all-day events have no start time. Its feed only
 * covers a rolling window (about 5 days back and 14 ahead) and is a Premium
 * feature; past events are skipped later, when the plan becomes workouts.
 */
import { diffDays, isISODate, toISODate } from './dates';
import { buildPlan } from './planImport';
import type { ImportedPlan, PlanImportSource } from './planImport';
import { parseDistance, parseDuration, parseIntensity, parseSport, parseSteps } from './planImportText';

export interface IcalEvent {
  uid: string | null;
  summary: string;
  description: string;
  categories: string;
  date: string;
  startTime: string | null;
  /** Minutes between start and end (timed events), or from DURATION. */
  minutes: number | null;
}

/** RFC 5545 line unfolding (CRLF + space/tab continues the previous line). */
function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseProp(line: string): Prop | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon <= 0) return null;
  const [name = '', ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const [k, v = ''] = p.split('=');
    if (k) params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** DTSTART/DTEND value → local date (+ minutes since midnight when timed). UTC ("Z") is converted to the device's zone. */
export function parseIcalDate(prop: Prop): { date: string; minutes: number | null } | null {
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || prop.params.VALUE === 'DATE') {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    return isISODate(date) ? { date, minutes: null } : null;
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!dt) return null;
  if (dt[7]) {
    const d = new Date(Date.UTC(Number(dt[1]), Number(dt[2]) - 1, Number(dt[3]), Number(dt[4]), Number(dt[5])));
    return { date: toISODate(d), minutes: d.getHours() * 60 + d.getMinutes() };
  }
  // Floating or TZID times: the coach's calendar zone is almost always the athlete's.
  const date = `${dt[1]}-${dt[2]}-${dt[3]}`;
  return isISODate(date) ? { date, minutes: Number(dt[4]) * 60 + Number(dt[5]) } : null;
}

/** "PT1H30M", "PT45M", "P1D" → minutes. */
export function parseIcalDuration(value: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const total = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : null;
}

export function parseIcalEvents(text: string): IcalEvent[] {
  const events: IcalEvent[] = [];
  let props: Prop[] | null = null;
  for (const line of unfold(text)) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      props = [];
      continue;
    }
    if (upper === 'END:VEVENT') {
      if (props) {
        const event = toEvent(props);
        if (event) events.push(event);
      }
      props = null;
      continue;
    }
    if (props) {
      const prop = parseProp(line);
      if (prop) props.push(prop);
    }
  }
  return events;
}

function toEvent(props: readonly Prop[]): IcalEvent | null {
  const get = (name: string) => props.find((p) => p.name === name) ?? null;
  const startProp = get('DTSTART');
  const start = startProp ? parseIcalDate(startProp) : null;
  if (!start) return null;
  const endProp = get('DTEND');
  const end = endProp ? parseIcalDate(endProp) : null;
  let minutes: number | null = null;
  if (start.minutes !== null && end?.minutes != null) {
    minutes = diffDays(end.date, start.date) * 1440 + end.minutes - start.minutes;
  } else if (get('DURATION')) {
    minutes = parseIcalDuration(get('DURATION')?.value ?? '');
  }
  if (minutes !== null && (minutes <= 0 || minutes > 720)) minutes = null;
  const hhmm = start.minutes !== null ? `${String(Math.floor(start.minutes / 60)).padStart(2, '0')}:${String(start.minutes % 60).padStart(2, '0')}` : null;
  return {
    uid: get('UID')?.value ?? null,
    summary: unescapeText(get('SUMMARY')?.value ?? ''),
    description: unescapeText(get('DESCRIPTION')?.value ?? ''),
    categories: unescapeText(get('CATEGORIES')?.value ?? ''),
    date: start.date,
    // Midnight starts are all-day events written as date-times.
    startTime: hhmm && hhmm !== '00:00' ? hhmm : null,
    minutes: hhmm === '00:00' && minutes === 1440 ? null : minutes,
  };
}

/** Feed text → plan (events without a sport and without a duration — notes, metrics, day off — are left out). */
export function icalToPlan(text: string, source: PlanImportSource = 'trainingpeaks'): ImportedPlan {
  const events = parseIcalEvents(text);
  const sessions: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const e of events) {
    const all = `${e.summary}\n${e.description}`;
    const sport = parseSport(e.categories) ?? parseSport(e.summary) ?? parseSport(e.description);
    const durationMin = parseDuration(e.description) ?? parseDuration(e.summary) ?? e.minutes;
    if (sport === 'rest' || (!sport && durationMin === null)) {
      skipped += 1;
      continue;
    }
    const intensity = parseIntensity(all);
    sessions.push({
      sourceDate: e.date,
      startTime: e.startTime,
      sport: sport ?? 'other',
      title: e.summary.replace(/^\s*(swim|bike|run|brick|strength|other|natación|bici|carrera)\s*[:\-–]\s*/i, '') || undefined,
      durationMin,
      distanceM: parseDistance(e.description) ?? parseDistance(e.summary),
      intensity: intensity ?? 'endurance',
      steps: parseSteps(e.description),
      description: e.description || null,
      confidence: !sport ? 'low' : intensity ? 'high' : 'medium',
    });
  }
  const dates = sessions.map((s) => String(s.sourceDate)).sort();
  const warnings = [
    ...(events.length === 0 ? ['El calendario no tiene eventos. Comprueba el enlace o que tu plan tenga sesiones en las próximas dos semanas.'] : []),
    ...(skipped > 0 ? [`${skipped} evento${skipped === 1 ? '' : 's'} sin deporte ni duración (notas, días libres) no se ha${skipped === 1 ? '' : 'n'} importado.`] : []),
  ];
  return buildPlan({ source, sessions, sourceStart: dates[0] ?? null, warnings, engine: 'rules' });
}

const FEED_URL_RE = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(:\d+)?(\/[^\s]*)?$/i;

/** webcal:// → https://; only http(s) feeds are accepted (regex: React Native's URL lacks `hostname`). */
export function normalizeFeedUrl(raw: string): string | null {
  const v = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  return FEED_URL_RE.test(v) ? v : null;
}

export function isTrainingPeaksUrl(url: string): boolean {
  const host = FEED_URL_RE.exec(url)?.[1] ?? '';
  return /(^|\.)trainingpeaks\.com$/i.test(host);
}
