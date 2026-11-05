import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { addDays, isoWeekNumber } from '@/domain/dates';

import { dayHeading } from '../DaySection';
import { WeekSwitcher, weekCaption } from '../WeekSwitcher';

const MONDAY = '2026-11-02';

describe('weekCaption', () => {
  test('marks the current, next and previous weeks', () => {
    const n = isoWeekNumber(MONDAY);
    expect(weekCaption(MONDAY, MONDAY)).toBe(`Semana ${n} · actual`);
    expect(weekCaption(addDays(MONDAY, 7), MONDAY)).toBe(`Semana ${n + 1} · próxima`);
    expect(weekCaption(addDays(MONDAY, -7), MONDAY)).toBe(`Semana ${n - 1} · pasada`);
    expect(weekCaption(addDays(MONDAY, 21), MONDAY)).toBe(`Semana ${n + 3}`);
  });
});

describe('dayHeading', () => {
  test('relative days keep the date; others are capitalised', () => {
    expect(dayHeading('2026-11-05', '2026-11-05')).toMatch(/^Hoy · jue/);
    expect(dayHeading('2026-11-06', '2026-11-05')).toMatch(/^Mañana · /);
    expect(dayHeading('2026-11-09', '2026-11-05')).toMatch(/^Lun 9/);
  });
});

describe('WeekSwitcher', () => {
  test('offers a way back only when away from the current week', async () => {
    const onChange = jest.fn();
    await render(<WeekSwitcher weekStart={addDays(MONDAY, 14)} currentWeekStart={MONDAY} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Volver a esta semana' }));
    expect(onChange).toHaveBeenCalledWith(MONDAY);
    await fireEvent.press(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(onChange).toHaveBeenLastCalledWith(addDays(MONDAY, 7));
  });

  test('hides the jump on the current week', async () => {
    await render(<WeekSwitcher weekStart={MONDAY} currentWeekStart={MONDAY} onChange={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Volver a esta semana' })).toBeNull();
  });
});
