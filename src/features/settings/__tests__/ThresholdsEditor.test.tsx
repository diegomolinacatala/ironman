import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { ThresholdsEditor } from '../ThresholdsEditor';
import { EMPTY_THRESHOLD_INPUTS, type ThresholdInputs } from '../thresholdsModel';

jest.setTimeout(30000);

function Harness({ initial }: { initial: ThresholdInputs }) {
  const [value, setValue] = useState(initial);
  return <ThresholdsEditor value={value} onChange={setValue} />;
}

describe('ThresholdsEditor', () => {
  test('resting HR field, device-neutral hints and a live "Tus zonas" preview', async () => {
    await render(<Harness initial={EMPTY_THRESHOLD_INPUTS} />);
    expect(screen.getByLabelText('FC en reposo (ppm)')).toBeTruthy();
    expect(screen.getAllByText(/En tu reloj \(Garmin o COROS\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Garmin:/)).toBeNull();
    expect(screen.getByText('Tus zonas')).toBeTruthy();
    expect(screen.getByLabelText('Z2, Fondo: RPE 3–4')).toBeTruthy();
    expect(screen.getByText('Añade tu FC umbral o tu FC máxima y tu ritmo umbral para ver aquí tus números.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('FC umbral (ppm)'), '170');
    await fireEvent.changeText(screen.getByLabelText('Ritmo umbral carrera (min/km)'), '4:30');
    expect(screen.getByLabelText('Z2, Fondo: 145–151 ppm · 5:08–5:48 /km')).toBeTruthy();
  });

  test('bike zones in watts; max HR only gives approximate pulses', async () => {
    await render(<Harness initial={{ ...EMPTY_THRESHOLD_INPUTS, ftpW: '250', maxHr: '190' }} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Bici' }));
    expect(screen.getByLabelText(/^Z4, Umbral: 225–260 W · \d+–\d+ ppm aprox\.$/)).toBeTruthy();
    expect(screen.getByText('Pulsaciones aproximadas: con tu FC umbral serán más precisas.')).toBeTruthy();
  });

  test('out-of-range values show the error under the field', async () => {
    await render(<Harness initial={{ ...EMPTY_THRESHOLD_INPUTS, ftpW: '750', restingHr: '15' }} />);
    expect(screen.getByText('El FTP debe estar entre 50 y 700 W')).toBeTruthy();
    expect(screen.getByText('FC en reposo entre 25 y 120 ppm')).toBeTruthy();
  });
});
