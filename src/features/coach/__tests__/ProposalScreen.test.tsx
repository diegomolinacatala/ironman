import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import ProposalScreen from '@/app/proposal/[id]';
import type { PlanProposal } from '@/domain/types';

import type { ProposalReview } from '../useProposalReview';
import { makeProposal } from './fixtures';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockHeader: { left: (() => ReactElement) | null } = { left: null };
const mockProposal: { data: PlanProposal } = { data: makeProposal({ changes: [{ op: 'delete', workoutId: 'w1', reason: 'Descanso' }] }) };
let mockReview: ProposalReview;

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
