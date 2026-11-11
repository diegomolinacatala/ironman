import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import ProposalScreen from '@/app/proposal/[id]';
import type { PlanChange, PlanProposal } from '@/domain/types';

import { buildDiffRows } from '../proposalDiff';
import type { ProposalReview } from '../useProposalReview';
import { makeProposal } from './fixtures';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockHeader: { left: (() => ReactElement) | null } = { left: null };
const DEFAULT_PROPOSAL = makeProposal({ changes: [{ op: 'delete', workoutId: 'w1', reason: 'Descanso' }] });
const mockProposal: { data: PlanProposal } = { data: DEFAULT_PROPOSAL };
let mockReview: ProposalReview;

const ADD_SERIES: PlanChange = {
  op: 'add',
  workout: {
    date: '2026-10-29',
    sport: 'run',
    title: "Series 3×8'",
    durationMin: 55,
    intensity: 'threshold',
    steps: [
      { kind: 'warmup', durationMin: 15, intensity: 'recovery' },
      { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', cue: 'Mismo ritmo en las tres.' },
      { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
    ],
    coaching: { objective: 'Subir tu umbral sin pasarte.', keys: [], success: 'Las tres series en zona.', planB: null },
  },
  reason: 'La sesión clave de la semana',
};

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ id: 'p1' }),
  Stack: {
    Screen: ({ options }: { options: { headerLeft?: () => ReactElement } }) => {
      mockHeader.left = options.headerLeft ?? null;
      return null;
    },
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/queries', () => ({
  useProposal: () => ({ data: mockProposal.data, isLoading: false, error: null, refetch: jest.fn() }),
}));
jest.mock('../useProposalReview', () => ({ useProposalReview: () => mockReview }));

function review(overrides: Partial<ProposalReview> = {}): ProposalReview {
  return {
    rows: [],
    selected: [true],
    selectedCount: 1,
    toggle: jest.fn(),
    setAll: jest.fn(),
    preview: null,
    isLoadingWeek: false,
    weekError: null,
    reloadWeek: jest.fn(),
    outcome: null,
    actionError: null,
    isApplying: false,
    isDiscarding: false,
    apply: jest.fn(async () => undefined),
    discard: jest.fn(async () => false),
    ...overrides,
  };
}

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockHeader.left = null;
  mockProposal.data = DEFAULT_PROPOSAL;
  mockReview = review();
});

describe('Propuesta', () => {
  test('a pending proposal can be closed from the header to review it later', async () => {
    await render(<ProposalScreen />);
    expect(mockHeader.left).not.toBeNull();
    const HeaderLeft = mockHeader.left!;
    await render(<HeaderLeft />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test('an apply error is shown once, next to the apply button', async () => {
    mockReview = review({ actionError: 'No se han podido aplicar los cambios.' });
    await render(<ProposalScreen />);
    expect(screen.getAllByText('No se han podido aplicar los cambios.')).toHaveLength(1);
    const footer = within(screen.getByTestId('proposal-footer'));
    expect(footer.getByText('No se han podido aplicar los cambios.')).toBeTruthy();
    expect(footer.getByRole('button', { name: /Aplicar 1 cambio/ })).toBeTruthy();
  });
});

describe('Propuesta — what the coach proposes', () => {
  test('the header is one sentence; the rest of the summary supports it and the model is not shown', async () => {
    mockProposal.data = makeProposal({
      summary: 'Hoy: ámbar (52/100). Fatiga alta y VFC baja: paso las series al viernes.',
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    });
    await render(<ProposalScreen />);
    expect(screen.getByRole('header', { name: 'Hoy: ámbar (52/100).' })).toBeTruthy();
    expect(screen.getByText('Fatiga alta y VFC baja: paso las series al viernes.')).toBeTruthy();
    expect(screen.queryByText(/Modelo/)).toBeNull();
    expect(screen.queryByText(/llama/)).toBeNull();
  });

  test('an added session shows its objective, its main target and its steps on demand', async () => {
    mockProposal.data = makeProposal({ changes: [ADD_SERIES] });
    const rows = buildDiffRows([ADD_SERIES], [], {}, { thresholds: { lthr: 170 }, raceDistance: null });
    mockReview = review({ rows });
    await render(<ProposalScreen />);
    expect(screen.getByText("Series 3×8'")).toBeTruthy();
    expect(screen.getByText('Subir tu umbral sin pasarte.')).toBeTruthy();
    expect(screen.getByText("3×8' Z4 · 162–168 ppm · RPE 7–8")).toBeTruthy();
    // The checkbox reads the whole change, objective and target included.
    expect(screen.getByRole('checkbox', { name: /Subir tu umbral sin pasarte\. Intensidad: 3×8' Z4 · 162–168 ppm/ })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Ver la estructura, 3 pasos' }));
    expect(screen.getByLabelText("Series · Z4: 3×8'. 162–168 ppm, RPE 7–8. Mismo ritmo en las tres.")).toBeTruthy();
    expect(screen.getByText('Calentamiento · Z1')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ocultar la estructura' }));
    expect(screen.queryByText('Mismo ritmo en las tres.')).toBeNull();
  });
});
