import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ComplianceDot } from '../ComplianceDot';
import { IntensityTag, ZoneTag } from '../IntensityTag';
import { SheetModal } from '../SheetModal';
import { JuntosTag, KeyTag } from '../Tags';
import { WorkoutCard } from '../WorkoutCard';
import { makeWorkout } from './fixtures';

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

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

  test('with thresholds, a compact caption shows the zone and the main target', async () => {
    const w = makeWorkout({
      intensity: 'threshold',
      durationMin: 60,
      steps: [
        { kind: 'warmup', durationMin: 15 },
        { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold' },
      ],
    });
    await render(<WorkoutCard workout={w} today="2026-10-25" thresholds={{ lthr: 170 }} onPress={() => undefined} />);
    expect(screen.getByText('Z4 · 162–168 ppm')).toBeTruthy();
    expect(screen.getByRole('button').props.accessibilityLabel).toContain('objetivo Z4 · 162–168 ppm');
  });

  test('null thresholds fall back to the effort; no prop keeps the old card', async () => {
    const w = makeWorkout({ intensity: 'endurance' });
    const view = await render(<WorkoutCard workout={w} today="2026-10-25" thresholds={null} />);
    expect(screen.getByText('Z2 · RPE 3–4')).toBeTruthy();
    await view.rerender(<WorkoutCard workout={w} today="2026-10-25" />);
    expect(screen.queryByText(/RPE|ppm/)).toBeNull();
  });
});

describe('ZoneTag', () => {
  test('reads the zone', async () => {
    await render(<ZoneTag intensity="threshold" zone="Z4" />);
    expect(screen.getByLabelText('Zona Z4')).toBeTruthy();
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

describe('Tags', () => {
  test('juntos and key markers read in sentence case', async () => {
    await render(
      <>
        <JuntosTag name="Álex" />
        <KeyTag />
      </>,
    );
    expect(screen.getByText('con Álex')).toBeTruthy();
    expect(screen.getByText('Clave')).toBeTruthy();
  });
});

describe('SheetModal', () => {
  test('has one footer action plus a Cancelar that closes', async () => {
    const onClose = jest.fn();
    await render(
      <SheetModal visible onClose={onClose} title="Mover entreno" overline="Ahora: Hoy" footer={<></>}>
        <></>
      </SheetModal>,
    );
    expect(screen.getByText('Mover entreno')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
