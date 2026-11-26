import { addDays } from '../dates';
import type { Profile, Workout } from '../types';
import {
  dayOutlook,
  dryGaps,
  sessionWeather,
  weatherIssuesOn,
  weatherLine,
  windLabel,
  windLevel,
  WIND_RULES,
  type WeatherForecast,
  type WeatherHour,
  type WeatherSession,
} from '../weather';
import { planForWeather, type WeatherPlanInput } from '../weatherPlan';
import { makeProfile, makeWorkout } from './fixtures';

const MON = '2026-10-26';
const WED = addDays(MON, 2);
const THU = addDays(MON, 3);
const WEEK = Array.from({ length: 7 }, (_, i) => addDays(MON, i));

type Num = (hour: number) => number;
interface DayWeather {
  wind?: Num;
  gust?: Num;
  rain?: Num;
}

function hoursOf(date: string, w: DayWeather = {}): WeatherHour[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const precipMm = w.rain?.(hour) ?? 0;
    return {
      date,
      hour,
      tempC: 12,
      windKmh: w.wind?.(hour) ?? 10,
      ...(w.gust ? { gustKmh: w.gust(hour) } : {}),
      precipMm,
      precipProb: null,
      symbol: precipMm >= 0.1 ? 'rain' : 'cloudy',
      coarse: false,
    };
  });
}

const from = (start: number, value: number, otherwise = 10): Num => (h) => (h >= start ? value : otherwise);
const between = (start: number, end: number, value: number, otherwise = 10): Num => (h) => (h >= start && h < end ? value : otherwise);

function session(overrides: Partial<WeatherSession> = {}): WeatherSession {
  return { date: WED, startTime: '18:00', durationMin: 90, sport: 'bike', title: 'Rodaje en bici', ...overrides };
}

describe('windLevel · per sport', () => {
  const h = (windKmh: number, gustKmh?: number) => ({ windKmh, ...(gustKmh === undefined ? {} : { gustKmh }) });

  it('the bike notices from 25 km/h (or gusts of 40) and is a problem from 35 (or gusts of 55)', () => {
    expect(windLevel('bike', h(24))).toBe('calm');
    expect(windLevel('bike', h(25))).toBe('notice');
    expect(windLevel('bike', h(15, 40))).toBe('notice');
    expect(windLevel('bike', h(35))).toBe('strong');
    expect(windLevel('bike', h(20, 55))).toBe('strong');
    expect(windLevel('brick', h(35))).toBe('strong');
  });

  it('a run tolerates much more: notice from 30, a problem only from 45 or gusts of 60', () => {
    expect(windLevel('run', h(29))).toBe('calm');
    expect(windLevel('run', h(30))).toBe('notice');
    expect(windLevel('run', h(44, 59))).toBe('notice');
    expect(windLevel('run', h(45))).toBe('strong');
    expect(windLevel('run', h(20, 60))).toBe('strong');
  });

  it('swims, indoor sports and missing data are always calm', () => {
    expect(windLevel('swim', h(80, 100))).toBe('calm');
    expect(windLevel('strength', h(80))).toBe('calm');
    expect(windLevel('bike', { windKmh: null })).toBe('calm');
  });

  it('the thresholds are named constants (bike stricter than run)', () => {
    expect(WIND_RULES.bike.strongKmh).toBeLessThan(WIND_RULES.run.strongKmh);
    expect(WIND_RULES.bike.noticeKmh).toBeLessThan(WIND_RULES.bike.strongKmh);
  });
});

describe('sessionWeather · wind', () => {
  it('low wind is silent: the usual dry line', () => {
    const w = sessionWeather(hoursOf(WED, { wind: () => 15 }), session());
    expect(w).toEqual({ kind: 'dry', tempC: 12 });
    expect(weatherLine(w, 'bike')).toBe('Sin lluvia prevista · 12 °C');
  });

  it('a notice is only a line, with a calmer stretch of the day when there is one', () => {
    const w = sessionWeather(hoursOf(WED, { wind: from(15, 28) }), session());
    expect(w).toMatchObject({ kind: 'dry', wind: { level: 'notice', windKmh: 28, gustKmh: null }, calmer: { start: 7 * 60, end: 15 * 60 } });
    expect(weatherLine(w, 'bike')).toBe('Viento (28 km/h) entre las 18 y las 20; entre las 7 y las 15 sopla menos · 12 °C');
  });

  it('strong wind on the bike: a calmer dry gap the same day, said in one line', () => {
    const w = sessionWeather(hoursOf(WED, { wind: from(15, 35), gust: from(15, 50, 20) }), session());
    expect(w).toEqual({
      kind: 'wind',
      wind: { level: 'strong', windKmh: 35, gustKmh: 50, at: { start: 18 * 60, end: 20 * 60 } },
      rain: null,
      gap: { start: 7 * 60, end: 15 * 60 },
      tempC: 12,
    });
    expect(weatherLine(w, 'bike')).toBe('Viento fuerte (35 km/h, rachas 50) entre las 18 y las 20: mejor entre las 7 y las 15, con menos viento.');
  });

  it('strong wind all day: no calmer gap, the trainer (a run: cinta, rodillo o piscina)', () => {
    const windy = hoursOf(WED, { wind: () => 50 });
    expect(weatherLine(sessionWeather(windy, session()), 'bike')).toBe('Viento fuerte (50 km/h) entre las 18 y las 20 y ningún rato más tranquilo hoy: mejor rodillo.');
    expect(weatherLine(sessionWeather(windy, session({ sport: 'run', title: 'Rodaje', durationMin: 50 })), 'run')).toBe(
      'Viento fuerte (50 km/h) a las 18 y ningún rato más tranquilo hoy: mejor cinta, rodillo o piscina.',
    );
  });

  it('the same wind that stops a ride is just a notice for a run', () => {
    const hours = hoursOf(WED, { wind: from(15, 38) });
    expect(sessionWeather(hours, session()).kind).toBe('wind');
    expect(sessionWeather(hours, session({ sport: 'run', title: 'Rodaje', durationMin: 50 }))).toMatchObject({ kind: 'dry', wind: { level: 'notice' } });
  });

  it('rain and strong wind make ONE line, and the gap must be dry and calmer', () => {
    // Rain 17–21, strong wind 12–21: the gap is the dry and calm morning.
    const hours = hoursOf(WED, { rain: (h) => (h >= 17 && h < 21 ? 1.5 : 0), wind: between(12, 21, 40) });
    const w = sessionWeather(hours, session());
    expect(w).toMatchObject({ kind: 'rain', rain: { start: 18 * 60, end: 20 * 60 }, gap: { start: 7 * 60, end: 12 * 60 }, wind: { level: 'strong' } });
    expect(weatherLine(w, 'bike')).toBe('Lluvia y viento fuerte (40 km/h) entre las 18 y las 20. Sal en bici entre las 7 y las 12: no llueve y hay menos viento.');
  });

  it('a rainy session never gets a dry gap with strong wind', () => {
    const hours = hoursOf(WED, { rain: (h) => (h >= 17 ? 1.5 : 0), wind: (h) => (h < 17 ? 40 : 10) });
    expect(sessionWeather(hours, session())).toMatchObject({ kind: 'rain', gap: null });
    expect(dryGaps(hours, WED, { minMinutes: 120 })).toEqual([{ start: 7 * 60, end: 17 * 60 }]);
    expect(dryGaps(hours, WED, { minMinutes: 120, sport: 'bike' })).toEqual([]);
  });

  it('indoor sessions and swims never get wind', () => {
    const hours = hoursOf(WED, { wind: () => 60 });
    expect(sessionWeather(hours, session({ title: 'Rodillo MyWhoosh' }))).toEqual({ kind: 'indoor' });
    expect(sessionWeather(hours, session({ sport: 'swim', title: 'Técnica' }))).toEqual({ kind: 'indoor' });
  });

  it('an untimed session is strong only when most of the day is; a windy afternoon is a notice', () => {
    const afternoon = hoursOf(WED, { wind: from(16, 40) });
    expect(sessionWeather(afternoon, session({ startTime: null }))).toMatchObject({ kind: 'dry', wind: { level: 'notice' } });
    expect(sessionWeather(hoursOf(WED, { wind: from(9, 40) }), session({ startTime: null })).kind).toBe('wind');
  });

  it('windLabel: the numbers, gusts only when known', () => {
    expect(windLabel({ level: 'strong', windKmh: 35, gustKmh: 50 })).toBe('viento fuerte (35 km/h, rachas 50)');
    expect(windLabel({ level: 'notice', windKmh: 28, gustKmh: null })).toBe('viento (28 km/h)');
  });

  it('weatherIssuesOn: rain and strong wind, never a notice', () => {
    const hours = hoursOf(WED, { wind: from(15, 38) });
    const bike = { ...session(), id: 'b', status: 'planned', isKey: false };
    const runS = { ...session({ sport: 'run', title: 'Rodaje' }), id: 'r', status: 'planned', isKey: false };
    expect(weatherIssuesOn(hours, [bike, runS], WED).map((x) => x.session.id)).toEqual(['b']);
  });

  it('dayOutlook: gusts, strong wind hours for the bike and the summary', () => {
    const o = dayOutlook(hoursOf(WED, { wind: between(14, 20, 40), gust: () => 30 }), WED);
    expect(o).toMatchObject({ windMaxKmh: 40, gustMaxKmh: 30, windyHours: 6, summary: 'seco todo el día; viento fuerte entre las 14 y las 20' });
    expect(dayOutlook(hoursOf(WED), WED)).toMatchObject({ gustMaxKmh: null, windyHours: 0, summary: 'seco todo el día' });
  });
});

// ---------------------------------------------------------------------------
// The proposal (same flow as the rain: reviewed by the athlete, never applied here)
// ---------------------------------------------------------------------------

function forecast(days: Partial<Record<string, DayWeather>> = {}): WeatherForecast {
  return { place: 'Valencia', source: 'met_norway', updatedAt: `${MON}T06:00:00Z`, hours: WEEK.flatMap((d) => hoursOf(d, days[d])) };
}

const AUTO: Profile['availability'] = { mode: 'auto', weeklyHoursTarget: 9, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] };

function input(workouts: Workout[], fc: WeatherForecast, overrides: Partial<WeatherPlanInput> = {}): WeatherPlanInput {
  return { today: MON, weekWorkouts: workouts, profile: makeProfile({ availability: AUTO }), forecast: fc, scope: 'week', ...overrides };
}

const bike = (overrides: Partial<Workout> = {}): Workout =>
  makeWorkout({ id: 'bike', date: WED, startTime: '18:00', sport: 'bike', title: 'Rodaje en bici', durationMin: 90, intensity: 'endurance', ...overrides });
const run = (overrides: Partial<Workout> = {}): Workout =>
  makeWorkout({ id: 'run', date: WED, startTime: '18:00', sport: 'run', title: 'Rodaje suave', durationMin: 50, ...overrides });

describe('planForWeather · wind', () => {
  it('strong wind on the bike: proposes a calmer time the same day', () => {
    const result = planForWeather(input([bike()], forecast({ [WED]: { wind: from(15, 38), gust: from(15, 55, 20) } })));
    expect(result.changes).toEqual([
      {
        op: 'move',
        workoutId: 'bike',
        toDate: WED,
        toStartTime: '13:00',
        reason: 'Viento fuerte (38 km/h, rachas 55) el miércoles entre las 18 y las 20; entre las 7 y las 15 hay menos viento.',
      },
    ]);
    expect(result.summary).toBe('Viento fuerte (38 km/h, rachas 55) el miércoles entre las 18 y las 20. Sal en bici entre las 7 y las 15: hay menos viento.');
    expect(result.rainy).toBe(1);
  });

  it('strong wind all day: another calmer day, or the trainer when the day must stay', () => {
    const fc = forecast({ [WED]: { wind: () => 45 } });
    expect(planForWeather(input([bike()], fc)).changes[0]).toMatchObject({ op: 'move', workoutId: 'bike', toDate: THU, toStartTime: '18:00' });
    const today = bike({ date: MON });
    const day = planForWeather(input([today], forecast({ [MON]: { wind: () => 45 } }), { scope: 'day', nowMinutes: 9 * 60 }));
    expect(day.changes[0]).toMatchObject({ op: 'update', workoutId: 'bike', patch: { title: 'Rodillo · Rodaje en bici' } });
    expect(day.summary).toBe('Hoy hay viento fuerte entre las 18 y las 20: «Rodaje en bici» pasa a rodillo.');
  });

  it('a breeze, or 38 km/h on a run, is only a warning: no proposal', () => {
    expect(planForWeather(input([bike()], forecast({ [WED]: { wind: () => 28 } }))).changes).toEqual([]);
    expect(planForWeather(input([run()], forecast({ [WED]: { wind: () => 38 } }))).changes).toEqual([]);
  });

  it('a run in a gale (≥ 45 km/h) does get a calmer time', () => {
    const result = planForWeather(input([run()], forecast({ [WED]: { wind: from(15, 50) } })));
    expect(result.changes[0]).toMatchObject({ op: 'move', workoutId: 'run', toDate: WED });
    expect(result.summary).toMatch(/^Viento fuerte \(50 km\/h\) el miércoles a las 18\. Sal a correr entre las 7 y las 15: hay menos viento\.$/);
  });

  it('rain and strong wind on the same session: one change whose reason names both', () => {
    const result = planForWeather(input([bike()], forecast({ [WED]: { rain: (h) => (h >= 17 ? 1.5 : 0), wind: from(12, 40) } })));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ op: 'move', workoutId: 'bike', toDate: WED, reason: 'Lluvia y viento fuerte el miércoles entre las 18 y las 20; entre las 7 y las 12 no llueve y hay menos viento.' });
  });

  it('several sessions: one summary for rain and wind', () => {
    const fc = forecast({ [WED]: { wind: from(15, 40) }, [THU]: { rain: (h) => (h >= 17 ? 1.5 : 0) } });
    const result = planForWeather(input([bike(), run({ date: THU })], fc));
    expect(result.changes).toHaveLength(2);
    expect(result.summary).toBe('Lluvia y viento fuerte previstos: 2 cambios para entrenar en seco y con menos viento.');
  });
});
