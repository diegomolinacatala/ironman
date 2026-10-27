/**
 * Defensive parsers for Garmin Personal API payloads. Shapes are undocumented
 * and mirror Garmin Connect web, so every field is looked up on several
 * candidate paths and anything missing is simply skipped.
 */
import { DEFAULT_TZ, localParts, normalizeTime, zonedToUtc } from '../dates.ts';
import type { ISODate, ISODateTime, Sport } from '../types.ts';
import { garminSport } from './sports.ts';

export interface DayMetricsPart {
  date: ISODate;
  hrvMs?: number;
  restingHr?: number;
  sleepHours?: number;
  sleepScore?: number;
  bodyBattery?: number;
  steps?: number;
  stressAvg?: number;
  /** Sleep stages (minutes) and start/end instants of the night that ENDS on `date`. */
  sleepDeepMin?: number;
  sleepLightMin?: number;
  sleepRemMin?: number;
  sleepAwakeMin?: number;
  sleepStart?: ISODateTime;
  sleepEnd?: ISODateTime;
}

export interface GarminActivity {
  id: string;
  name: string | null;
  typeKey: string;
  sport: Sport;
  date: ISODate;
  startTime: string | null;
  durationMin: number;
  distanceM: number | null;
  avgHr: number | null;
  tss: number | null;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (isObj(acc) ? acc[key] : undefined), obj);
}

export function pickNumber(obj: unknown, paths: readonly string[]): number | null {
  for (const p of paths) {
    const n = toNumber(at(obj, p));
    if (n !== null) return n;
  }
  return null;
}

/** Finds the list of records in a payload: the payload itself, a known key, or the first array value. */
export function asRecords(payload: unknown, keys: readonly string[]): Obj[] {
  if (Array.isArray(payload)) return payload.filter(isObj);
  if (!isObj(payload)) return [];
  for (const k of keys) {
    const v = payload[k];
    if (Array.isArray(v)) return v.filter(isObj);
  }
  const firstArray = Object.values(payload).find((v) => Array.isArray(v) && v.some(isObj));
  return Array.isArray(firstArray) ? firstArray.filter(isObj) : [];
}

function dateOf(row: Obj, paths: readonly string[]): ISODate | null {
  for (const p of paths) {
    const v = at(row, p);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

function inRange(n: number | null, min: number, max: number): number | undefined {
  return n !== null && n >= min && n <= max ? Math.round(n * 10) / 10 : undefined;
}

function compact(part: DayMetricsPart): DayMetricsPart[] {
  const clean = Object.fromEntries(Object.entries(part).filter(([, v]) => v !== undefined)) as unknown as DayMetricsPart;
  return Object.keys(clean).length > 1 ? [clean] : [];
}

const DATE_PATHS = ['calendarDate', 'date', 'summaryDate', 'dailySleepDTO.calendarDate', 'hrvSummary.calendarDate', 'startDate'];

export function parseDailySummaries(payload: unknown): DayMetricsPart[] {
  return asRecords(payload, ['data', 'dailySummaries', 'summaries']).flatMap((row) => {
    const date = dateOf(row, DATE_PATHS);
    if (!date) return [];
    const sleepSec = pickNumber(row, ['sleepingSeconds', 'sleep.sleepSeconds', 'sleep.sleepingSeconds', 'sleepTimeSeconds']);
    return compact({
      date,
      steps: inRange(pickNumber(row, ['totalSteps', 'movement.steps', 'steps.total', 'steps']), 0, 150000),
      restingHr: inRange(pickNumber(row, ['restingHeartRate', 'heartRate.restingValue', 'heartRate.resting', 'heartRate.restingHeartRate', 'restingHr']), 25, 120),
      stressAvg: inRange(pickNumber(row, ['averageStressLevel', 'avgStressLevel', 'stress.averageStressLevel', 'stress.avgStressLevel', 'stress.average', 'stress.averageLevel']), 0, 100),
      bodyBattery: inRange(pickNumber(row, ['bodyBatteryHighestValue', 'bodyBattery.highestValue', 'bodyBattery.highest', 'bodyBattery.max', 'bodyBatteryAtWakeTime', 'bodyBattery.atWake']), 0, 100),
      sleepHours: inRange(sleepSec === null ? null : sleepSec / 3600, 0, 16),
    });
  });
}

/** Seconds → whole minutes in 0..1440 (one night), else undefined. */
function stageMinutes(obj: unknown, paths: readonly string[]): number | undefined {
  const seconds = pickNumber(obj, paths);
  if (seconds === null || seconds < 0) return undefined;
  const minutes = Math.round(seconds / 60);
  return minutes <= 1440 ? minutes : undefined;
}

const MIN_EPOCH_MS = Date.UTC(2000, 0, 1);
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1);

/** Epoch ms (number or numeric string) or an ISO-like string without zone (read as UTC). */
function utcMillis(v: unknown): number | null {
  const n = toNumber(v);
  if (n !== null) return n >= MIN_EPOCH_MS && n < MAX_EPOCH_MS ? n : null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return null;
  const iso = /Z|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= MIN_EPOCH_MS && ms < MAX_EPOCH_MS ? ms : null;
}

/** GMT timestamp first; otherwise the "local" one (wall clock encoded as UTC) converted with the user's zone. */
function instantOf(dto: unknown, gmtPaths: readonly string[], localPaths: readonly string[], tz: string): number | null {
  for (const p of gmtPaths) {
    const ms = utcMillis(at(dto, p));
    if (ms !== null) return ms;
  }
  for (const p of localPaths) {
    const ms = utcMillis(at(dto, p));
    if (ms === null) continue;
    const wall = new Date(ms).toISOString();
    return Date.parse(zonedToUtc(wall.slice(0, 10), wall.slice(11, 16), tz));
  }
  return null;
}

const MAX_NIGHT_MS = 20 * 3_600_000;

/** Start/end of the night; both dropped unless 0 < end − start ≤ 20 h. */
function sleepWindow(dto: unknown, tz: string): Pick<DayMetricsPart, 'sleepStart' | 'sleepEnd'> {
  const start = instantOf(dto, ['sleepStartTimestampGMT', 'sleepStartTimestamp', 'startTimeGMT'], ['sleepStartTimestampLocal', 'startTimeLocal'], tz);
  const end = instantOf(dto, ['sleepEndTimestampGMT', 'sleepEndTimestamp', 'endTimeGMT'], ['sleepEndTimestampLocal', 'endTimeLocal'], tz);
  if (start === null || end === null || end <= start || end - start > MAX_NIGHT_MS) return {};
  return { sleepStart: new Date(start).toISOString(), sleepEnd: new Date(end).toISOString() };
}

/**
 * Daily sleep: duration, score, stages, start/end (dailySleepDTO), plus the resting HR and
 * overnight HRV some payloads carry. `tz` converts "local" timestamps when no GMT one exists.
 */
export function parseSleepSummaries(payload: unknown, tz: string = DEFAULT_TZ): DayMetricsPart[] {
  const rows = isObj(payload) && isObj(payload.dailySleepDTO) ? [payload] : asRecords(payload, ['dailySleepSummaries', 'sleepSummaries', 'dailySleepDTOList', 'data', 'summaries']);
  return rows.flatMap((row) => {
    const dto = isObj(row.dailySleepDTO) ? row.dailySleepDTO : row;
    const date = dateOf(dto, ['calendarDate', 'date', 'sleepDate']) ?? dateOf(row, DATE_PATHS);
    if (!date) return [];
    const seconds = pickNumber(dto, ['sleepTimeSeconds', 'sleepDurationSeconds', 'totalSleepSeconds', 'sleepSeconds']);
    return compact({
      date,
      sleepHours: inRange(seconds === null ? null : seconds / 3600, 0, 16),
      sleepScore: inRange(pickNumber(dto, ['sleepScores.overall.value', 'overallSleepScore.value', 'sleepScore.value', 'overallSleepScore', 'sleepScore']), 0, 100),
      restingHr: inRange(pickNumber(row, ['restingHeartRate', 'dailySleepDTO.restingHeartRate']), 25, 120),
      hrvMs: inRange(pickNumber(row, ['avgOvernightHrv', 'dailySleepDTO.avgOvernightHrv']), 1, 300),
      sleepDeepMin: stageMinutes(dto, ['deepSleepSeconds', 'deepSleepDurationSeconds', 'sleepLevels.deepSeconds']),
      sleepLightMin: stageMinutes(dto, ['lightSleepSeconds', 'lightSleepDurationSeconds', 'sleepLevels.lightSeconds']),
      sleepRemMin: stageMinutes(dto, ['remSleepSeconds', 'remSleepDurationSeconds', 'sleepLevels.remSeconds']),
      sleepAwakeMin: stageMinutes(dto, ['awakeSleepSeconds', 'awakeDurationSeconds', 'awakeSeconds', 'sleepLevels.awakeSeconds']),
      ...sleepWindow(dto, tz),
    });
  });
}

export function parseHrv(payload: unknown): DayMetricsPart[] {
  const rows = isObj(payload) && isObj(payload.hrvSummary) ? [payload.hrvSummary] : asRecords(payload, ['hrvSummaries', 'summaries', 'data']);
  return rows.flatMap((row) => {
    const date = dateOf(row, DATE_PATHS);
    if (!date) return [];
    return compact({ date, hrvMs: inRange(pickNumber(row, ['lastNightAvg', 'lastNightAverage', 'nightlyAvg', 'lastNight']), 1, 300) });
  });
}

/** Highest Body Battery level of the day (≈ value at wake-up). */
export function parseBodyBattery(payload: unknown): DayMetricsPart[] {
  return asRecords(payload, ['bodyBatteryReports', 'data', 'reports']).flatMap((row) => {
    const date = dateOf(row, ['date', 'calendarDate', 'startTimestampLocal', 'startTimestampGMT']);
    if (!date) return [];
    const values = Array.isArray(row.bodyBatteryValuesArray)
      ? row.bodyBatteryValuesArray.flatMap((entry) =>
          Array.isArray(entry) ? entry.slice(1).map(toNumber).filter((n): n is number => n !== null && n >= 0 && n <= 100) : [],
        )
      : [];
    const direct = pickNumber(row, ['bodyBatteryHighestValue', 'highestBodyBattery', 'highest', 'max', 'bodyBatteryAtWakeTime']);
    const best = values.length ? Math.max(...values) : direct;
    return compact({ date, bodyBattery: inRange(best, 0, 100) });
  });
}

/** Merges partial day records; earlier parts win per field (pass the most reliable source first). */
export function mergeDayParts(parts: readonly DayMetricsPart[], from: ISODate, to: ISODate): DayMetricsPart[] {
  const byDate = new Map<ISODate, DayMetricsPart>();
  for (const part of parts) {
    if (part.date < from || part.date > to) continue;
    const prev = byDate.get(part.date) ?? { date: part.date };
    byDate.set(part.date, { ...part, ...prev });
  }
  return [...byDate.values()].filter((p) => Object.keys(p).length > 1).sort((a, b) => a.date.localeCompare(b.date));
}

function activityStart(row: Obj, tz: string): { date: ISODate; time: string | null } | null {
  const local = at(row, 'startTimeLocal');
  if (typeof local === 'string' && /^\d{4}-\d{2}-\d{2}/.test(local)) {
    return { date: local.slice(0, 10), time: normalizeTime(local.slice(11, 19)) };
  }
  const gmt = at(row, 'startTimeGMT') ?? at(row, 'beginTimestamp');
  const instant =
    typeof gmt === 'string' ? new Date(/Z|[+-]\d{2}:?\d{2}$/.test(gmt) ? gmt : `${gmt.replace(' ', 'T')}Z`) : typeof gmt === 'number' ? new Date(gmt) : null;
  if (!instant || Number.isNaN(instant.getTime())) return null;
  const parts = localParts(instant, tz);
  return { date: parts.date, time: parts.time };
}

export function parseActivities(payload: unknown, tz: string): GarminActivity[] {
  return asRecords(payload, ['activityList', 'activities', 'data']).flatMap((row): GarminActivity[] => {
    const idRaw = at(row, 'activityId');
    const id = typeof idRaw === 'number' ? String(Math.trunc(idRaw)) : typeof idRaw === 'string' ? idRaw.trim() : '';
    if (!/^\d{1,30}$/.test(id)) return [];
    const typeRaw = at(row, 'activityType.typeKey') ?? at(row, 'activityTypeDTO.typeKey') ?? at(row, 'activityType');
    const typeKey = typeof typeRaw === 'string' ? typeRaw.toLowerCase() : 'other';
    const sport = garminSport(typeKey);
    const start = activityStart(row, tz);
    const seconds = pickNumber(row, ['duration', 'movingDuration', 'elapsedDuration']);
    if (!sport || !start || seconds === null || seconds < 60) return [];
    const name = at(row, 'activityName');
    return [
      {
        id,
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null,
        typeKey,
        sport,
        date: start.date,
        startTime: start.time,
        durationMin: Math.min(720, Math.round(seconds / 60)),
        distanceM: (() => {
          const d = pickNumber(row, ['distance']);
          return d !== null && d > 0 ? Math.round(d) : null;
        })(),
        avgHr: (() => {
          const hr = pickNumber(row, ['averageHR', 'avgHr', 'averageHeartRate']);
          return hr !== null && hr >= 30 && hr <= 230 ? Math.round(hr) : null;
        })(),
        tss: (() => {
          const t = pickNumber(row, ['trainingStressScore']);
          return t !== null && t >= 0 && t <= 1000 ? Math.round(t * 10) / 10 : null;
        })(),
      },
    ];
  });
}
