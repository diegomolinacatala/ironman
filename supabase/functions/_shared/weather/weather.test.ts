import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import type { Workout } from '../types.ts';
import { normalizeQuery, NOMINATIM_MIN_INTERVAL_MS, parseNominatim, searchPlaces } from './geocode.ts';
import type { GeocodeDeps } from './geocode.ts';
import { handleWeatherHttp, parseWeatherRequest } from './http.ts';
import type { WeatherHttpDeps } from './http.ts';
import { fetchMetForecast, MET_MIN_REFRESH_MS, nextFetchAt, parseMetForecast, roundCoord } from './met.ts';
import type { CachedForecast, FetchLike, ForecastCache, GeocodeCache, PlaceResult } from './ports.ts';
import { WEATHER_USER_AGENT } from './ports.ts';
import { weatherForBriefing, weatherForCoach } from './prompt.ts';
import { cachedForecast, createWeatherReader, forecastForPlace, localHours, safeForecast } from './service.ts';
import type { ForecastDeps } from './service.ts';

const NOW = new Date('2026-11-26T11:20:00Z');
const USER = '11111111-1111-4111-8111-111111111111';
const PLACE = { name: 'Valencia', lat: 39.4699, lon: -0.3763, timezone: 'Europe/Madrid' };

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** Fake fetch answering with `responses` in order and recording the calls. */
function fakeFetch(responses: (() => Response)[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
      const next = queue.shift();
      if (!next) throw new Error('unexpected fetch');
      return next();
    },
  };
}

function memoryCache(initial: CachedForecast | null = null): ForecastCache & { rows: CachedForecast[] } {
  const rows: CachedForecast[] = initial ? [initial] : [];
  return {
    rows,
    async get(lat, lon) {
      return rows.find((r) => r.lat === lat && r.lon === lon) ?? null;
    },
    async put(row) {
      const i = rows.findIndex((r) => r.lat === row.lat && r.lon === row.lon);
      if (i >= 0) rows[i] = row;
      else rows.push(row);
    },
  };
}

/** MET /compact body: `hourly` hourly steps from 11:00Z, then 6-hour steps. */
function metBody(hourly: number, sixHourly: number, rainAt: (iso: string) => number = () => 0): unknown {
  const start = Date.parse('2026-11-26T11:00:00Z');
  const step = (t: number, h: 1 | 6) => {
    const time = new Date(t).toISOString().replace('.000Z', 'Z');
    const mm = rainAt(time);
    const period = { summary: { symbol_code: mm > 0 ? 'rain' : 'cloudy' }, details: { precipitation_amount: mm } };
    return {
      time,
      data: {
        instant: { details: { air_temperature: 10 + (t - start) / 3_600_000 / 10, wind_speed: 5 } },
        ...(h === 1 ? { next_1_hours: period } : {}),
        next_6_hours: { summary: { symbol_code: mm > 0 ? 'rain' : 'cloudy' }, details: { precipitation_amount: mm * (h === 6 ? 1 : 6) } },
      },
    };
  };
  const hours = Array.from({ length: hourly }, (_, i) => step(start + i * 3_600_000, 1));
  const blocks = Array.from({ length: sixHourly }, (_, i) => step(start + hourly * 3_600_000 + i * 6 * 3_600_000, 6));
  return { type: 'Feature', properties: { meta: { updated_at: '2026-11-26T11:19:17Z', units: {} }, timeseries: [...hours, ...blocks] } };
}

const metOk = (body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', expires: 'Wed, 26 Nov 2026 11:50:00 GMT', 'last-modified': 'Wed, 26 Nov 2026 11:19:17 GMT', ...headers },
  });

function forecastDeps(cache: ForecastCache, fetch: FetchLike, now = NOW): ForecastDeps {
  return { cache, fetch, now: () => now, logger: silentLogger };
}

// ---------------------------------------------------------------------------
// MET Norway
// ---------------------------------------------------------------------------

test('parseMetForecast: hourly steps, then 6-hour blocks; wind in km/h; defensive', () => {
  const parsed = parseMetForecast(metBody(2, 1, (t) => (t === '2026-11-26T12:00:00Z' ? 0.8 : 0)));
  assert.equal(parsed?.issuedAt, '2026-11-26T11:19:17.000Z');
  assert.deepEqual(parsed?.points.map((p) => [p.t, p.h, p.mm, p.sym, p.wind]), [
    ['2026-11-26T11:00:00.000Z', 1, 0, 'cloudy', 18],
    ['2026-11-26T12:00:00.000Z', 1, 0.8, 'rain', 18],
    ['2026-11-26T13:00:00.000Z', 6, 0, 'cloudy', 18],
  ]);
  assert.equal(parseMetForecast({ properties: {} }), null);
  assert.equal(parseMetForecast('nope'), null);
  const broken = { properties: { timeseries: [{ time: 'x' }, { time: '2026-11-26T11:00:00Z', data: {} }] } };
  assert.deepEqual(parseMetForecast(broken)?.points, []);
});

test('probability of rain is kept when MET gives it (Nordic area)', () => {
  const body = {
    properties: {
      timeseries: [
        { time: '2026-11-26T11:00:00Z', data: { instant: { details: {} }, next_1_hours: { details: { precipitation_amount: 1.2, probability_of_precipitation: 87 } } } },
      ],
    },
  };
  assert.deepEqual(parseMetForecast(body)?.points[0], { t: '2026-11-26T11:00:00.000Z', temp: null, wind: null, mm: 1.2, prob: 87, sym: null, h: 1 });
});

test('fetchMetForecast: identifying User-Agent, 2-decimal coordinates, If-Modified-Since, Expires floor', async () => {
  const fake = fakeFetch([metOk(metBody(3, 0)), () => new Response(null, { status: 304, headers: { expires: 'Wed, 26 Nov 2026 16:00:00 GMT' } })]);
  const fresh = await fetchMetForecast(fake.fetch, { lat: 39.4699, lon: -0.3763, lastModified: null, now: NOW });
  assert.equal(fake.calls[0]?.url, 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=39.47&lon=-0.38');
  assert.equal(fake.calls[0]?.headers['User-Agent'], WEATHER_USER_AGENT);
  assert.equal(fake.calls[0]?.headers['If-Modified-Since'], undefined);
  assert.equal(fresh.kind, 'fresh');
  // Expires 11:50 is sooner than the 90' floor: the floor wins.
  assert.equal(fresh.expiresAt, new Date(NOW.getTime() + MET_MIN_REFRESH_MS).toISOString());
  const again = await fetchMetForecast(fake.fetch, { lat: 39.47, lon: -0.38, lastModified: 'Wed, 26 Nov 2026 11:19:17 GMT', now: NOW });
  assert.equal(fake.calls[1]?.headers['If-Modified-Since'], 'Wed, 26 Nov 2026 11:19:17 GMT');
  assert.deepEqual(again, { kind: 'not_modified', expiresAt: '2026-11-26T16:00:00.000Z' });
});

test('fetchMetForecast: errors are WeatherError (429 rate_limited, the rest unavailable)', async () => {
  const fake = fakeFetch([() => new Response('', { status: 429 }), () => new Response('', { status: 403 }), () => metOk({ nope: true })()]);
  const req = { lat: 1, lon: 1, lastModified: null, now: NOW };
  await assert.rejects(fetchMetForecast(fake.fetch, req), { name: 'WeatherError', code: 'rate_limited' });
  await assert.rejects(fetchMetForecast(fake.fetch, req), { name: 'WeatherError', code: 'unavailable' });
  await assert.rejects(fetchMetForecast(fake.fetch, req), { name: 'WeatherError', code: 'unavailable' });
  const down: FetchLike = async () => {
    throw new TypeError('network');
  };
  await assert.rejects(fetchMetForecast(down, req), { name: 'WeatherError', code: 'unavailable' });
});

test('roundCoord and nextFetchAt', () => {
  assert.equal(roundCoord(39.4699), 39.47);
  assert.equal(roundCoord(-0.3763), -0.38);
  assert.equal(nextFetchAt('garbage', NOW), new Date(NOW.getTime() + MET_MIN_REFRESH_MS).toISOString());
  assert.equal(nextFetchAt('Wed, 26 Nov 2026 18:00:00 GMT', NOW), '2026-11-26T18:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

test('cachedForecast: fetches once, then serves the cache until it expires; 304 keeps the points', async () => {
  const cache = memoryCache();
  const fake = fakeFetch([metOk(metBody(3, 0)), () => new Response(null, { status: 304 })]);
  const first = await cachedForecast(forecastDeps(cache, fake.fetch), 39.4699, -0.3763);
  assert.equal(first.points.length, 3);
  assert.deepEqual([cache.rows[0]?.lat, cache.rows[0]?.lon, cache.rows[0]?.lastModified], [39.47, -0.38, 'Wed, 26 Nov 2026 11:19:17 GMT']);
  await cachedForecast(forecastDeps(cache, fake.fetch), 39.4699, -0.3763);
  assert.equal(fake.calls.length, 1, 'served from the cache');
  const later = new Date(NOW.getTime() + MET_MIN_REFRESH_MS + 60_000);
  const revalidated = await cachedForecast(forecastDeps(cache, fake.fetch, later), 39.47, -0.38);
  assert.equal(fake.calls.length, 2);
  assert.equal(revalidated.points.length, 3, '304 keeps the cached points');
  assert.equal(revalidated.fetchedAt, later.toISOString());
});

test('cachedForecast: a stale copy (< 24 h) when MET fails, an error without one', async () => {
  const stale: CachedForecast = {
    lat: 39.47,
    lon: -0.38,
    points: [{ t: '2026-11-26T11:00:00.000Z', temp: 9, wind: 10, mm: 0, prob: null, sym: 'cloudy', h: 1 }],
    issuedAt: null,
    fetchedAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
    expiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
    lastModified: null,
  };
  const failing = fakeFetch([() => new Response('', { status: 500 }), () => new Response('', { status: 500 })]);
  assert.equal((await cachedForecast(forecastDeps(memoryCache(stale), failing.fetch), 39.47, -0.38)).points.length, 1);
  await assert.rejects(cachedForecast(forecastDeps(memoryCache(), failing.fetch), 39.47, -0.38), { name: 'WeatherError' });
});

test('localHours: local dates and hours, 6-hour blocks spread with interpolated temperature', () => {
  const parsed = parseMetForecast(metBody(2, 2, (t) => (t === '2026-11-26T13:00:00Z' ? 3 : 0)));
  const hours = localHours(parsed?.points ?? [], 'Europe/Madrid', NOW, 9);
  assert.equal(hours[0]?.date, '2026-11-26');
  assert.equal(hours[0]?.hour, 12, '11:00Z is 12:00 in Madrid');
  assert.equal(hours.length, 2 + 12);
  const block = hours.slice(2, 8);
  assert.ok(block.every((h) => h.coarse && h.precipMm === 0.5 && h.symbol === 'rain'));
  assert.deepEqual(
    block.map((h) => h.tempC),
    [10.2, 10.3, 10.4, 10.5, 10.6, 10.7],
  );
  assert.deepEqual(localHours(parsed?.points ?? [], 'Europe/Madrid', new Date('2026-12-30T00:00:00Z'), 9), []);
});

test('forecastForPlace and the reader: the athlete city, MET source, null without a city', async () => {
  const fake = fakeFetch([metOk(metBody(3, 0))]);
  const deps = forecastDeps(memoryCache(), fake.fetch);
  const forecast = await forecastForPlace(deps, PLACE);
  assert.deepEqual([forecast.place, forecast.source, forecast.updatedAt, forecast.hours.length], ['Valencia', 'met_norway', '2026-11-26T11:19:17.000Z', 3]);
  const reader = createWeatherReader({ ...deps, places: { getPlace: async (id) => (id === USER ? PLACE : null) } });
  assert.equal((await reader.forecastFor(USER))?.place, 'Valencia');
  assert.equal(await reader.forecastFor('other'), null);
});

test('safeForecast never throws and gives up after its timeout', async () => {
  const failing = { forecastFor: async () => Promise.reject(new Error('boom')) };
  assert.equal(await safeForecast(failing, USER, silentLogger), null);
  const slow = { forecastFor: () => new Promise<never>(() => undefined) };
  assert.equal(await safeForecast(slow, USER, silentLogger, 5), null);
  assert.equal(await safeForecast(null, USER, silentLogger), null);
});

// ---------------------------------------------------------------------------
// Nominatim
// ---------------------------------------------------------------------------

const NOMINATIM_VALENCIA = [
  {
    lat: '39.4697065',
    lon: '-0.3763353',
    name: 'Valencia',
    display_name: 'Valencia, Comarca de València, Valencia, Comunidad Valenciana, España',
    address: { city: 'Valencia', province: 'Valencia', state: 'Comunidad Valenciana', country: 'España' },
  },
  { lat: '10.1620', lon: '-68.0077', name: 'Valencia', address: { state: 'Carabobo', country: 'Venezuela' } },
  { lat: '39.4697065', lon: '-0.3763353', name: 'Valencia', address: { state: 'Comunidad Valenciana', country: 'España' } },
  { lat: 'x', lon: '1', name: 'Roto' },
];

function geocodeDeps(fetch: FetchLike, overrides: Partial<GeocodeDeps> = {}): GeocodeDeps & { cache: GeocodeCache & { rows: Map<string, PlaceResult[]> } } {
  const rows = new Map<string, PlaceResult[]>();
  const cache = {
    rows,
    async get(query: string) {
      const results = rows.get(query);
      return results ? { results, fetchedAt: NOW.toISOString() } : null;
    },
    async put(query: string, results: PlaceResult[]) {
      rows.set(query, results);
    },
  };
  return { cache, throttle: { reserve: async () => true }, fetch, now: () => NOW, logger: silentLogger, sleep: async () => undefined, ...overrides } as GeocodeDeps & {
    cache: typeof cache;
  };
}

test('normalizeQuery and parseNominatim', () => {
  assert.equal(normalizeQuery('  Las   Palmas '), 'las palmas');
  assert.equal(normalizeQuery('a'), null);
  assert.equal(normalizeQuery('x'.repeat(81)), null);
  assert.equal(normalizeQuery(12), null);
  assert.deepEqual(parseNominatim(NOMINATIM_VALENCIA), [
    { name: 'Valencia', detail: 'Comunidad Valenciana, España', lat: 39.4697, lon: -0.3763 },
    { name: 'Valencia', detail: 'Carabobo, Venezuela', lat: 10.162, lon: -68.0077 },
  ]);
  assert.deepEqual(parseNominatim({}), []);
});

test('searchPlaces: Nominatim with our User-Agent, no autocomplete params, cached afterwards', async () => {
  const fake = fakeFetch([() => new Response(JSON.stringify(NOMINATIM_VALENCIA), { status: 200 })]);
  const deps = geocodeDeps(fake.fetch);
  const results = await searchPlaces(deps, 'valencia');
  assert.equal(results.length, 2);
  const url = new URL(fake.calls[0]?.url ?? '');
  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(url.searchParams.get('q'), 'valencia');
  assert.equal(url.searchParams.get('format'), 'jsonv2');
  assert.equal(url.searchParams.get('featureType'), 'settlement');
  assert.equal(fake.calls[0]?.headers['User-Agent'], WEATHER_USER_AGENT);
  assert.deepEqual(await searchPlaces(deps, 'valencia'), results);
  assert.equal(fake.calls.length, 1, 'second search from the cache');
});

test('searchPlaces: one request per second for the whole app (waits once, then 429)', async () => {
  const reserves: number[] = [];
  const busy = { reserve: async (_p: string, ms: number) => (reserves.push(ms), false) };
  const fake = fakeFetch([]);
  await assert.rejects(searchPlaces(geocodeDeps(fake.fetch, { throttle: busy }), 'madrid'), { name: 'WeatherError', code: 'rate_limited' });
  assert.deepEqual(reserves, [NOMINATIM_MIN_INTERVAL_MS, NOMINATIM_MIN_INTERVAL_MS]);
  assert.equal(fake.calls.length, 0);
  let calls = 0;
  const later = { reserve: async () => (calls += 1) > 1 };
  const ok = fakeFetch([() => new Response('[]', { status: 200 })]);
  assert.deepEqual(await searchPlaces(geocodeDeps(ok.fetch, { throttle: later }), 'madrid'), []);
  const down = fakeFetch([() => new Response('', { status: 503 })]);
  await assert.rejects(searchPlaces(geocodeDeps(down.fetch), 'madrid'), { name: 'WeatherError', code: 'unavailable' });
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function httpDeps(overrides: Partial<WeatherHttpDeps> = {}, metResponses: (() => Response)[] = [metOk(metBody(3, 0))]): WeatherHttpDeps {
  const met = fakeFetch(metResponses);
  const nominatim = fakeFetch([() => new Response(JSON.stringify(NOMINATIM_VALENCIA), { status: 200 })]);
  return {
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer ok' ? USER : null),
    places: { getPlace: async () => PLACE },
    forecast: forecastDeps(memoryCache(), met.fetch),
    geocode: geocodeDeps(nominatim.fetch),
    logger: silentLogger,
    ...overrides,
  };
}

const post = (body: unknown, token = 'ok') =>
  new Request('https://x.supabase.co/functions/v1/weather', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

test('parseWeatherRequest', () => {
  assert.deepEqual(parseWeatherRequest({ action: 'forecast', extra: 1 }), { action: 'forecast' });
  assert.deepEqual(parseWeatherRequest({ action: 'search', query: ' Bilbao ' }), { action: 'search', query: 'bilbao' });
  assert.equal(parseWeatherRequest({ action: 'search', query: 'b' }), null);
  assert.equal(parseWeatherRequest({ action: 'delete' }), null);
  assert.equal(parseWeatherRequest(null), null);
});

test('POST forecast: the city of the profile, null without one; search: places', async () => {
  const res = await handleWeatherHttp(post({ action: 'forecast' }), httpDeps());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as { forecast: { place: string; hours: unknown[] } };
  assert.deepEqual([body.forecast.place, body.forecast.hours.length], ['Valencia', 3]);

  const none = await handleWeatherHttp(post({ action: 'forecast' }), httpDeps({ places: { getPlace: async () => null } }));
  assert.deepEqual(await none.json(), { forecast: null });

  const search = await handleWeatherHttp(post({ action: 'search', query: 'Valencia' }), httpDeps());
  assert.equal(((await search.json()) as { places: unknown[] }).places.length, 2);
});

test('POST errors: 401, 400, 405, 503 weather_unavailable, 429 rate_limited, 500', async () => {
  assert.equal((await handleWeatherHttp(post({ action: 'forecast' }, 'bad'), httpDeps())).status, 401);
  assert.equal((await handleWeatherHttp(post({ action: 'search', query: '' }), httpDeps())).status, 400);
  assert.equal((await handleWeatherHttp(new Request('https://x/weather', { method: 'GET' }), httpDeps())).status, 405);
  assert.equal((await handleWeatherHttp(new Request('https://x/weather', { method: 'OPTIONS' }), httpDeps())).status, 204);
  const down = await handleWeatherHttp(post({ action: 'forecast' }), httpDeps({}, [() => new Response('', { status: 500 })]));
  assert.equal(down.status, 503);
  assert.equal(((await down.json()) as { error: string }).error, 'weather_unavailable');
  const busy = httpDeps();
  const limited = await handleWeatherHttp(post({ action: 'search', query: 'Madrid' }), { ...busy, geocode: { ...busy.geocode, throttle: { reserve: async () => false } } });
  assert.equal(limited.status, 429);
  const broken = await handleWeatherHttp(post({ action: 'forecast' }), httpDeps({ places: { getPlace: async () => Promise.reject(new Error('db')) } }));
  assert.equal(broken.status, 500);
});

// ---------------------------------------------------------------------------
// Prompt context (coach and briefing)
// ---------------------------------------------------------------------------

function hoursOf(date: string, rain: (h: number) => number) {
  return Array.from({ length: 24 }, (_, hour) => ({
    date,
    hour,
    tempC: 12,
    windKmh: 15,
    precipMm: rain(hour),
    precipProb: null,
    symbol: rain(hour) > 0 ? 'rain' : 'cloudy',
    coarse: false,
  }));
}

const run = (overrides: Partial<Workout> = {}): Workout => ({
  id: 'w1',
  userId: USER,
  date: '2026-11-27',
  startTime: '18:00',
  sport: 'run',
  title: 'Rodaje suave',
  description: null,
  durationMin: 50,
  distanceM: null,
  intensity: 'endurance',
  tss: null,
  steps: [],
  status: 'planned',
  completed: null,
  source: 'rules',
  isKey: false,
  jointSessionId: null,
  externalId: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  ...overrides,
});

test('weatherForCoach: one row per day of the coming week with its dry stretches', () => {
  const forecast = { place: 'Valencia', source: 'met_norway' as const, updatedAt: '', hours: [...hoursOf('2026-11-27', (h) => (h >= 8 && h < 14 ? 1.5 : 0)), ...hoursOf('2026-11-28', () => 2)] };
  const ctx = weatherForCoach(forecast, '2026-11-27');
  assert.deepEqual(ctx, {
    place: 'Valencia',
    source: 'MET Norway',
    days: [
      { date: '2026-11-27', weekday: 'viernes', summary: 'lluvia entre las 8 y las 14; seco entre las 14 y las 22', dryGaps: ['14:00–22:00'], rainHours: 6, tempMin: 12, tempMax: 12, windMaxKmh: 15 },
      { date: '2026-11-28', weekday: 'sábado', summary: 'lluvia casi todo el día', dryGaps: [], rainHours: 15, tempMin: 12, tempMax: 12, windMaxKmh: 15 },
    ],
  });
  assert.equal(weatherForCoach({ ...forecast, hours: [] }, '2026-11-27'), null);
});

test('weatherForBriefing: only when an outdoor session today falls in the rain, with its dry gap', () => {
  const forecast = { place: 'Valencia', source: 'met_norway' as const, updatedAt: '', hours: hoursOf('2026-11-27', (h) => (h >= 17 && h < 21 ? 1.5 : 0)) };
  const base = { forecast, date: '2026-11-27', today: '2026-11-26', busy: [{ start: '08:00', end: '15:00' }], now: NOW, timezone: 'Europe/Madrid' };
  assert.deepEqual(weatherForBriefing({ ...base, workouts: [run(), run({ id: 's', sport: 'swim', title: 'Técnica' })] }), {
    place: 'Valencia',
    source: 'MET Norway',
    sessions: [{ title: 'Rodaje suave', startTime: '18:00', trouble: 'rain', rain: 'a las 18', dryGap: 'entre las 15 y las 17', advice: 'Sal a correr entre las 15 y las 17: no llueve' }],
  });
  assert.equal(weatherForBriefing({ ...base, workouts: [run({ startTime: '12:00' })] }), null, 'dry at its time: nothing to say');
  const noGap = weatherForBriefing({ ...base, busy: [{ start: '07:00', end: '17:00' }], workouts: [run()] });
  assert.equal((noGap?.sessions as { advice: string }[])[0]?.advice, 'Llueve y no hay un hueco seco: mejor rodillo o piscina');
});

// ---------------------------------------------------------------------------
// Wind (gusts when MET gives them; strong wind joins the rain, a notice stays silent)
// ---------------------------------------------------------------------------

test('parseMetForecast: gusts in km/h when MET gives them (/complete, Nordic area), absent otherwise', () => {
  const step = (time: string, details: Record<string, number>) => ({ time, data: { instant: { details }, next_1_hours: { details: { precipitation_amount: 0 } } } });
  const parsed = parseMetForecast({ properties: { timeseries: [step('2026-11-26T11:00:00Z', { wind_speed: 10, wind_speed_of_gust: 16 }), step('2026-11-26T12:00:00Z', { wind_speed: 10 })] } });
  assert.equal(parsed?.points[0]?.gust, 58);
  assert.equal(parsed?.points[0]?.wind, 36);
  assert.equal('gust' in (parsed?.points[1] ?? {}), false);
  const hours = localHours(parsed?.points ?? [], 'Europe/Madrid', NOW, 9);
  assert.equal(hours[0]?.gustKmh, 58);
  assert.equal('gustKmh' in (hours[1] ?? {}), false, 'no gust: the field is left out');
});

function windyHours(date: string, wind: (h: number) => number, gust?: (h: number) => number) {
  return hoursOf(date, () => 0).map((h) => ({ ...h, windKmh: wind(h.hour), ...(gust ? { gustKmh: gust(h.hour) } : {}) }));
}

test('weatherForCoach: strong wind hours, gusts and the summary say when it blows', () => {
  const forecast = { place: 'Valencia', source: 'met_norway' as const, updatedAt: '', hours: windyHours('2026-11-27', (h) => (h >= 14 && h < 20 ? 40 : 12), (h) => (h >= 14 && h < 20 ? 60 : 20)) };
  const [day] = (weatherForCoach(forecast, '2026-11-27')?.days ?? []) as Record<string, unknown>[];
  assert.equal(day?.summary, 'seco todo el día; viento fuerte entre las 14 y las 20');
  assert.equal(day?.strongWindHours, 6);
  assert.equal(day?.gustMaxKmh, 60);
  assert.equal(day?.windMaxKmh, 40);
});

test('weatherForBriefing: strong wind on the bike joins the briefing with a calmer gap; a breeze or the same wind on a run stays silent', () => {
  const bike = run({ sport: 'bike', title: 'Rodaje en bici', durationMin: 90 });
  const base = { date: '2026-11-27', today: '2026-11-26', busy: [], now: NOW, timezone: 'Europe/Madrid' };
  const windy = { place: 'Valencia', source: 'met_norway' as const, updatedAt: '', hours: windyHours('2026-11-27', (h) => (h >= 15 ? 38 : 12)) };
  assert.deepEqual(weatherForBriefing({ ...base, forecast: windy, workouts: [bike] }), {
    place: 'Valencia',
    source: 'MET Norway',
    sessions: [
      {
        title: 'Rodaje en bici',
        startTime: '18:00',
        trouble: 'wind',
        rain: null,
        wind: 'viento fuerte (38 km/h) entre las 18 y las 20',
        dryGap: 'entre las 7 y las 15',
        advice: 'Sal en bici entre las 7 y las 15: hay menos viento',
      },
    ],
  });
  assert.equal(weatherForBriefing({ ...base, forecast: windy, workouts: [run()] }), null, '38 km/h bothers a run but is no reason to move it');
  const breezy = { ...windy, hours: windyHours('2026-11-27', () => 28) };
  assert.equal(weatherForBriefing({ ...base, forecast: breezy, workouts: [bike] }), null, 'a notice is only a line in the app');
});
