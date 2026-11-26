import {
  bestGap,
  dayOutlook,
  dryGaps,
  forecastDays,
  freeDaytime,
  gapAdvice,
  hourLabel,
  hourState,
  hoursOn,
  isOutdoorSession,
  isWetSymbol,
  minToTime,
  rainySessionsOn,
  sessionWeather,
  startInGap,
  timeToMin,
  weatherLine,
  whenLabel,
  windowRain,
  type WeatherHour,
  type WeatherSession,
} from '../weather';

const WED = '2026-10-28';
const THU = '2026-10-29';

/** 24 hours of `date`; `mm(hour)` gives the rain of each hour (symbol 'rain' from 0.1 mm). */
function day(date: string, mm: (hour: number) => number = () => 0, extra: Partial<WeatherHour> = {}): WeatherHour[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const precipMm = mm(hour);
    return {
      date,
      hour,
      tempC: 8 + hour / 2,
      windKmh: 10 + hour,
      precipMm,
      precipProb: null,
      symbol: precipMm >= 0.1 ? 'rain' : 'cloudy',
      coarse: false,
      ...extra,
    };
  });
}

const rainBetween = (from: number, to: number, mm = 1.5) => (hour: number) => (hour >= from && hour < to ? mm : 0);
const allRain = () => 2;

function session(overrides: Partial<WeatherSession> = {}): WeatherSession {
  return { date: WED, startTime: '18:00', durationMin: 50, sport: 'run', title: 'Rodaje suave', ...overrides };
}

const H = (hour: number, extra: Partial<WeatherHour> = {}): WeatherHour => ({
  date: WED,
  hour,
  tempC: 12,
  windKmh: 10,
  precipMm: 0,
  precipProb: null,
  symbol: 'cloudy',
  coarse: false,
  ...extra,
});

describe('hourState', () => {
  it('is dry only without rain, a low chance and no rain symbol', () => {
    expect(hourState(H(9))).toBe('dry');
    expect(hourState(H(9, { precipProb: 20 }))).toBe('dry');
    expect(hourState(H(9, { precipProb: 45 }))).toBe('wet');
    expect(hourState(H(9, { symbol: 'lightrainshowers_day' }))).toBe('wet');
    expect(hourState(H(9, { precipMm: 0.2, symbol: 'lightrain' }))).toBe('wet');
  });

  it('is rainy from 0.5 mm/h with a high (or unknown) chance', () => {
    expect(hourState(H(9, { precipMm: 0.5, symbol: 'rain' }))).toBe('rain');
    expect(hourState(H(9, { precipMm: 1, precipProb: 70, symbol: 'rain' }))).toBe('rain');
    expect(hourState(H(9, { precipMm: 1, precipProb: 40, symbol: 'rain' }))).toBe('wet');
  });

  it('6-hour blocks count as rain from about 2 mm in the block', () => {
    expect(hourState(H(9, { precipMm: 0.35, coarse: true, symbol: 'rain' }))).toBe('rain');
    expect(hourState(H(9, { precipMm: 0.25, coarse: true, symbol: 'rain' }))).toBe('wet');
    expect(hourState(H(9, { precipMm: 0, coarse: true, symbol: 'partlycloudy_day' }))).toBe('dry');
  });

  it('knows the MET rain symbols', () => {
    expect(['rain', 'heavyrainandthunder', 'lightsleet', 'snowshowers_day', 'rainshowers_night'].every(isWetSymbol)).toBe(true);
    expect(['clearsky_day', 'fair_night', 'cloudy', 'fog', null].some(isWetSymbol)).toBe(false);
  });
});

describe('hours of a day', () => {
  it('orders the hours, keeps the first of a repeated hour and lists the days', () => {
    const repeated = [H(3, { tempC: 1 }), H(2), H(3, { tempC: 9 }), { ...H(5), date: THU }];
    expect(hoursOn(repeated, WED).map((h) => [h.hour, h.tempC])).toEqual([
      [2, 12],
      [3, 1],
    ]);
    expect(forecastDays(repeated)).toEqual([WED, THU]);
  });

  it('time helpers round-trip and reject nonsense', () => {
    expect(timeToMin('07:30')).toBe(450);
    expect(timeToMin('7:05:00')).toBe(425);
    expect(timeToMin('25:00')).toBeNull();
    expect(timeToMin(null)).toBeNull();
    expect(minToTime(450)).toBe('07:30');
    expect(minToTime(-5)).toBe('00:00');
    expect(minToTime(24 * 60)).toBe('23:59');
  });
});

describe('dryGaps', () => {
  const hours = day(WED, rainBetween(7, 13));

  it('finds dry stretches of the training day long enough for the session', () => {
    expect(dryGaps(hours, WED, { minMinutes: 80 })).toEqual([{ start: 13 * 60, end: 22 * 60 }]);
  });

  it('respects the allowed minutes (busy time removed)', () => {
    const allowed = freeDaytime([{ start: '15:00', end: '20:30' }]);
    expect(allowed).toEqual([
      { start: 7 * 60, end: 15 * 60 },
      { start: 20 * 60 + 30, end: 22 * 60 },
    ]);
    expect(dryGaps(hours, WED, { allowed, minMinutes: 80 })).toEqual([
      { start: 13 * 60, end: 15 * 60 },
      { start: 20 * 60 + 30, end: 22 * 60 },
    ]);
    expect(dryGaps(hours, WED, { allowed, minMinutes: 100 })).toEqual([{ start: 13 * 60, end: 15 * 60 }]);
    expect(dryGaps(hours, WED, { allowed, minMinutes: 150 })).toEqual([]);
  });

  it('a wet but not rainy hour still breaks a gap', () => {
    const drizzle = day(WED, (h) => (h === 16 ? 0.2 : 0));
    expect(dryGaps(drizzle, WED, { minMinutes: 60 })).toEqual([
      { start: 7 * 60, end: 16 * 60 },
      { start: 17 * 60, end: 22 * 60 },
    ]);
  });
});

describe('windowRain', () => {
  it('weighs the minutes of the window and returns the rainy span', () => {
    const hours = day(WED, rainBetween(18, 20));
    expect(windowRain(hours, WED, { start: 17 * 60 + 30, end: 19 * 60 + 30 })).toEqual({
      rainMinutes: 90,
      minutes: 120,
      rain: { start: 18 * 60, end: 20 * 60 },
    });
  });

  it('is unknown when the forecast covers less than half of the window', () => {
    const afternoon = day(WED).filter((h) => h.hour >= 16);
    expect(windowRain(afternoon, WED, { start: 7 * 60, end: 22 * 60 })).toBeNull();
    expect(windowRain(afternoon, WED, { start: 12 * 60, end: 22 * 60 })).not.toBeNull();
    expect(windowRain([], WED, { start: 9 * 60, end: 10 * 60 })).toBeNull();
  });
});

describe('outdoor sessions', () => {
  it('run, bike and brick are outdoors unless the title says they are not', () => {
    expect(isOutdoorSession({ sport: 'run', title: 'Rodaje' })).toBe(true);
    expect(isOutdoorSession({ sport: 'bike', title: 'Fondo Z2' })).toBe(true);
    expect(isOutdoorSession({ sport: 'brick', title: 'Brick: bici 1h + carrera 20\'' })).toBe(true);
    expect(isOutdoorSession({ sport: 'bike', title: 'Rodillo · Umbral 3×10\'' })).toBe(false);
    expect(isOutdoorSession({ sport: 'bike', title: 'MyWhoosh: Alpe du Zwift' })).toBe(false);
    expect(isOutdoorSession({ sport: 'bike', title: 'Trainer Z2' })).toBe(false);
    expect(isOutdoorSession({ sport: 'run', title: 'Series en cinta' })).toBe(false);
    expect(['swim', 'strength', 'mobility', 'other', 'rest'].some((sport) => isOutdoorSession({ sport: sport as never, title: 'X' }))).toBe(false);
  });
});

describe('sessionWeather', () => {
  it('indoor sessions are never affected', () => {
    const hours = day(WED, allRain);
    expect(sessionWeather(hours, session({ sport: 'swim', title: 'Técnica' })).kind).toBe('indoor');
    expect(sessionWeather(hours, session({ sport: 'bike', title: 'Rodillo Z2' })).kind).toBe('indoor');
  });

  it('a timed run in the rain gets the closest dry gap of the day', () => {
    const hours = day(WED, rainBetween(17, 21));
    const w = sessionWeather(hours, session());
    expect(w).toEqual({ kind: 'rain', rain: { start: 18 * 60, end: 19 * 60 }, gap: { start: 7 * 60, end: 17 * 60 }, tempC: 17 });
    if (w.kind !== 'rain' || !w.gap) throw new Error('expected a gap');
    // Latest start that keeps 30' of margin before the rain: 17:00 − 50' − 30' = 15:40 → 15:30.
    expect(minToTime(startInGap(w.gap, session()))).toBe('15:30');
  });

  it('a rainy day without a dry gap long enough has no gap', () => {
    // Showers every other hour: one dry hour at a time is not enough for 50' + 30'.
    const hours = day(WED, (h) => (h % 2 === 0 ? 2 : 0));
    const w = sessionWeather(hours, session());
    expect(w.kind).toBe('rain');
    expect(w.kind === 'rain' ? w.gap : 'x').toBeNull();
  });

  it('an untimed session is rainy when most of the day is, and gets the longest dry stretch', () => {
    const hours = day(WED, rainBetween(7, 15));
    const w = sessionWeather(hours, session({ startTime: null, durationMin: 60 }));
    expect(w.kind === 'rain' ? w.gap : null).toEqual({ start: 15 * 60, end: 22 * 60 });
    expect(sessionWeather(day(WED, rainBetween(7, 11)), session({ startTime: null })).kind).toBe('some_rain');
  });

  it('only a little rain inside a long window is some_rain; none is dry', () => {
    const hours = day(WED, rainBetween(11, 12));
    expect(sessionWeather(hours, session({ sport: 'bike', title: 'Fondo', startTime: '09:00', durationMin: 180 }))).toEqual({
      kind: 'some_rain',
      rain: { start: 11 * 60, end: 12 * 60 },
      tempC: 13,
    });
    expect(sessionWeather(hours, session({ startTime: '15:00' }))).toEqual({ kind: 'dry', tempC: 16 });
  });

  it('is unknown without forecast for that day', () => {
    expect(sessionWeather(day(THU), session()).kind).toBe('unknown');
  });

  it('today: the gone hours are skipped for untimed sessions and gaps', () => {
    const hours = day(WED, rainBetween(7, 15)).filter((h) => h.hour >= 14);
    expect(sessionWeather(hours, session({ startTime: null }), { afterMin: 15 * 60 }).kind).toBe('dry');
    const evening = day(WED, rainBetween(18, 22));
    const w = sessionWeather(evening, session({ startTime: '19:00' }), { afterMin: 17 * 60 + 30 });
    expect(w.kind === 'rain' ? w.gap : 'x').toBeNull();
  });

  it('the allowed minutes decide the gap', () => {
    const hours = day(WED, rainBetween(17, 21));
    const w = sessionWeather(hours, session(), { allowed: freeDaytime([{ start: '07:00', end: '15:00' }]) });
    expect(w.kind === 'rain' ? w.gap : null).toEqual({ start: 15 * 60, end: 17 * 60 });
  });
});

describe('gaps and starts', () => {
  const s = session({ startTime: '12:00', durationMin: 60 });

  it('keeps the own time when it fits, else goes as close as possible', () => {
    expect(startInGap({ start: 600, end: 900 }, s)).toBe(720);
    // Gap after the session: its start, on the quarter while the margin still fits.
    expect(startInGap({ start: 13 * 60 + 10, end: 18 * 60 }, s)).toBe(13 * 60 + 15);
    expect(startInGap({ start: 13 * 60 + 50, end: 15 * 60 + 20 }, s)).toBe(13 * 60 + 50);
    // Gap before it: the latest start that leaves 30' before the rain (10:00 − 60' − 30').
    expect(startInGap({ start: 7 * 60, end: 10 * 60 }, s)).toBe(8 * 60 + 30);
    expect(startInGap({ start: 8 * 60 + 5, end: 10 * 60 }, session({ startTime: null, durationMin: 60 }))).toBe(8 * 60 + 15);
  });

  it('picks the closest gap for a timed session and the longest for an untimed one', () => {
    const gaps = [
      { start: 7 * 60, end: 9 * 60 },
      { start: 13 * 60, end: 22 * 60 },
    ];
    expect(bestGap(gaps, s)).toEqual(gaps[1]);
    expect(bestGap(gaps, session({ startTime: '06:30', durationMin: 60 }))).toEqual(gaps[0]);
    expect(bestGap(gaps, session({ startTime: null }))).toEqual(gaps[1]);
    expect(bestGap([], s)).toBeNull();
  });
});

describe('words', () => {
  it('says hours the Spanish way', () => {
    expect(hourLabel(16 * 60)).toBe('16');
    expect(hourLabel(9 * 60 + 30)).toBe('9:30');
    expect(whenLabel({ start: 18 * 60, end: 19 * 60 })).toBe('a las 18');
    expect(whenLabel({ start: 17 * 60, end: 20 * 60 })).toBe('entre las 17 y las 20');
  });

  it('gives the dry-gap advice per sport', () => {
    const gap = { start: 16 * 60, end: 18 * 60 };
    expect(gapAdvice('run', gap)).toBe('Sal a correr entre las 16 y las 18: no llueve');
    expect(gapAdvice('bike', gap)).toBe('Sal en bici entre las 16 y las 18: no llueve');
  });

  it('writes one quiet line per case', () => {
    const rain = { start: 18 * 60, end: 19 * 60 };
    expect(weatherLine({ kind: 'dry', tempC: 14 }, 'run')).toBe('Sin lluvia prevista · 14 °C');
    expect(weatherLine({ kind: 'some_rain', rain, tempC: null }, 'bike')).toBe('Algo de lluvia a las 18');
    expect(weatherLine({ kind: 'rain', rain, gap: { start: 16 * 60, end: 18 * 60 }, tempC: 12 }, 'run')).toBe(
      'Lluvia a las 18. Sal a correr entre las 16 y las 18: no llueve.',
    );
    expect(weatherLine({ kind: 'rain', rain, gap: null, tempC: 12 }, 'bike')).toBe('Lluvia a las 18 y ningún hueco seco hoy: mejor rodillo o piscina.');
    expect(weatherLine({ kind: 'indoor' }, 'swim')).toBeNull();
    expect(weatherLine({ kind: 'unknown' }, 'run')).toBeNull();
  });
});

describe('rainySessionsOn', () => {
  it('lists the planned outdoor sessions in the rain, key sessions first', () => {
    const hours = day(WED, allRain);
    const easy = { ...session({ startTime: '07:00' }), status: 'planned', isKey: false, id: 'easy' };
    const key = { ...session({ startTime: '19:00', sport: 'bike', title: 'Umbral' }), status: 'planned', isKey: true, id: 'key' };
    const done = { ...session(), status: 'completed', id: 'done' };
    const swim = { ...session({ sport: 'swim', title: 'Técnica' }), status: 'planned', id: 'swim' };
    const other = { ...session({ date: THU }), status: 'planned', id: 'thu' };
    expect(rainySessionsOn(hours, [easy, done, swim, key, other], WED).map((r) => r.session.id)).toEqual(['key', 'easy']);
  });
});

describe('dayOutlook', () => {
  it('summarises a dry, a rainy and a mixed day', () => {
    expect(dayOutlook(day(WED), WED)?.summary).toBe('seco todo el día');
    expect(dayOutlook(day(WED, allRain), WED)?.summary).toBe('lluvia casi todo el día');
    const mixed = dayOutlook(day(WED, rainBetween(8, 14)), WED);
    expect(mixed?.summary).toBe('lluvia entre las 8 y las 14; seco entre las 14 y las 22');
    expect(mixed).toMatchObject({ rainHours: 6, dryGaps: ['14:00–22:00'], tempMin: 12, coarse: false });
  });

  it('gives temperatures and wind, flags 6-hour blocks and is null without daytime hours', () => {
    const outlook = dayOutlook(day(WED, () => 0, { coarse: true }), WED);
    expect(outlook).toMatchObject({ tempMin: 12, tempMax: 19, windMaxKmh: 31, coarse: true });
    expect(dayOutlook(day(WED).filter((h) => h.hour < 6), WED)).toBeNull();
    expect(dayOutlook(day(WED, (h) => (h === 10 ? 0.2 : 0)), WED)?.summary).toBe('sin lluvia importante');
  });
});
