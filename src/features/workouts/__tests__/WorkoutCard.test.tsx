import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ComplianceDot } from '../ComplianceDot';
import { IntensityTag } from '../IntensityTag';
import { WorkoutCard } from '../WorkoutCard';
import { makeWorkout } from './fixtures';

describe('WorkoutCard', () => {
  test('renders title, meta, partner and an accessible summary', async () => {
    const onPress = jest.fn();
    const w = makeWorkout({ title: 'Series 6×1000', startTime: '18:30', durationMin: 60, isKey: true, intensity: 'threshold' });
    await render(<WorkoutCard workout={w} today="2026-10-25" partnerName="Álex" onPress={onPress} />);
    expect(screen.getByText('Series 6×1000')).toBeTruthy();
    expect(screen.getByText('18:30 · 1h')).toBeTruthy();
    expect(screen.getByLabelText('Quedada con Álex')).toBeTruthy();
    expect(screen.getByLabelText('Sesión clave')).toBeTruthy();
    expect(screen.getByLabelText('Pendiente')).toBeTruthy();
    const card = screen.getByRole('button');
    expect(card.props.accessibilityLabel).toContain('con Álex');
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('missed planned workouts in the past show the missed dot', async () => {
    await render(<WorkoutCard workout={makeWorkout({ date: '2026-10-20' })} today="2026-10-25" compact />);
    expect(screen.getByLabelText('No hecho')).toBeTruthy();
  });

  test('long press fires the action handler', async () => {
    const onLongPress = jest.fn();
    await render(<WorkoutCard workout={makeWorkout()} today="2026-10-25" compact onPress={() => undefined} onLongPress={onLongPress} />);
    await fireEvent(screen.getByRole('button'), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});

describe('ComplianceDot / IntensityTag', () => {
  test('pairs colour with a label and glyph', async () => {
    await render(<ComplianceDot state="partial" />);
    expect(screen.getByLabelText('Desviado')).toBeTruthy();
    expect(screen.getByText('~')).toBeTruthy();
  });

  test('intensity tag shows the Spanish label', async () => {
    await render(<IntensityTag intensity="endurance" />);
    expect(screen.getByLabelText(/^Intensidad: /)).toBeTruthy();
  });
});
