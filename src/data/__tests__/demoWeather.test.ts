/// <reference types="jest" />
import { profilePatchToRow, rowToProfile, weatherPlaceOf } from '../supabase/mappers';
import { parseForecast, parsePlaces } from '../supabase/weatherApi';
import { demoForecast, searchDemoPlaces } from '../demo/repo/weatherDemo';
import { SUNDAY, resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

describe('demo weather', () => {
  it('city search: accent-insensitive, names starting with the query first, validated', async () => {
    expect(searchDemoPlaces('malaga').map((p) => p.name)).toEqual(['Málaga']);
    expect(searchDemoPlaces('valencia').map((p) => p.detail)).toEqual(['Comunidad Valenciana, España', 'Carabobo, Venezuela']);
    const repo = await signedInRepo();
    await expect(repo.searchWeatherPlaces?.('b')).rejects.toMatchObject({ code: 'validation' });
    await repo.store.dispose();
  });

  it('no city, no forecast; with one, an example forecast from now, marked as demo', async () => {
    const repo = await signedInRepo();
    await expect(repo.getWeather?.()).resolves.toBeNull();
    await repo.upsertMyProfile({ weatherPlace: { name: 'Bilbao', lat: 43.263, lon: -2.935 } });
    const forecast = await repo.getWeather?.();
    expect(forecast).toMatchObject({ place: 'Bilbao', source: 'demo' });
    expect(forecast?.hours[0]).toMatchObject({ date: '2026-10-25', hour: SUNDAY.getHours(), coarse: false });
    expect(forecast?.hours.some((h) => h.coarse)).toBe(true);
    await repo.store.dispose();
  });

  it('deterministic: the same city and day give the same forecast', () => {
    expect(demoForecast('Vigo', '2026-10-25', SUNDAY)).toEqual(demoForecast('Vigo', '2026-10-25', SUNDAY));
  });
});

describe('weather function answers (defensive parsing)', () => {
  it('forecast: bad hours dropped, null without a forecast', () => {
    const forecast = parseForecast({
      forecast: {
        place: 'Vigo',
        source: 'met_norway',
        updatedAt: '2026-10-25T05:00:00Z',
        hours: [
          { date: '2026-10-25', hour: 18, tempC: 14, windKmh: 9, precipMm: 1.2, precipProb: null, symbol: 'rain', coarse: false },
          { date: '2026-10-25', hour: 24, precipMm: 0 },
          { date: 'mañana', hour: 3, precipMm: 0 },
          'x',
        ],
      },
    });
    expect(forecast?.hours).toEqual([{ date: '2026-10-25', hour: 18, tempC: 14, windKmh: 9, precipMm: 1.2, precipProb: null, symbol: 'rain', coarse: false }]);
    expect(parseForecast({ forecast: null })).toBeNull();
    expect(parseForecast('oops')).toBeNull();
  });

  it('places: only rows with a name and valid coordinates', () => {
    expect(parsePlaces({ places: [{ name: ' Vigo ', detail: 'Galicia, España', lat: 42.24, lon: -8.72 }, { name: 'X', lat: 120, lon: 0 }, { lat: 1, lon: 1 }] })).toEqual([
      { name: 'Vigo', detail: 'Galicia, España', lat: 42.24, lon: -8.72 },
    ]);
    expect(parsePlaces(null)).toEqual([]);
  });
});

describe('profile columns of the city', () => {
  it('all three or none', () => {
    expect(weatherPlaceOf({ weather_place: ' Vigo ', weather_lat: '42.24', weather_lon: -8.72 })).toEqual({ name: 'Vigo', lat: 42.24, lon: -8.72 });
    expect(weatherPlaceOf({ weather_place: 'Vigo', weather_lat: null, weather_lon: -8.72 })).toBeNull();
    expect(weatherPlaceOf({})).toBeNull();
  });

  it('patch: undefined leaves them, null clears the three', () => {
    expect(profilePatchToRow({ displayName: 'Ana' })).not.toHaveProperty('weather_place');
    expect(profilePatchToRow({ weatherPlace: null })).toMatchObject({ weather_place: null, weather_lat: null, weather_lon: null });
    expect(profilePatchToRow({ weatherPlace: { name: 'Vigo', lat: 42.24, lon: -8.72 } })).toMatchObject({ weather_place: 'Vigo', weather_lat: 42.24, weather_lon: -8.72 });
  });

  it('a server without the columns reads as no city', () => {
    const profile = rowToProfile({
      id: 'u1',
      username: 'ana',
      display_name: 'Ana',
      avatar_url: null,
      sports: ['run'],
      level: 'intermediate',
      thresholds: {},
      availability: {},
      visibility: 'full',
      notification_prefs: {},
      timezone: 'Europe/Madrid',
      created_at: '2026-10-01T10:00:00Z',
    } as unknown as Parameters<typeof rowToProfile>[0]);
    expect(profile.weatherPlace).toBeUndefined();
  });
});
