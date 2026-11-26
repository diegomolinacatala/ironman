// GENERATED MIRROR of src/domain/weather.ts — do not edit here.
// Edit the app file and run `node scripts/sync-domain-mirror.mjs` (checked by mirror.test.ts).
/**
 * Weather for outdoor training (pure; mirrored to the edge functions by
 * `scripts/sync-domain-mirror.mjs`, so the app, the briefing and the coach
 * read the forecast the same way).
 *
 * The forecast is the hourly series of the athlete's city (MET Norway
 * Locationforecast 2.0 through the `weather` edge function). Its first ~60
 * hours come hour by hour; days 3–9 come in 6-hour blocks, spread here over
 * their hours (`coarse`: an average, so a dry gap there is a whole dry block).
 * MET gives no chance of rain outside the Nordic area: `precipProb` is then
 * null and the rules lean on the amount and the symbol.
 *
 * - Clearly dry hour: chance < 30 %, < 0.1 mm and no rain symbol.
 * - Rainy hour: chance ≥ 60 % (or unknown) and ≥ 0.5 mm (≥ 0.3 mm/h over a 6-hour block).
 * - A session falls in the rain when at least half of its window (its own
 *   time, or the whole day 07:00–22:00 when it has none) is rainy.
 * - A dry gap holds the session plus 30' of margin inside the minutes the
 *   caller allows (training hours minus busy time).
 * Only run, bike and brick are outdoor sessions; a bike titled rodillo,
 * trainer, MyWhoosh… (or a run on the cinta) is already indoors.
 */
import type { ISODate, Sport } from './types.ts';

export type WeatherSource = 'met_norway' | 'demo';

export interface WeatherHour {
  /** Local date and hour (0–23) where the hour starts. */
  date: ISODate;
  hour: number;
  tempC: number | null;
  windKmh: number | null;
  /** Expected precipitation in this hour, mm. */
  precipMm: number;
  /** Chance of precipitation, %; null when the provider does not give it. */
  precipProb: number | null;
  /** MET symbol code ('rain', 'lightrainshowers_day', 'clearsky_day'…), null when unknown. */
  symbol: string | null;
  /** Spread from a 6-hour block: an average over the block. */
  coarse: boolean;
}

export interface WeatherForecast {
  /** The city the athlete picked ("Valencia"). */
  place: string;
  source: WeatherSource;
  /** When the provider issued it (ISO instant). */
  updatedAt: string;
  hours: WeatherHour[];
}

/** Minutes since local midnight, half-open [start, end). */
export interface MinuteRange {
  start: number;
  end: number;
}

export const WEATHER_RULES = {
  dryMaxProb: 30,
  dryMaxMm: 0.1,
  rainMinProb: 60,
  rainMinMm: 0.5,
  /** ~2 mm in a 6-hour block. */
  rainMinMmCoarse: 0.3,
  /** Share of the session's window in rain that makes it a rainy session. */
  rainyShare: 0.5,
  /** Dry time a gap needs on top of the session (the forecast is never exact). */
  gapMarginMin: 30,
  /** The reasonable training day when the caller gives no ranges (same as the planner). */
  dayStartMin: 7 * 60,
  dayEndMin: 22 * 60,
} as const;

const HOUR = 60;
const QUARTER = 15;
const WET_SYMBOL = /rain|sleet|snow|thunder|drizzle|shower/i;
const INDOOR_TITLE = /rodillo|trainer|mywhoosh|zwift|indoor|est[aá]tica|spinning|\bcinta\b|treadmill/i;
const OUTDOOR_SPORTS: readonly Sport[] = ['run', 'bike', 'brick'];

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

export function isWetSymbol(symbol: string | null | undefined): boolean {
  return typeof symbol === 'string' && WET_SYMBOL.test(symbol);
}

export type HourState = 'dry' | 'wet' | 'rain';

/** 'dry' = clearly dry, 'rain' = meaningful rain, 'wet' = in between (drizzle, doubtful). */
export function hourState(h: WeatherHour): HourState {
  const rainMm = h.coarse ? WEATHER_RULES.rainMinMmCoarse : WEATHER_RULES.rainMinMm;
  const prob = h.precipProb;
  if (h.precipMm >= rainMm && (prob === null || prob >= WEATHER_RULES.rainMinProb)) return 'rain';
  const dryAmount = h.precipMm < WEATHER_RULES.dryMaxMm && (prob === null || prob < WEATHER_RULES.dryMaxProb);
  return dryAmount && !isWetSymbol(h.symbol) ? 'dry' : 'wet';
}

/** The hours of `date`, in order (one per hour; the first wins on a DST repeat). */
export function hoursOn(hours: readonly WeatherHour[], date: ISODate): WeatherHour[] {
  const byHour = new Map<number, WeatherHour>();
  for (const h of hours) if (h.date === date && !byHour.has(h.hour)) byHour.set(h.hour, h);
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

/** Days the forecast covers, in order. */
export function forecastDays(hours: readonly WeatherHour[]): ISODate[] {
  return [...new Set(hours.map((h) => h.date))].sort();
}

// ---------------------------------------------------------------------------
// Minute ranges
// ---------------------------------------------------------------------------

function merge(ranges: readonly MinuteRange[]): MinuteRange[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  return sorted.reduce<MinuteRange[]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r.start <= last.end) return [...acc.slice(0, -1), { start: last.start, end: Math.max(last.end, r.end) }];
    return [...acc, { start: r.start, end: r.end }];
  }, []);
}

function intersect(a: readonly MinuteRange[], b: readonly MinuteRange[]): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const x of merge(a)) {
    for (const y of merge(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return merge(out);
}

const DAYTIME: MinuteRange = { start: WEATHER_RULES.dayStartMin, end: WEATHER_RULES.dayEndMin };

/** Minutes of the clearly dry hours of `date`. */
export function dryRanges(hours: readonly WeatherHour[], date: ISODate): MinuteRange[] {
  return merge(hoursOn(hours, date).filter((h) => hourState(h) === 'dry').map((h) => ({ start: h.hour * HOUR, end: (h.hour + 1) * HOUR })));
}

export interface GapOptions {
  /** Minutes the athlete can train that day (training hours minus busy time); default 07:00–22:00. */
  allowed?: readonly MinuteRange[];
  minMinutes: number;
}

/** Dry stretches of `date` inside the allowed minutes, at least `minMinutes` long. */
export function dryGaps(hours: readonly WeatherHour[], date: ISODate, opts: GapOptions): MinuteRange[] {
  return intersect(dryRanges(hours, date), opts.allowed ?? [DAYTIME]).filter((r) => r.end - r.start >= opts.minMinutes);
}

export interface WindowRain {
  rainMinutes: number;
  /** Minutes of the window the forecast covers. */
  minutes: number;
  /** First rainy hour to the end of the last one, inside the window. */
  rain: MinuteRange | null;
}

/** How much of [start, end) on `date` is rainy; null when the forecast covers less than half of it. */
export function windowRain(hours: readonly WeatherHour[], date: ISODate, window: MinuteRange): WindowRain | null {
  const day = new Map(hoursOn(hours, date).map((h) => [h.hour, h]));
  let rainMinutes = 0;
  let covered = 0;
  let first: number | null = null;
  let last = 0;
  for (let hour = Math.floor(window.start / HOUR); hour * HOUR < window.end; hour += 1) {
    const h = day.get(hour);
    const overlap = Math.min(window.end, (hour + 1) * HOUR) - Math.max(window.start, hour * HOUR);
    if (!h || overlap <= 0) continue;
    covered += overlap;
    if (hourState(h) !== 'rain') continue;
    rainMinutes += overlap;
    first = first ?? hour * HOUR;
    last = (hour + 1) * HOUR;
  }
  if (covered === 0 || covered * 2 < window.end - window.start) return null;
  return { rainMinutes, minutes: covered, rain: first === null ? null : { start: first, end: last } };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** What the weather rules need of a workout (a `Workout` fits). */
export interface WeatherSession {
  date: ISODate;
  startTime: string | null;
  durationMin: number;
  sport: Sport;
  title: string;
}

/** Run, bike or brick done outside (not on the trainer, MyWhoosh… or the treadmill). */
export function isOutdoorSession(s: Pick<WeatherSession, 'sport' | 'title'>): boolean {
  return OUTDOOR_SPORTS.includes(s.sport) && !INDOOR_TITLE.test(s.title);
}

export function timeToMin(time: string | null | undefined): number | null {
  const m = typeof time === 'string' ? /^(\d{1,2}):(\d{2})/.exec(time) : null;
  if (!m) return null;
  const minutes = Number(m[1]) * HOUR + Number(m[2]);
  return minutes >= 0 && minutes < 24 * HOUR ? minutes : null;
}

export function minToTime(minutes: number): string {
  const safe = Math.max(0, Math.min(24 * HOUR - 1, Math.round(minutes)));
  return `${String(Math.floor(safe / HOUR)).padStart(2, '0')}:${String(safe % HOUR).padStart(2, '0')}`;
}

/** The minutes the session would be outside: its own time, or the whole day when it has none. */
export function sessionWindow(s: Pick<WeatherSession, 'startTime' | 'durationMin'>): MinuteRange {
  const start = timeToMin(s.startTime);
  if (start === null) return DAYTIME;
  return { start, end: Math.min(24 * HOUR, start + Math.max(1, Math.round(s.durationMin))) };
}

/** Minutes a dry gap needs for the session: its duration plus the margin. */
export function gapNeed(s: Pick<WeatherSession, 'durationMin'>): number {
  return Math.round(s.durationMin) + WEATHER_RULES.gapMarginMin;
}

/**
 * Start minute of the session in `gap`, as close as possible to its own time:
 * its own time when the session fits there; when the gap ends before it, the
 * latest start that keeps the margin before the rain; else the start of the
 * gap. Rounded to the quarter hour while it still fits.
 */
export function startInGap(gap: MinuteRange, s: Pick<WeatherSession, 'startTime' | 'durationMin'>): number {
  const own = timeToMin(s.startTime);
  const duration = Math.round(s.durationMin);
  if (own !== null && own >= gap.start && own + duration <= gap.end) return own;
  const latest = Math.max(gap.start, gap.end - duration - WEATHER_RULES.gapMarginMin);
  if (own !== null && own > latest) return Math.max(gap.start, Math.floor(latest / QUARTER) * QUARTER);
  const rounded = Math.ceil(gap.start / QUARTER) * QUARTER;
  return rounded <= latest ? rounded : gap.start;
}

/** The gap to suggest: the closest to the session's own time, or the longest one for an untimed session. */
export function bestGap(gaps: readonly MinuteRange[], s: Pick<WeatherSession, 'startTime' | 'durationMin'>): MinuteRange | null {
  const own = timeToMin(s.startTime);
  const score = (g: MinuteRange): number => (own === null ? -(g.end - g.start) : Math.abs(startInGap(g, s) - own));
  return gaps.reduce<MinuteRange | null>((best, g) => (best === null || score(g) < score(best) ? g : best), null);
}

export type SessionWeather =
  | { kind: 'indoor' }
  | { kind: 'unknown' }
  | { kind: 'dry'; tempC: number | null }
  | { kind: 'some_rain'; rain: MinuteRange; tempC: number | null }
  | { kind: 'rain'; rain: MinuteRange; gap: MinuteRange | null; tempC: number | null };

export interface SessionWeatherOptions {
  /** Minutes the athlete can train that day (default 07:00–22:00). */
  allowed?: readonly MinuteRange[];
  /** Minutes already gone today: an untimed session and the gaps start after them. */
  afterMin?: number;
}

/** At the session's start hour; over the window (warmest hour) for an untimed session. */
function windowTemp(hours: readonly WeatherHour[], date: ISODate, window: MinuteRange, timed: boolean): number | null {
  const inside = hoursOn(hours, date).filter((h) => (timed ? h.hour === Math.floor(window.start / HOUR) : h.hour * HOUR >= window.start && h.hour * HOUR < window.end));
  const temps = inside.map((h) => h.tempC).filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return temps.length === 0 ? null : Math.round(Math.max(...temps));
}

function untimedWindow(window: MinuteRange, afterMin: number | undefined): MinuteRange {
  if (afterMin === undefined) return window;
  return { start: Math.min(window.end - HOUR, Math.max(window.start, Math.floor(afterMin / HOUR) * HOUR)), end: window.end };
}

/** Whether the session falls in the rain and, if it does, the best dry gap of that day. */
export function sessionWeather(hours: readonly WeatherHour[], s: WeatherSession, opts: SessionWeatherOptions = {}): SessionWeather {
  if (!isOutdoorSession(s)) return { kind: 'indoor' };
  const timed = timeToMin(s.startTime) !== null;
  const window = timed ? sessionWindow(s) : untimedWindow(DAYTIME, opts.afterMin);
  const wet = windowRain(hours, s.date, window);
  if (!wet) return { kind: 'unknown' };
  const tempC = windowTemp(hours, s.date, window, timed);
  if (!wet.rain) return { kind: 'dry', tempC };
  if (wet.rainMinutes / wet.minutes < WEATHER_RULES.rainyShare) return { kind: 'some_rain', rain: wet.rain, tempC };
  const later = opts.afterMin === undefined ? null : [{ start: opts.afterMin, end: 24 * HOUR }];
  const allowed = later ? intersect(opts.allowed ?? [DAYTIME], later) : opts.allowed;
  const gaps = dryGaps(hours, s.date, { allowed, minMinutes: gapNeed(s) });
  return { kind: 'rain', rain: wet.rain, gap: bestGap(gaps, s), tempC };
}

export type RainyWeather = Extract<SessionWeather, { kind: 'rain' }>;

export interface RainySession<T> {
  session: T;
  weather: RainyWeather;
}

/** Planned outdoor sessions of `date` that fall in the rain (key sessions first, then by time), with their dry gap. */
export function rainySessionsOn<T extends WeatherSession & { status?: string; isKey?: boolean }>(
  hours: readonly WeatherHour[],
  sessions: readonly T[],
  date: ISODate,
  opts: SessionWeatherOptions = {},
): RainySession<T>[] {
  const byKey = (a: T, b: T): number => Number(b.isKey === true) - Number(a.isKey === true) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99');
  return sessions
    .filter((s) => s.date === date && (s.status === undefined || s.status === 'planned'))
    .sort(byKey)
    .map((session) => ({ session, weather: sessionWeather(hours, session, opts) }))
    .filter((x): x is RainySession<T> => x.weather.kind === 'rain');
}

function subtract(base: readonly MinuteRange[], holes: readonly MinuteRange[]): MinuteRange[] {
  return merge(base).flatMap((range) =>
    merge(holes).reduce<MinuteRange[]>(
      (pieces, hole) =>
        pieces.flatMap((p) =>
          hole.end <= p.start || hole.start >= p.end
            ? [p]
            : [
                { start: p.start, end: Math.max(p.start, hole.start) },
                { start: Math.min(p.end, hole.end), end: p.end },
              ].filter((x) => x.end > x.start),
        ),
      [range],
    ),
  );
}

/** 07:00–22:00 minus busy times given as local 'HH:mm' (what the server's planning context has). */
export function freeDaytime(busy: readonly { start: string; end: string }[]): MinuteRange[] {
  const holes = busy
    .map((b) => ({ start: timeToMin(b.start), end: timeToMin(b.end) }))
    .filter((r): r is MinuteRange => r.start !== null && r.end !== null && r.end > r.start);
  return subtract([DAYTIME], holes);
}

// ---------------------------------------------------------------------------
// Words (display; the spoken script writes its own)
// ---------------------------------------------------------------------------

/** 960 → "16", 990 → "16:30". */
export function hourLabel(minutes: number): string {
  const time = minToTime(minutes);
  return time.endsWith(':00') ? String(Number(time.slice(0, 2))) : time.replace(/^0/, '');
}

/** "a las 18" (one hour or less) or "entre las 17 y las 20". */
export function whenLabel(range: MinuteRange): string {
  if (range.end - range.start <= HOUR) return `a las ${hourLabel(range.start)}`;
  return `entre las ${hourLabel(range.start)} y las ${hourLabel(range.end)}`;
}

/** «Sal a correr entre las 16 y las 18: no llueve» (en bici for bike and brick). */
export function gapAdvice(sport: Sport, gap: MinuteRange): string {
  const go = sport === 'run' ? 'Sal a correr' : 'Sal en bici';
  return `${go} ${whenLabel(gap)}: no llueve`;
}

const temp = (t: number | null): string => (t === null ? '' : ` · ${t} °C`);

/** One quiet line for the session card; null when the weather says nothing about it. */
export function weatherLine(w: SessionWeather, sport: Sport): string | null {
  switch (w.kind) {
    case 'dry':
      return `Sin lluvia prevista${temp(w.tempC)}`;
    case 'some_rain':
      return `Algo de lluvia ${whenLabel(w.rain)}${temp(w.tempC)}`;
    case 'rain':
      return w.gap ? `Lluvia ${whenLabel(w.rain)}. ${gapAdvice(sport, w.gap)}.` : `Lluvia ${whenLabel(w.rain)} y ningún hueco seco hoy: mejor rodillo o piscina.`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Day outlook (coach and briefing context)
// ---------------------------------------------------------------------------

export interface DayOutlook {
  date: ISODate;
  /** Rainy hours between 07:00 and 22:00. */
  rainHours: number;
  /** Clearly dry stretches of at least an hour and a half between 07:00 and 22:00 ("10:00–14:00"). */
  dryGaps: string[];
  tempMin: number | null;
  tempMax: number | null;
  windMaxKmh: number | null;
  /** Days 3–9: 6-hour blocks, less precise. */
  coarse: boolean;
  /** "lluvia casi todo el día", "seco todo el día", "lluvia entre las 8 y las 14; seco entre las 15 y las 22". */
  summary: string;
}

function extreme(values: readonly (number | null)[], pick: (a: number, b: number) => number): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length === 0 ? null : Math.round(nums.reduce((a, b) => pick(a, b)));
}

function outlookSummary(day: readonly WeatherHour[], gaps: readonly MinuteRange[]): string {
  const rainy = day.filter((h) => hourState(h) === 'rain');
  const first = rainy[0];
  const last = rainy[rainy.length - 1];
  if (!first || !last) {
    const allDry = gaps.length === 1 && gaps[0] !== undefined && gaps[0].end - gaps[0].start >= day.length * HOUR;
    return allDry ? 'seco todo el día' : 'sin lluvia importante';
  }
  if (rainy.length >= day.length * 0.75) return 'lluvia casi todo el día';
  const rain = `lluvia ${whenLabel({ start: first.hour * HOUR, end: (last.hour + 1) * HOUR })}`;
  return [rain, ...gaps.map((g) => `seco ${whenLabel(g)}`)].join('; ');
}

/** Shortest dry stretch worth naming in a day outlook (an hour's run with its margin). */
const OUTLOOK_GAP_MIN = 90;

/** What the day looks like for training outside (07:00–22:00, the hours the forecast still covers), or null. */
export function dayOutlook(hours: readonly WeatherHour[], date: ISODate): DayOutlook | null {
  const day = hoursOn(hours, date).filter((h) => h.hour * HOUR >= DAYTIME.start && h.hour * HOUR < DAYTIME.end);
  if (day.length === 0) return null;
  const gaps = dryGaps(hours, date, { minMinutes: OUTLOOK_GAP_MIN });
  return {
    date,
    rainHours: day.filter((h) => hourState(h) === 'rain').length,
    dryGaps: gaps.map((g) => `${minToTime(g.start)}–${minToTime(g.end)}`),
    tempMin: extreme(day.map((h) => h.tempC), Math.min),
    tempMax: extreme(day.map((h) => h.tempC), Math.max),
    windMaxKmh: extreme(day.map((h) => h.windKmh), Math.max),
    coarse: day.some((h) => h.coarse),
    summary: outlookSummary(day, gaps),
  };
}
