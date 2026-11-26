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
 *
 * Wind (`WIND_RULES`, per sport: the bike suffers it most, a brick counts as
 * a bike) is mainly a warning: from the 'notice' level the session line says
 * it; only from the 'strong' level (a real problem to do the session) is the
 * session handled like a rainy one (calmer gap, other day or indoors, always
 * proposed). A gap is dry AND without strong wind for the sport. MET gives
 * gusts only in the Nordic area (`gustKmh` absent/null elsewhere): the rules
 * then lean on the 10-minute mean alone. Rain and wind make ONE line.
 */
import type { ISODate, Sport } from './types.ts';

export type WeatherSource = 'met_norway' | 'demo';

export interface WeatherHour {
  /** Local date and hour (0–23) where the hour starts. */
  date: ISODate;
  hour: number;
  tempC: number | null;
  windKmh: number | null;
  /** Strongest gust, km/h; absent or null when the provider does not give it (MET: Nordic area only). */
  gustKmh?: number | null;
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

/**
 * Wind thresholds, km/h (MET's 10-minute mean at 10 m; gusts when given).
 * - Bike: from ~25 km/h (Beaufort 4, upper end) a ride is clearly harder and
 *   gusts of 40 make deep wheels twitchy → notice. From 35 km/h sustained
 *   (Beaufort 5–6) or gusts of 55 (cycling-safety guidance: crosswind gusts of
 *   50–60 push a rider sideways into traffic; many clubs cancel rides there)
 *   → strong: propose a calmer hour or the trainer.
 * - Run: wind costs effort but not safety until much later: notice from
 *   30 km/h (Beaufort 5) or gusts of 50; strong only from 45 km/h (Beaufort 6
 *   upper end) or gusts of 60 (Beaufort 7, falling branches; AEMET's yellow
 *   warnings start at 60–70 km/h gusts).
 * Brick counts as a bike (the bike is most of it).
 */
export const WIND_RULES = {
  bike: { noticeKmh: 25, noticeGustKmh: 40, strongKmh: 35, strongGustKmh: 55 },
  run: { noticeKmh: 30, noticeGustKmh: 50, strongKmh: 45, strongGustKmh: 60 },
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

export type WindLevel = 'calm' | 'notice' | 'strong';

type WindRules = (typeof WIND_RULES)[keyof typeof WIND_RULES];

function windRulesOf(sport: Sport): WindRules | null {
  if (sport === 'bike' || sport === 'brick') return WIND_RULES.bike;
  if (sport === 'run') return WIND_RULES.run;
  return null;
}

const finite = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** How much the wind of `h` matters for `sport` ('calm' for sports without wind rules or without data). */
export function windLevel(sport: Sport, h: Pick<WeatherHour, 'windKmh' | 'gustKmh'>): WindLevel {
  const rules = windRulesOf(sport);
  if (!rules) return 'calm';
  const wind = finite(h.windKmh) ?? 0;
  const gust = finite(h.gustKmh) ?? 0;
  if (wind >= rules.strongKmh || gust >= rules.strongGustKmh) return 'strong';
  if (wind >= rules.noticeKmh || gust >= rules.noticeGustKmh) return 'notice';
  return 'calm';
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

const hourRanges = (day: readonly WeatherHour[]): MinuteRange[] => merge(day.map((h) => ({ start: h.hour * HOUR, end: (h.hour + 1) * HOUR })));

/** Minutes of the clearly dry hours of `date` (and without strong wind for `sport`, when given). */
export function dryRanges(hours: readonly WeatherHour[], date: ISODate, sport?: Sport): MinuteRange[] {
  return hourRanges(hoursOn(hours, date).filter((h) => hourState(h) === 'dry' && (sport === undefined || windLevel(sport, h) !== 'strong')));
}

export interface GapOptions {
  /** Minutes the athlete can train that day (training hours minus busy time); default 07:00–22:00. */
  allowed?: readonly MinuteRange[];
  minMinutes: number;
  /** The session's sport: hours with strong wind for it do not count either. */
  sport?: Sport;
}

/** Dry stretches of `date` inside the allowed minutes, at least `minMinutes` long. */
export function dryGaps(hours: readonly WeatherHour[], date: ISODate, opts: GapOptions): MinuteRange[] {
  return intersect(dryRanges(hours, date, opts.sport), opts.allowed ?? [DAYTIME]).filter((r) => r.end - r.start >= opts.minMinutes);
}

/** Dry and calm stretches of `date` for `sport` (the «sopla menos» hint of a windy session). */
function calmGaps(hours: readonly WeatherHour[], date: ISODate, sport: Sport, allowed: readonly MinuteRange[] | undefined, minMinutes: number): MinuteRange[] {
  const calm = hourRanges(hoursOn(hours, date).filter((h) => hourState(h) === 'dry' && windLevel(sport, h) === 'calm'));
  return intersect(calm, allowed ?? [DAYTIME]).filter((r) => r.end - r.start >= minMinutes);
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

export interface SessionWind {
  level: Exclude<WindLevel, 'calm'>;
  /** Strongest mean wind and gust (null when unknown) of the windy hours, km/h. */
  windKmh: number | null;
  gustKmh: number | null;
  /** First windy hour (at `level`) inside the window to the end of the last one (whole hours, like the rain). */
  at: MinuteRange;
}

const maxOf = (values: readonly (number | null)[]): number | null => {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length === 0 ? null : Math.round(Math.max(...nums));
};

/**
 * The wind of [start, end) on `date` for `sport`; null when calm or unknown. `peak` (a timed
 * session): its worst hour counts. Otherwise (an untimed session: the whole day) it is strong
 * only when at least half of the window is; a shorter strong spell is just a notice.
 */
export function windowWind(hours: readonly WeatherHour[], date: ISODate, window: MinuteRange, sport: Sport, peak: boolean): SessionWind | null {
  const inside = hoursOn(hours, date).filter((h) => Math.min(window.end, (h.hour + 1) * HOUR) > Math.max(window.start, h.hour * HOUR));
  const levels = inside.map((h) => ({ h, level: windLevel(sport, h) }));
  const strong = levels.filter((x) => x.level === 'strong');
  const windy = levels.filter((x) => x.level !== 'calm');
  if (windy.length === 0) return null;
  const level = strong.length > 0 && (peak || strong.length * 2 >= inside.length) ? 'strong' : 'notice';
  const counted = level === 'strong' ? strong : windy;
  const first = counted[0]?.h.hour ?? 0;
  const last = counted[counted.length - 1]?.h.hour ?? first;
  return {
    level,
    windKmh: maxOf(counted.map((x) => finite(x.h.windKmh))),
    gustKmh: maxOf(counted.map((x) => finite(x.h.gustKmh))),
    at: { start: first * HOUR, end: (last + 1) * HOUR },
  };
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

/**
 * The weather of an outdoor session. `wind` is there only when it matters (notice or strong).
 * 'wind' = not rainy but strong wind: it gets a gap like a rainy session (dry, without strong
 * wind); a rainy session stays 'rain' and carries its wind. `calmer` (a notice only): a dry
 * and calm stretch of the day to mention in the line, never proposed.
 */
export type SessionWeather =
  | { kind: 'indoor' }
  | { kind: 'unknown' }
  | { kind: 'dry'; tempC: number | null; wind?: SessionWind; calmer?: MinuteRange }
  | { kind: 'some_rain'; rain: MinuteRange; tempC: number | null; wind?: SessionWind; calmer?: MinuteRange }
  | { kind: 'rain'; rain: MinuteRange; gap: MinuteRange | null; tempC: number | null; wind?: SessionWind }
  | { kind: 'wind'; wind: SessionWind; rain: MinuteRange | null; gap: MinuteRange | null; tempC: number | null };

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

/** A calm stretch worth mentioning: the closest one outside the windy hours. */
function calmerOf(gaps: readonly MinuteRange[], s: Pick<WeatherSession, 'startTime' | 'durationMin'>, wind: SessionWind): MinuteRange | null {
  return bestGap(
    gaps.filter((g) => g.end <= wind.at.start || g.start >= wind.at.end),
    s,
  );
}

/**
 * Whether the session falls in the rain or in strong wind and, if it does, the best gap of that
 * day (dry and without strong wind for its sport); a notice of wind otherwise.
 */
export function sessionWeather(hours: readonly WeatherHour[], s: WeatherSession, opts: SessionWeatherOptions = {}): SessionWeather {
  if (!isOutdoorSession(s)) return { kind: 'indoor' };
  const timed = timeToMin(s.startTime) !== null;
  const window = timed ? sessionWindow(s) : untimedWindow(DAYTIME, opts.afterMin);
  const wet = windowRain(hours, s.date, window);
  if (!wet) return { kind: 'unknown' };
  const tempC = windowTemp(hours, s.date, window, timed);
  const wind = windowWind(hours, s.date, window, s.sport, timed);
  const windField = wind ? { wind } : {};
  const later = opts.afterMin === undefined ? null : [{ start: opts.afterMin, end: 24 * HOUR }];
  const allowed = later ? intersect(opts.allowed ?? [DAYTIME], later) : opts.allowed;
  const gapOf = (): MinuteRange | null => bestGap(dryGaps(hours, s.date, { allowed, minMinutes: gapNeed(s), sport: s.sport }), s);
  if (wet.rain && wet.rainMinutes / wet.minutes >= WEATHER_RULES.rainyShare) return { kind: 'rain', rain: wet.rain, gap: gapOf(), tempC, ...windField };
  if (wind?.level === 'strong') return { kind: 'wind', wind, rain: wet.rain, gap: gapOf(), tempC };
  const calmer = wind ? calmerOf(calmGaps(hours, s.date, s.sport, allowed, gapNeed(s)), s, wind) : null;
  const extra = { ...windField, ...(calmer ? { calmer } : {}) };
  if (!wet.rain) return { kind: 'dry', tempC, ...extra };
  return { kind: 'some_rain', rain: wet.rain, tempC, ...extra };
}

export type RainyWeather = Extract<SessionWeather, { kind: 'rain' }>;
/** A session the weather may propose to change: rain, or strong wind for its sport. */
export type ActionableWeather = Extract<SessionWeather, { kind: 'rain' | 'wind' }>;

export function isActionable(w: SessionWeather): w is ActionableWeather {
  return w.kind === 'rain' || w.kind === 'wind';
}

export type WeatherTrouble = 'rain' | 'wind' | 'both';

/** What makes the session a problem: rain, strong wind or both. */
export function troubleOf(w: ActionableWeather): WeatherTrouble {
  if (w.kind === 'wind') return 'wind';
  return w.wind?.level === 'strong' ? 'both' : 'rain';
}

/** The span to name: the rain, or the strong wind. */
export function troubleSpan(w: ActionableWeather): MinuteRange {
  return w.kind === 'rain' ? w.rain : w.wind.at;
}

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

export interface WeatherIssue<T> {
  session: T;
  weather: ActionableWeather;
}

/** Planned outdoor sessions of `date` in the rain or in strong wind (key sessions first, then by time), with their gap. */
export function weatherIssuesOn<T extends WeatherSession & { status?: string; isKey?: boolean }>(
  hours: readonly WeatherHour[],
  sessions: readonly T[],
  date: ISODate,
  opts: SessionWeatherOptions = {},
): WeatherIssue<T>[] {
  const byKey = (a: T, b: T): number => Number(b.isKey === true) - Number(a.isKey === true) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99');
  return sessions
    .filter((s) => s.date === date && (s.status === undefined || s.status === 'planned'))
    .sort(byKey)
    .map((session) => ({ session, weather: sessionWeather(hours, session, opts) }))
    .filter((x): x is WeatherIssue<T> => isActionable(x.weather));
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

const GAP_WHY: Record<WeatherTrouble, string> = { rain: 'no llueve', wind: 'hay menos viento', both: 'no llueve y hay menos viento' };

/** «Sal a correr entre las 16 y las 18: no llueve» (en bici for bike and brick; «hay menos viento» for wind). */
export function gapAdvice(sport: Sport, gap: MinuteRange, why: WeatherTrouble = 'rain'): string {
  const go = sport === 'run' ? 'Sal a correr' : 'Sal en bici';
  return `${go} ${whenLabel(gap)}: ${GAP_WHY[why]}`;
}

/** "viento fuerte (35 km/h, rachas 50)" or "viento (28 km/h)". */
export function windLabel(wind: Pick<SessionWind, 'level' | 'windKmh' | 'gustKmh'>): string {
  const numbers = [wind.windKmh === null ? null : `${wind.windKmh} km/h`, wind.gustKmh === null ? null : `rachas ${wind.gustKmh}`].filter(Boolean).join(', ');
  const what = wind.level === 'strong' ? 'viento fuerte' : 'viento';
  return numbers ? `${what} (${numbers})` : what;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «Lluvia a las 18», «Viento fuerte (35 km/h) a las 18», «Lluvia y viento fuerte (…) a las 18» (one span when they match). */
export function troubleWords(rain: MinuteRange | null, wind: SessionWind | undefined): string {
  if (!wind) return rain ? `Lluvia ${whenLabel(rain)}` : '';
  if (!rain) return capitalize(`${windLabel(wind)} ${whenLabel(wind.at)}`);
  if (rain.start === wind.at.start && rain.end === wind.at.end) return `Lluvia y ${windLabel(wind)} ${whenLabel(rain)}`;
  return `Lluvia ${whenLabel(rain)} y ${windLabel(wind)} ${whenLabel(wind.at)}`;
}

const temp = (t: number | null): string => (t === null ? '' : ` · ${t} °C`);

/** «Viento (28 km/h) a las 18; a las 10 sopla menos · 14 °C» (with «Algo de lluvia …, » first when there is some). */
function noticeLine(rainWords: string | null, wind: SessionWind, calmer: MinuteRange | undefined, tempC: number | null): string {
  const windText = `${windLabel(wind)} ${whenLabel(wind.at)}`;
  const head = rainWords ? `${rainWords}, ${windText}` : capitalize(windText);
  return `${head}${calmer ? `; ${whenLabel(calmer)} sopla menos` : ''}${temp(tempC)}`;
}

const INDOORS_FOR_WIND = (sport: Sport): string => (sport === 'run' ? 'mejor cinta, rodillo o piscina' : 'mejor rodillo');

/** One quiet line for the session card (rain and wind together); null when the weather says nothing about it. */
export function weatherLine(w: SessionWeather, sport: Sport): string | null {
  switch (w.kind) {
    case 'dry':
      return w.wind ? noticeLine(null, w.wind, w.calmer, w.tempC) : `Sin lluvia prevista${temp(w.tempC)}`;
    case 'some_rain':
      return w.wind ? noticeLine(`Algo de lluvia ${whenLabel(w.rain)}`, w.wind, w.calmer, w.tempC) : `Algo de lluvia ${whenLabel(w.rain)}${temp(w.tempC)}`;
    case 'rain': {
      const head = troubleWords(w.rain, w.wind);
      const why = troubleOf(w);
      if (w.gap) return `${head}. ${gapAdvice(sport, w.gap, why)}.`;
      return `${head} y ningún hueco ${why === 'both' ? 'seco y sin viento' : 'seco'} hoy: mejor rodillo o piscina.`;
    }
    case 'wind': {
      const head = troubleWords(null, w.wind);
      if (w.gap) return `${head}: mejor ${whenLabel(w.gap)}, con menos viento.`;
      return `${head} y ningún rato más tranquilo hoy: ${INDOORS_FOR_WIND(sport)}.`;
    }
    default:
      return null;
  }
}

/** The advice for a session the weather is a problem for (briefing and coach context). */
export function issueAdvice(w: ActionableWeather, sport: Sport): string {
  const why = troubleOf(w);
  if (w.gap) return gapAdvice(sport, w.gap, why);
  if (why === 'wind') return `Viento fuerte y ningún rato más tranquilo: ${INDOORS_FOR_WIND(sport)}`;
  return why === 'both' ? 'Llueve, hay viento fuerte y no hay un hueco seco y sin viento: mejor rodillo o piscina' : 'Llueve y no hay un hueco seco: mejor rodillo o piscina';
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
  /** Strongest gust, km/h; null when the provider gives no gusts. */
  gustMaxKmh: number | null;
  /** Hours with strong wind for the bike (`WIND_RULES.bike`) between 07:00 and 22:00. */
  windyHours: number;
  /** Days 3–9: 6-hour blocks, less precise. */
  coarse: boolean;
  /** "lluvia casi todo el día", "seco todo el día", "lluvia entre las 8 y las 14; seco entre las 15 y las 22" (+ "; viento fuerte entre las 14 y las 20"). */
  summary: string;
}

function extreme(values: readonly (number | null)[], pick: (a: number, b: number) => number): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length === 0 ? null : Math.round(nums.reduce((a, b) => pick(a, b)));
}

function windSummary(day: readonly WeatherHour[]): string | null {
  const windy = day.filter((h) => windLevel('bike', h) === 'strong');
  const first = windy[0];
  const last = windy[windy.length - 1];
  return first && last ? `viento fuerte ${whenLabel({ start: first.hour * HOUR, end: (last.hour + 1) * HOUR })}` : null;
}

function outlookSummary(day: readonly WeatherHour[], gaps: readonly MinuteRange[]): string {
  const wind = windSummary(day);
  return wind ? `${rainSummary(day, gaps)}; ${wind}` : rainSummary(day, gaps);
}

function rainSummary(day: readonly WeatherHour[], gaps: readonly MinuteRange[]): string {
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
    gustMaxKmh: extreme(day.map((h) => h.gustKmh ?? null), Math.max),
    windyHours: day.filter((h) => windLevel('bike', h) === 'strong').length,
    coarse: day.some((h) => h.coarse),
    summary: outlookSummary(day, gaps),
  };
}
