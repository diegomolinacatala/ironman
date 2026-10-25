import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Alert, type AlertButton } from 'react-native';

import { confirmAsync, notify } from '../confirm';

afterEach(() => {
  jest.restoreAllMocks();
});

function pressButton(index: number) {
  return (_title: string | null | undefined, _message?: string | null, buttons?: AlertButton[]) => {
    buttons?.[index]?.onPress?.();
  };
}

describe('confirmAsync (native)', () => {
  test('resolves true when the confirm button is pressed', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(pressButton(1));
    await expect(confirmAsync({ title: '¿Borrar?', confirmLabel: 'Borrar', destructive: true })).resolves.toBe(true);
    const buttons = spy.mock.calls[0]?.[2];
    expect(buttons?.map((b) => b.text)).toEqual(['Cancelar', 'Borrar']);
    expect(buttons?.[1]?.style).toBe('destructive');
  });

  test('resolves false on cancel', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(pressButton(0));
    await expect(confirmAsync({ title: '¿Saltar?' })).resolves.toBe(false);
  });

  test('notify shows a plain alert', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    notify('Hecho', 'Guardado');
    expect(spy).toHaveBeenCalledWith('Hecho', 'Guardado');
  });
});
