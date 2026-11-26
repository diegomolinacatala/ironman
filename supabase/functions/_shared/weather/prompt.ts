/**
 * The forecast as the AI sees it (compact, Spanish, local times, no coordinates):
 * - coach: one row per day of the next week (summary, dry stretches, rainy
 *   hours, temperatures, wind), so «¿cuándo salgo a correr esta semana?» has a
 *   real answer;
 * - briefing: only when one of today's outdoor sessions falls in the rain,
 *   with its dry gap (or none) and the sentence the app would show.
 * Pure (the mirrored `weather.ts` rules).
 */
import { addDays, weekdayOf, WEEKDAYS_ES } from '../dates.ts';
import { dayOutlook, freeDaytime, gapAdvice, rainySessionsOn, whenLabel } from '../planning/domain/weather.ts';
import type { WeatherForecast, WeatherSession } from '../planning/domain/weather.ts';
import type { ISODate, Workout } from '../types.ts';

export const WEATHER_CREDIT = 'MET Norway';
const COACH_DAYS = 7;

/** Next `COACH_DAYS` days from `today` (only the days the forecast covers). */
export function weatherForCoach(forecast: WeatherForecast, today: ISODate): Record<string, unknown> | null {
  const days = Array.from({ length: COACH_DAYS }, (_, i) => addDays(today, i))
    .map((date) => dayOutlook(forecast.hours, date))
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => ({
      date: d.date,
      weekday: WEEKDAYS_ES[weekdayOf(d.date)],
      summary: d.summary,
      dryGaps: d.dryGaps,
      rainHours: d.rainHours,
      tempMin: d.tempMin,
      tempMax: d.tempMax,
      windMaxKmh: d.windMaxKmh,
      ...(d.coarse ? { approx: true } : {}),
    }));
  return days.length === 0 ? null : { place: forecast.place, source: WEATHER_CREDIT, days };
}

function minutesNow(now: Date, tz: string): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : undefined;
  } catch {
    return undefined;
  }
}

export interface BriefingWeatherInput {
  forecast: WeatherForecast;
  date: ISODate;
  /** The athlete's "today" (a briefing for tomorrow looks at the whole day). */
  today: ISODate;
  workouts: readonly Workout[];
  /** Today's busy times, local 'HH:mm' (no titles). */
  busy: readonly { start: string; end: string }[];
  now: Date;
  timezone: string;
}

/** Today's outdoor sessions in the rain with their dry gap; null when the weather does not matter today. */
export function weatherForBriefing(input: BriefingWeatherInput): Record<string, unknown> | null {
  const afterMin = input.date === input.today ? minutesNow(input.now, input.timezone) : undefined;
  const sessions: (WeatherSession & { status: string; isKey: boolean; title: string })[] = input.workouts.filter((w) => w.date === input.date);
  const rainy = rainySessionsOn(input.forecast.hours, sessions, input.date, { allowed: freeDaytime(input.busy), ...(afterMin === undefined ? {} : { afterMin }) });
  if (rainy.length === 0) return null;
  return {
    place: input.forecast.place,
    source: WEATHER_CREDIT,
    sessions: rainy.map(({ session, weather }) => ({
      title: session.title,
      startTime: session.startTime,
      rain: whenLabel(weather.rain),
      dryGap: weather.gap ? whenLabel(weather.gap) : null,
      advice: weather.gap ? gapAdvice(session.sport, weather.gap) : 'Llueve y no hay un hueco seco: mejor rodillo o piscina',
    })),
  };
}
