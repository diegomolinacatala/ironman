/**
 * Weather-aware training (20261128000600_weather.sql): the athlete's city on the profile (own row,
 * all three columns or none, valid coordinates), the forecast and city-search caches (service role
 * only, no client access), and svc_reserve_provider_call spacing calls to a provider for the whole
 * app (service role only).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface PlaceRow {
  weather_place: string | null;
  weather_lat: number | null;
  weather_lon: number | null;
}

describe('weather (city, caches and provider spacing)', () => {
  let t: TestDb;
  let ana: string;
  let bea: string;

  const placeOf = async (user: string): Promise<PlaceRow | undefined> =>
    (await t.admin<PlaceRow>('select weather_place, weather_lat, weather_lon from public.profiles where id = $1', [user]))[0];

  before(async () => {
    t = await createTestDb();
    ana = await t.createUser({ email: 'wx-ana@example.com' });
    bea = await t.createUser({ email: 'wx-bea@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('a new profile has no city', async () => {
    assert.deepEqual(await placeOf(ana), { weather_place: null, weather_lat: null, weather_lon: null });
  });

  test('the athlete sets and clears their own city; nobody else can', async () => {
    const set = `update public.profiles set weather_place = $2, weather_lat = $3, weather_lon = $4 where id = $1 returning id`;
    assert.equal((await t.asUser(ana, set, [ana, 'Valencia', 39.4699, -0.3763])).length, 1);
    assert.deepEqual(await placeOf(ana), { weather_place: 'Valencia', weather_lat: 39.4699, weather_lon: -0.3763 });

    assert.equal((await t.asUser(bea, set, [ana, 'Bilbao', 43.263, -2.935])).length, 0, 'bea cannot change ana');
    assert.equal((await placeOf(ana))?.weather_place, 'Valencia');

    await t.asUser(ana, 'update public.profiles set weather_place = null, weather_lat = null, weather_lon = null where id = $1', [ana]);
    assert.deepEqual(await placeOf(ana), { weather_place: null, weather_lat: null, weather_lon: null });
  });

  test('all three or none, a name of 1–120 characters and real coordinates', async () => {
    const set = (place: unknown, lat: unknown, lon: unknown) =>
      t.asUser(ana, 'update public.profiles set weather_place = $2, weather_lat = $3, weather_lon = $4 where id = $1', [ana, place, lat, lon]);
    const check = pgError({ code: '23514' });
    await assert.rejects(set('Valencia', null, null), check);
    await assert.rejects(set(null, 39.47, -0.37), check);
    await assert.rejects(set('   ', 39.47, -0.37), check);
    await assert.rejects(set('x'.repeat(121), 39.47, -0.37), check);
    await assert.rejects(set('Polo', 91, 0), check);
    await assert.rejects(set('Antimeridiano', 0, 181), check);
    await set('Ushuaia', -54.8019, -68.303);
    assert.equal((await placeOf(ana))?.weather_place, 'Ushuaia');
  });

  test('the caches and the call log are invisible to the app', async () => {
    for (const table of ['weather_forecasts', 'geocode_results', 'provider_calls']) {
      await assert.rejects(t.asUser(ana, `select * from public.${table}`), pgError({ code: '42501' }), `${table}: no select`);
      await assert.rejects(t.asAnon(`select * from public.${table}`), pgError({ code: '42501' }), `${table}: no anon`);
    }
    await assert.rejects(
      t.asUser(ana, `insert into public.geocode_results (query, results) values ('valencia', '[]')`),
      pgError({ code: '42501' }),
    );
  });

  test('the service role caches forecasts per rounded coordinates and searches per query', async () => {
    const points = JSON.stringify([{ t: '2026-11-26T11:00:00.000Z', temp: 8, wind: 4, mm: 0, prob: null, sym: 'clearsky_day', h: 1 }]);
    await t.asService(
      `insert into public.weather_forecasts (lat, lon, points, issued_at, expires_at, last_modified)
       values (39.47, -0.38, $1::jsonb, now(), now() + interval '90 minutes', 'Wed, 26 Nov 2026 11:19:17 GMT')`,
      [points],
    );
    await t.asService(
      `insert into public.weather_forecasts (lat, lon, points, expires_at) values (39.47, -0.38, '[]', now())
       on conflict (lat, lon) do update set points = excluded.points, expires_at = excluded.expires_at`,
    );
    const [row] = await t.asService<{ lat: string; lon: string; points: unknown[] }>('select lat::text, lon::text, points from public.weather_forecasts');
    assert.deepEqual(row, { lat: '39.47', lon: '-0.38', points: [] });
    await assert.rejects(t.asService(`insert into public.weather_forecasts (lat, lon, points, expires_at) values (95, 0, '[]', now())`), pgError({ code: '23514' }));

    await t.asService(`insert into public.geocode_results (query, results) values ('valencia', '[{"name":"Valencia"}]')`);
    await assert.rejects(t.asService(`insert into public.geocode_results (query, results) values ('v', '[]')`), pgError({ code: '23514' }));
  });

  test('svc_reserve_provider_call spaces calls for the whole app and is service-only', async () => {
    const reserve = async (interval: number): Promise<boolean> =>
      (await t.asService<{ ok: boolean }>('select public.svc_reserve_provider_call($1, $2) as ok', ['nominatim', interval]))[0]?.ok === true;
    assert.equal(await reserve(60_000), true, 'first call goes');
    assert.equal(await reserve(60_000), false, 'a second one within a minute waits');
    assert.equal(await reserve(0), true, 'with no spacing it goes');
    assert.equal(
      (await t.asService<{ ok: boolean }>('select public.svc_reserve_provider_call($1, $2) as ok', ['met_norway', 60_000]))[0]?.ok,
      true,
      'providers are spaced independently',
    );
    await assert.rejects(t.asService('select public.svc_reserve_provider_call($1, 0)', ['otro']), pgError({ code: '22023', hint: 'validation' }));
    await assert.rejects(t.asUser(ana, 'select public.svc_reserve_provider_call($1, 0)', ['nominatim']), pgError({ code: '42501' }));
    await assert.rejects(t.asAnon('select public.svc_reserve_provider_call($1, 0)', ['nominatim']), pgError({ code: '42501' }));
  });

  test('deleting the account takes the city with it; the shared caches stay', async () => {
    await t.admin('delete from auth.users where id = $1', [bea]);
    assert.equal((await t.admin('select 1 from public.profiles where id = $1', [bea])).length, 0);
    assert.equal((await t.admin('select 1 from public.geocode_results')).length, 1);
  });
});
