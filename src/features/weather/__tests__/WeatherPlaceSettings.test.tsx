import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { WeatherPlace, WeatherPlaceOption } from '@/domain/types';

import { WeatherPlaceSettings } from '../WeatherPlaceSettings';

const VALENCIA: WeatherPlaceOption = { name: 'Valencia', detail: 'Comunidad Valenciana, España', lat: 39.4699, lon: -0.3763 };

const mockState: { mode: 'demo' | 'supabase'; place: WeatherPlace | null; results: WeatherPlaceOption[] | undefined } = {
  mode: 'supabase',
  place: null,
  results: undefined,
};
const mockSearch = jest.fn((_query: string) => undefined);
const mockUpdate = jest.fn(async (_patch: { weatherPlace: WeatherPlace | null }) => undefined);
const mockOpenBrowser = jest.fn(async (_url: string) => ({ type: 'dismiss' }));
const mockConfirm = jest.fn(async (_opts: unknown) => true);

jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));
jest.mock('@/features/settings/confirm', () => ({ confirmAction: (opts: unknown) => mockConfirm(opts) }));
jest.mock('@/data/context', () => ({ useAuth: () => ({ mode: mockState.mode }) }));
jest.mock('@/data/queries', () => ({
  useProfile: () => ({ isLoading: false, data: { weatherPlace: mockState.place } }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdate, isPending: false, error: null }),
  useSearchWeatherPlaces: () => ({ mutate: mockSearch, reset: jest.fn(), isPending: false, error: null, data: mockState.results }),
}));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockState.mode = 'supabase';
  mockState.place = null;
  mockState.results = undefined;
});

describe('Tu ciudad para el tiempo', () => {
  test('one search per tap on Buscar, never while typing; too short asks for more', async () => {
    await render(<WeatherPlaceSettings />);
    await fireEvent.changeText(screen.getByLabelText('Busca tu ciudad'), 'V');
    expect(mockSearch).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));
    expect(mockSearch).not.toHaveBeenCalled();
    expect(screen.getByText('Escribe al menos dos letras.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Busca tu ciudad'), '  Valencia  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));
    expect(mockSearch).toHaveBeenCalledWith('Valencia');
  });

  test('picking a result stores the city (name and coordinates) on the profile', async () => {
    mockState.results = [VALENCIA];
    await render(<WeatherPlaceSettings />);
    await fireEvent.press(screen.getByText('Valencia'));
    expect(mockUpdate).toHaveBeenCalledWith({ weatherPlace: { name: 'Valencia', lat: 39.4699, lon: -0.3763 } });
  });

  test('no results: a calm hint', async () => {
    mockState.results = [];
    await render(<WeatherPlaceSettings />);
    expect(screen.getByText(/No encuentro esa ciudad/)).toBeTruthy();
  });

  test('with a city: shows it and removes it after confirming', async () => {
    mockState.place = { name: 'Bilbao', lat: 43.26, lon: -2.93 };
    await render(<WeatherPlaceSettings />);
    expect(screen.getByText('Bilbao')).toBeTruthy();
    expect(screen.getByLabelText('Cambiar de ciudad')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar' }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({ weatherPlace: null });
  });

  test('credits: OpenStreetMap for the search and MET Norway (links to the licence)', async () => {
    await render(<WeatherPlaceSettings />);
    expect(screen.getByText('Búsqueda de ciudades: © colaboradores de OpenStreetMap.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: /Datos del tiempo: MET Norway/ }));
    expect(mockOpenBrowser).toHaveBeenCalledWith('https://api.met.no/doc/License');
  });

  test('demo mode says the cities and the weather are examples', async () => {
    mockState.mode = 'demo';
    await render(<WeatherPlaceSettings />);
    expect(screen.getByText('En el modo demo las ciudades y el tiempo son de ejemplo.')).toBeTruthy();
    expect(screen.queryByText('Datos del tiempo: MET Norway')).toBeNull();
  });
});
