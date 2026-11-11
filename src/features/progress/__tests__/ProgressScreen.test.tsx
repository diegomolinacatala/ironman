/**
 * Progreso tab against the seeded demo repository (real query hooks): the sections render in
 * order and each one leads to its detail screen.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import ProgressScreen from '@/app/(tabs)/progress';
import { AuthContext, RepositoryContext } from '@/data/context';
import { createDemoRepository, type DemoRepository } from '@/data/demo/DemoRepository';
import type { Repository } from '@/data/repository';
import { RecoveryCard } from '@/features/progress/RecoveryCard';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

jest.setTimeout(30000);

let repo: DemoRepository;
let userId = '';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return (
    <RepositoryContext.Provider value={repo as Repository}>
      <AuthContext.Provider value={{ session: { userId, email: null }, isLoading: false }}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AuthContext.Provider>
    </RepositoryContext.Provider>
  );
}

async function renderProgress() {
  await render(
    <Providers>
      <ProgressScreen />
    </Providers>,
  );
  // The races section appears once workouts and races have loaded.
  await screen.findByText('Carreras', {}, { timeout: 10000 });
}

beforeEach(async () => {
  jest.clearAllMocks();
  repo = createDemoRepository({ persistDebounceMs: 0, friendDelayMs: 60_000 });
  userId = (await repo.auth.signInWithApple()).userId;
});

afterEach(async () => {
  await repo.store.dispose();
});

describe('Progreso tab', () => {
  test('renders the sections in order: forma, volumen, recuperación, nutrición, carreras', async () => {
    await renderProgress();
    const headers = screen.getAllByRole('header').map((h) => String(h.props.children));
    const order = ['Tu forma', 'Volumen y cumplimiento', 'Recuperación', 'Nutrición', 'Carreras'];
    const positions = order.map((title) => headers.indexOf(title));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(screen.getByText('Progreso')).toBeTruthy();
  });

  test('shows a single races entry (no duplicate countdown or links card)', async () => {
    await renderProgress();
    expect(screen.getAllByText('Carreras')).toHaveLength(1);
    expect(screen.queryByText('Próxima carrera')).toBeNull();
    expect(screen.queryByText('Calendario de carreras y prioridades A/B/C')).toBeNull();
  });

  test('the races card opens Carreras', async () => {
    await renderProgress();
    const card = screen.getByRole('button', { name: /para .*Ver carreras\.$|Sin carrera a la vista/ });
    await fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalledWith('/races');
  });

  test('the nutrition section opens the log and the meal camera', async () => {
    await renderProgress();
    expect(await screen.findByText(/comidas? apuntadas?|Nada apuntado todavía/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Lo que has comido hoy/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/nutrition');
    await fireEvent.press(screen.getByRole('button', { name: 'Foto de tu comida' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/meal?source=camera');
  });

  test('recovery links to Conexiones', async () => {
    await renderProgress();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Conexiones' })[0]!);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/integrations');
  });

  test('a COROS athlete without recovery data is told how COROS arrives (never "Garmin")', async () => {
    await repo.upsertMyProfile({ watchBrand: 'coros' });
    await render(
      <Providers>
        <RecoveryCard series={[]} />
      </Providers>,
    );
    expect(await screen.findByText('Conecta tu COROS (Apple Salud y tu Claude) para ver tu VFC, tu pulso en reposo y tu sueño.')).toBeTruthy();
    expect(screen.queryByText(/Garmin/)).toBeNull();
  });
});
