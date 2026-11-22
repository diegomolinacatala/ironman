import { beforeEach, describe, expect, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Text } from '../Text';
import { Disclosure } from '../Disclosure';
import { getDisclosureOpen, parseDisclosureState, resetDisclosureState } from '../disclosureState';

beforeEach(() => {
  resetDisclosureState();
});

describe('Disclosure', () => {
  test('starts closed with its summary and opens on tap', async () => {
    await render(
      <Disclosure title="Comidas de hoy" summary="520 kcal · 1 comida">
        <Text>Contenido</Text>
      </Disclosure>,
    );
    const header = screen.getByRole('button', { name: 'Comidas de hoy. 520 kcal · 1 comida' });
    expect(screen.queryByText('Contenido')).toBeNull();
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    await fireEvent.press(header);
    expect(screen.getByText('Contenido')).toBeTruthy();
  });

  test('defaultOpen shows the content and a tap folds it', async () => {
    await render(
      <Disclosure title="Tu forma" defaultOpen>
        <Text>Gráfica</Text>
      </Disclosure>,
    );
    expect(screen.getByText('Gráfica')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tu forma' }));
    expect(screen.queryByText('Gráfica')).toBeNull();
  });

  test('a storage key remembers the choice across mounts', async () => {
    const view = (
      <Disclosure title="Mañana" storageKey="today.tomorrow">
        <Text>Bici</Text>
      </Disclosure>
    );
    const first = await render(view);
    await fireEvent.press(screen.getByRole('button', { name: 'Mañana' }));
    expect(getDisclosureOpen('today.tomorrow')).toBe(true);
    await first.unmount();
    await render(view);
    expect(screen.getByText('Bici')).toBeTruthy();
  });
});

describe('parseDisclosureState', () => {
  test('keeps booleans and ignores anything malformed', () => {
    expect(parseDisclosureState('{"a":true,"b":"x","c":false}')).toEqual({ a: true, c: false });
    expect(parseDisclosureState('[1,2]')).toEqual({});
    expect(parseDisclosureState('nope')).toEqual({});
    expect(parseDisclosureState(null)).toEqual({});
  });
});
