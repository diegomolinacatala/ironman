import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button, buttonPalette } from '../Button';
import { Card } from '../Card';
import { Chip, Tag } from '../Chip';
import { contrastRatio, readableTextOn } from '../color';
import { Segmented, TextField } from '../Field';
import { Avatar, EmptyState, ErrorNotice, ListRow, SectionHeader } from '../Layout';
import { Screen } from '../Screen';
import { makeTheme, type as typeStyles } from '../theme';

const light = makeTheme(false).colors;
const dark = makeTheme(true).colors;

describe('colour helpers', () => {
  test('contrastRatio matches WCAG reference values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('not-a-colour', '#FFFFFF')).toBe(1);
  });

  test('readableTextOn picks ink on light fills and white on dark fills', () => {
    expect(readableTextOn('#1F3A68')).toBe('#FFFFFF');
    expect(readableTextOn('#C9A100')).not.toBe('#FFFFFF');
    expect(readableTextOn('#ECEFF3')).not.toBe('#FFFFFF');
  });

  test.each([
    ['light', light],
    ['dark', dark],
  ])('core text pairs reach 4.5:1 in %s mode', (_scheme, c) => {
    expect(contrastRatio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.accentInk, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.accentInk, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onAccentSoft, c.accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.textMuted, c.surfaceAlt)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.danger, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Button', () => {
  test('primary is the accent fill; secondary is surface + border; ghost is brand ink', () => {
    expect(buttonPalette('primary', light)).toMatchObject({ bg: light.accent, fg: light.onAccent });
    expect(buttonPalette('secondary', light)).toMatchObject({ bg: light.surface, border: light.borderStrong });
    expect(buttonPalette('ghost', dark)).toMatchObject({ bg: 'transparent', fg: dark.accentInk });
    expect(buttonPalette('danger', dark).fg).toBe(dark.danger);
  });

  test('uses radius md and the spec heights', async () => {
    await render(<Button label="Guardar" onPress={() => {}} size="lg" />);
    const style = StyleSheet.flatten(screen.getByRole('button', { name: 'Guardar' }).props.style);
    expect(style.borderRadius).toBe(12);
    expect(style.height).toBe(52);
  });

  test('calls onPress and exposes the disabled state', async () => {
    const onPress = jest.fn();
    await render(<Button label="Enviar" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Enviar' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Chip and Tag', () => {
  test('selected chips use the accent fill and report selection', async () => {
    await render(<Chip label="Z2" selected onPress={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Z2' });
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe(light.accent);
  });

  test('an identity colour renders as a dot, not as the selected fill', async () => {
    await render(<Chip label="Umbral" color="#B85C9A" selected onPress={() => {}} />);
    expect(screen.getByTestId('chip-dot')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Umbral' }).props.style).backgroundColor).toBe(light.accent);
  });

  test('tags keep their label text and use radius sm', async () => {
    await render(<Tag label="Juntos" color="#1F3A68" tone="solid" />);
    expect(screen.getByText('Juntos')).toBeTruthy();
  });
});

describe('Field', () => {
  test('TextField label is sentence case (no overline transform)', async () => {
    await render(<TextField label="Nombre" value="" onChangeText={() => {}} />);
    const label = StyleSheet.flatten(screen.getByText('Nombre').props.style);
    expect(label.textTransform).toBeUndefined();
  });

  test('Segmented marks the selected option and changes value', async () => {
    const onChange = jest.fn();
    await render(
      <Segmented
        options={[
          { value: 'a', label: 'Semana' },
          { value: 'b', label: 'Mes' },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Semana' }).props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByRole('tab', { name: 'Mes' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Layout', () => {
  test('SectionHeader is a heading-style header with its action', async () => {
    const onPress = jest.fn();
    await render(<SectionHeader title="Esta semana" action={{ label: 'Ver todo', onPress }} />);
    const header = screen.getByRole('header');
    expect(StyleSheet.flatten(header.props.style).fontSize).toBe(typeStyles.heading.fontSize);
    expect(StyleSheet.flatten(header.props.style).textTransform).toBeUndefined();
    fireEvent.press(screen.getByRole('button', { name: 'Ver todo' }));
    expect(onPress).toHaveBeenCalled();
  });

  test('ListRow keeps its accessible label and accepts a custom icon tile', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Garmin" subtitle="Conectado" icon="watch" iconTint="#E5EBF5" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Garmin. Conectado' }));
    expect(onPress).toHaveBeenCalled();
  });

  test('EmptyState shows title, message and action; ErrorNotice offers retry', async () => {
    const onRetry = jest.fn();
    await render(
      <>
        <EmptyState icon="week" title="Sin plan" message="Crea tu primera semana." />
        <ErrorNotice message="No se pudo cargar." onRetry={onRetry} />
      </>,
    );
    expect(screen.getByText('Sin plan')).toBeTruthy();
    expect(screen.getByText('Crea tu primera semana.')).toBeTruthy();
    expect(screen.getByText('No se pudo cargar.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalled();
  });

  test('Avatar shows initials', async () => {
    await render(<Avatar name="Diego Molina" />);
    expect(screen.getByText('DM')).toBeTruthy();
  });
});

describe('Card and Screen', () => {
  test('pressable card keeps its label and radius lg', async () => {
    const onPress = jest.fn();
    await render(
      <Card onPress={onPress} accessibilityLabel="Sesión de hoy" rail="#2F80C9">
        <></>
      </Card>,
    );
    const card = screen.getByRole('button', { name: 'Sesión de hoy' });
    expect(StyleSheet.flatten(card.props.style).borderRadius).toBe(16);
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalled();
  });

  test('Screen renders the overline and a display title', async () => {
    const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen title="Hoy" overline="Semana 43">
          <></>
        </Screen>
      </SafeAreaProvider>,
    );
    expect(screen.getByText('Semana 43')).toBeTruthy();
    const title = screen.getByRole('header', { name: 'Hoy' });
    expect(StyleSheet.flatten(title.props.style).fontSize).toBe(typeStyles.display.fontSize);
  });
});
