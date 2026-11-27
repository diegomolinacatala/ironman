/**
 * Parsers for the prose reports of the COROS MCP tools. Each pattern was checked against
 * real answers (Nov 2026); the fixtures in coros.test.ts copy their layout with made-up
 * numbers. If COROS changes a report, this is the only file to touch.
 *
 * Dates: the tools take yyyyMMdd (ISO dates make some tools misbehave) and every wellness
 * record is dated by its wake-up day, which is the app's convention too.
 */
import { localParts, zonedToUtc } from '../dates.ts';
import type { MetricsUpsert } from '../planning/store.ts';
import type { ISODate, Sport } from '../types.ts';

export interface CorosActivity {
  /** COROS labelId (stored as external_id 'coros:<labelId>'). */
  id: string;
  sportType: string;
  date: ISODate;
  startTime: string | null;
  sport: Sport;
  name: string | null;
  /** Moving ("Workout") time, like the watch shows; Apple Salud gets the elapsed time instead. */
  durationMin: number;
  distanceM: number | null;
  avgHr: number | null;
  tss: number | null;
}

export interface CorosActivityDetail {
  trainingLoad: number | null;
  totalTimeSec: number | null;
  trainingFocus: string | null;
}

export type DayPart = Omit<MetricsUpsert, 'raw'>;

const MIN_ACTIVITY_MINUTES = 1;

export function yyyymmdd(date: ISODate): string {
  return date.replace(/-/g, '');
}

/** '1h 35min' | '52 min' | '0 min' → minutes; null when nothing matches. */
export function durationToMin(text: string | null | undefined): number | null {
  if (!text) return null;
  const h = /(\d+)\s*h/.exec(text);
  const m = /(\d+)\s*min/.exec(text);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/** '33:00' | '1:23:36' → seconds. */
export function hmsToSec(text: string | null | undefined): number | null {
  if (!text) return null;
  const parts = text.trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function num(re: RegExp, text: string): number | null {
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Sport from the COROS sport name ("Outdoor Run", "Pool Swim", "Road Bike"…), with the
 * numeric SportType family as fallback (1xx run, 2xx bike, 3xx swim). Walks and hikes are
 * not training sessions of the plan: null (skipped), as with Garmin.
 */
export function corosSport(name: string, sportType: string): Sport | null {
  const n = name.toLowerCase();
  if (/walk|hik|paseo|caminar/.test(n)) return null;
  if (/triathlon|multisport|transition/.test(n)) return 'brick';
  if (/swim|open water|nataci/.test(n)) return 'swim';
  if (/bike|cycl|ride|ciclismo|spin/.test(n)) return 'bike';
  if (/run|carrera|treadmill/.test(n)) return 'run';
  if (/strength|weight|fuerza|gym/.test(n)) return 'strength';
  if (/yoga|pilates|stretch|mobility|movilidad/.test(n)) return 'mobility';
  const family = Math.floor(Number(sportType) / 100);
  if (family === 1) return 'run';
  if (family === 2) return 'bike';
  if (family === 3) return 'swim';
  return 'other';
}

/** `querySportRecords`: numbered blocks, one per activity. */
export function parseSportRecords(text: string, tz: string): CorosActivity[] {
  const out: CorosActivity[] = [];
  for (const block of text.split(/\n(?=\d+\.\s)/)) {
    const head = /^\s*\d+\.\s+(.+?)\s+\S\s+(\d{4}-\d{2}-\d{2})/.exec(block);
    const label = /LabelId:\s*(\d+)/.exec(block);
    if (!head || !label) continue;
    const sportType = /SportType:\s*(\d+)/.exec(block)?.[1] ?? '';
    const name = head[1].trim();
    const sport = corosSport(name, sportType);
    if (!sport) continue;
    const seconds = hmsToSec(/Duration:\s*([\d:]+)/.exec(block)?.[1]);
    if (seconds === null || seconds < MIN_ACTIVITY_MINUTES * 60) continue;
    const start = num(/startTimestamp=(\d+)/, block);
    const local = start !== null ? localParts(new Date(start * 1000), tz) : null;
    const dist = /Distance:\s*([\d.]+)\s*(km|m)\b/.exec(block);
    const location = /Location:\s*(.+)/.exec(block)?.[1]?.trim() ?? null;
    out.push({
      id: label[1],
      sportType,
      date: local?.date ?? head[2],
      startTime: local?.time ?? null,
      sport,
      name: location ?? name,
      durationMin: Math.max(1, Math.round(seconds / 60)),
      distanceM: dist ? Math.round(Number(dist[1]) * (dist[2] === 'km' ? 1000 : 1)) : null,
      avgHr: num(/Avg HR:\s*(\d+)\s*bpm/, block),
      tss: null,
    });
  }
  return out;
}

/** `getActivityDetail`: "Label: value" lines. */
export function parseActivityDetail(text: string): CorosActivityDetail {
  return {
    trainingLoad: num(/^Training Load:\s*([\d.]+)/m, text),
    totalTimeSec: hmsToSec(/^Total Time:\s*([\d:]+)/m.exec(text)?.[1]),
    trainingFocus: /^Training Focus:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null,
  };
}

function blocksByDay(text: string, header: RegExp): [ISODate, string][] {
  const matches = [...text.matchAll(header)];
  return matches.map((m, i) => [m[1], text.slice((m.index ?? 0) + m[0].length, matches[i + 1]?.index ?? text.length)]);
}

const DAY_LINE = /^(\d{4}-\d{2}-\d{2})\s*$/gm;
const DAY_COLON_LINE = /^(\d{4}-\d{2}-\d{2}):\s*$/gm;

/** `queryDailyHealthData`: steps, stress and the sleep stages per `--- yyyyMMdd ---` block. */
export function parseDailyHealth(text: string): DayPart[] {
  const parts = text.split(/--- (\d{8}) ---/).slice(1);
  const out: DayPart[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const raw = parts[i];
    const body = parts[i + 1];
    const day: DayPart = { date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` };
    const steps = num(/Steps:\s*([\d,]+)/, body);
    if (steps !== null && steps > 0) day.steps = steps;
    const stress = num(/Stress:\s*Avg\s*(\d+)/, body);
    if (stress !== null) day.stressAvg = stress;
    const deep = durationToMin(/Deep:\s*(.+?)\s*\|/.exec(body)?.[1]);
    const light = durationToMin(/Light:\s*(.+?)\s*\|/.exec(body)?.[1]);
    const rem = durationToMin(/REM:\s*(.+?)\s*\|/.exec(body)?.[1]);
    const awake = durationToMin(/\|\s*Awake:\s*([^\n]+)/.exec(body)?.[1]);
    // A night shorter than 3 h asleep is a watch taken off, not a night: keep the stages out.
    if (deep !== null && light !== null && rem !== null && deep + light + rem >= 180) {
      day.sleepDeepMin = deep;
      day.sleepLightMin = light;
      day.sleepRemMin = rem;
      if (awake !== null) day.sleepAwakeMin = awake;
    }
    if (Object.keys(day).length > 1) out.push(day);
  }
  return out;
}

/** `querySleepOverview`: score, time asleep and the main sleep window. */
export function parseSleepOverview(text: string, tz: string): DayPart[] {
  const out: DayPart[] = [];
  for (const [date, block] of blocksByDay(text, DAY_LINE)) {
    if (/not available/i.test(block)) continue;
    const day: DayPart = { date };
    const asleep = durationToMin(/Main Sleep \(asleep\):\s*([^\n]+)/.exec(block)?.[1]);
    if (asleep !== null && asleep >= 180) {
      day.sleepHours = Math.round((asleep / 60) * 100) / 100;
      const score = num(/Sleep Score:\s*(\d+)/, block);
      if (score !== null) day.sleepScore = score;
      const window = /Main Sleep Window:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/.exec(block);
      if (window) {
        day.sleepStart = zonedToUtc(window[1], window[2], tz);
        day.sleepEnd = zonedToUtc(window[3], window[4], tz);
      }
    }
    if (Object.keys(day).length > 1) out.push(day);
  }
  return out;
}

/** `querySleepHrv`: the "HRV Avg: 72 ms — …" line of each assessment day (the time series is ignored). */
export function parseSleepHrv(text: string): DayPart[] {
  const assessment = text.split(/Time Series/i)[0];
  const out: DayPart[] = [];
  for (const [date, block] of blocksByDay(assessment, DAY_COLON_LINE)) {
    const hrv = num(/HRV Avg:\s*(\d+)\s*ms/, block);
    if (hrv !== null && hrv > 0) out.push({ date, hrvMs: hrv });
  }
  return out;
}

/** `queryRestingHeartRate`: "2026-11-26: 49 bpm". */
export function parseRestingHr(text: string): DayPart[] {
  return [...text.matchAll(/(\d{4}-\d{2}-\d{2}):\s*(\d+)\s*bpm(?!\s*\()/g)]
    .map((m) => ({ date: m[1], restingHr: Number(m[2]) }))
    .filter((d) => d.restingHr > 0);
}

/** `queryTrainingLoadAssessment`: the COROS comment ("Optimized", "Excessive"…) as training status. */
export function parseTrainingLoad(text: string): DayPart[] {
  const out: DayPart[] = [];
  for (const [date, block] of blocksByDay(text, DAY_LINE)) {
    const comment = /Comment:\s*([^\n]+)/.exec(block)?.[1]?.trim();
    if (comment) out.push({ date, trainingStatus: comment.slice(0, 60) });
  }
  return out;
}

/** `queryRecoveryStatus` (a snapshot, today): "Recovery: 76%". */
export function parseRecovery(text: string): number | null {
  const pct = num(/Recovery:\s*(\d+)%/, text);
  return pct !== null && pct >= 0 && pct <= 100 ? pct : null;
}

/** `queryFitnessAssessmentOverview` (a snapshot, today): "VO2max: 60". */
export function parseVo2max(text: string): number | null {
  const v = num(/VO2max:\s*(\d+(?:\.\d+)?)/, text);
  return v !== null && v >= 10 && v <= 100 ? v : null;
}

/** One row per day inside [from, to]; later parts win field by field. */
export function mergeDays(parts: readonly DayPart[], from: ISODate, to: ISODate): DayPart[] {
  const byDate = new Map<ISODate, DayPart>();
  for (const p of parts) {
    if (p.date < from || p.date > to) continue;
    byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date }), ...p });
  }
  return [...byDate.values()].filter((d) => Object.keys(d).length > 1).sort((a, b) => a.date.localeCompare(b.date));
}
