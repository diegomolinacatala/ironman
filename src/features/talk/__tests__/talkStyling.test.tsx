/**
 * "Calm endurance" styling of the voice coach and its proposals: the accent is the one primary,
 * highlights use the soft brand tint, diffs carry a status colour plus an icon, and every
 * text pair we introduced reads in both light and dark.
 */
import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import type { QuedadaSuggestion } from '@/domain/types';
import { ChangeRow, opColor } from '@/features/coach/ChangeRow';
import type { DiffRow } from '@/features/coach/proposalDiff';
import { contrastRatio } from '@/ui';
import { makeTheme } from '@/ui/theme';

import { MicButton } from '../MicButton';
import { QuedadaSuggestionCard } from '../QuedadaSuggestionCard';
import { UserBubble } from '../TurnView';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const light = makeTheme(false).colors;
const dark = makeTheme(true).colors;

function styleOf(element: { props: { style?: unknown } }): ViewStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) ?? {};
}

const row: DiffRow = {
  index: 0,
  op: 'delete',
  opLabel: 'Quitar',
  title: 'Rodaje suave',
  sport: null,
  before: null,
  after: null,
  fields: [],
  reason: 'Deja descansar el tobillo',
  warnings: ['Es tu sesión clave'],
  missing: false,
  description: 'Quitar Rodaje suave',
};

const quedada: QuedadaSuggestion = {
  friendId: 'david-id',
  friendName: 'David Molina',
  sport: 'run',
  date: '2026-11-07',
  startTime: '08:00',
  durationMin: 60,
  intensity: 'endurance',
  title: 'Rodaje juntos',
  location: 'Retiro',
  reason: 'Los dos tenéis libre el sábado temprano.',
};

describe('contrast of the voice-coach pairs', () => {
  test.each([
    ['light', light],
    ['dark', dark],
  ])('%s: bubbles, quedada card and diff icons stay readable', (_scheme, c) => {
    // User bubble / notice banner / quedada card (accentSoft surfaces).
    expect(contrastRatio(c.onAccentSoft, c.accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.text, c.accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.textMuted, c.accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.accentInk, c.accentSoft)).toBeGreaterThanOrEqual(3);
    // Coach bubble and mic.
    expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    // Diff icons (non-text, 3:1) on the row background.
    for (const op of ['add', 'delete', 'move', 'update'] as const) {
      expect(contrastRatio(opColor(op, c), c.surface)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('MicButton', () => {
  test('idle and listening use the accent fill; quiet steps down to the surface', async () => {
    const { rerender } = await render(<MicButton state="idle" level={0} onPress={jest.fn()} />);
    expect(styleOf(screen.getByRole('button')).backgroundColor).toBe(light.accent);

    await rerender(<MicButton state="listening" level={0.5} onPress={jest.fn()} quiet />);
    const listening = styleOf(screen.getByRole('button'));
    expect(listening.backgroundColor).toBe(light.accent);
    expect(listening.transform).toEqual([{ scale: 0.94 }]);

    await rerender(<MicButton state="idle" level={0} onPress={jest.fn()} quiet />);
    const quiet = styleOf(screen.getByRole('button'));
    expect(quiet.backgroundColor).toBe(light.surface);
    expect(quiet.borderColor).toBe(light.borderStrong);
  });
});

describe('bubbles and cards', () => {
  test('the user bubble is the soft brand tint', async () => {
    await render(<UserBubble text="me duele el tobillo" channel="text" />);
    expect(styleOf(screen.getByLabelText('Tú: me duele el tobillo')).backgroundColor).toBe(light.accentSoft);
  });

  test('the quedada card is primary on its own and secondary when a proposal holds the primary action', async () => {
    const { rerender } = await render(<QuedadaSuggestionCard quedada={quedada} />);
    const primary = styleOf(screen.getByRole('button', { name: 'Preparar la invitación' }));
    expect(primary.backgroundColor).toBe(light.accent);

    await rerender(<QuedadaSuggestionCard quedada={quedada} quiet />);
    const secondary = styleOf(screen.getByRole('button', { name: 'Preparar la invitación' }));
    expect(secondary.backgroundColor).not.toBe(light.accent);
  });
});

describe('ChangeRow', () => {
  test('maps operations to status colours', () => {
    expect(opColor('add', light)).toBe(light.success);
    expect(opColor('delete', light)).toBe(light.danger);
    expect(opColor('move', light)).toBe(light.info);
    expect(opColor('update', dark)).toBe(dark.info);
  });

  test('a removal shows its danger-tinted glyph, the warning as text and the accent checkbox', async () => {
    await render(<ChangeRow row={row} checked onToggle={jest.fn()} />);
    expect(styleOf(screen.getByTestId('change-op-glyph')).backgroundColor).toBe(`${light.danger}1F`);
    expect(screen.getByText('Es tu sesión clave')).toBeTruthy();
    expect(screen.getByRole('checkbox', { checked: true })).toBeTruthy();
  });
});
