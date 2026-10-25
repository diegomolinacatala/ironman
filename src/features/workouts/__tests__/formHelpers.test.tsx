import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { FormFooter } from '../FormFooter';
import { footerClearance } from '../FormScreen';
import { PatternTextField } from '../PatternTextField';
import { keyboardOverlap } from '../useKeyboardInset';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe('keyboardOverlap', () => {
  test('is the covered part of the view minus the home-indicator inset', () => {
    // 812 pt screen, keyboard top at 476 → 336 covered, 34 of them are the home indicator.
    expect(keyboardOverlap(812, 476, 34)).toBe(302);
  });

  test('is 0 when the keyboard is below the view or hidden', () => {
    expect(keyboardOverlap(700, 812, 34)).toBe(0);
    expect(keyboardOverlap(812, 812, 34)).toBe(0);
    expect(keyboardOverlap(812, 800, -5)).toBe(12);
  });
});

describe('footerClearance', () => {
  test('never goes below what Screen reserves', () => {
    expect(footerClearance(0, 0)).toBe(96);
  });

  test('grows with the footer (error messages above the button)', () => {
    expect(footerClearance(56, 34)).toBe(130);
    expect(footerClearance(140, 34)).toBe(214);
  });
});

describe('FormFooter', () => {
  test('renders only the non-empty errors before the action', async () => {
    await render(
      <FormFooter errors={[null, 'Elige al menos un amigo para invitar.', '']}>
        <Text>Enviar</Text>
      </FormFooter>,
    );
    expect(screen.getByText('Elige al menos un amigo para invitar.')).toBeTruthy();
    // Only the real message gets an ErrorNotice (icon + text): one text node besides the action.
    expect(screen.getByTestId('form-footer').children).toHaveLength(2);
  });
});

describe('PatternTextField (web date/time fields)', () => {
  test('follows a value changed by the parent ("Hasta" moved by "Desde")', async () => {
    const onChange = jest.fn();
    const view = await render(<PatternTextField label="Hasta" value="2026-10-27" onChange={onChange} pattern={DATE_RE} placeholder="AAAA-MM-DD" />);
    expect(screen.getByDisplayValue('2026-10-27')).toBeTruthy();
    await view.rerender(<PatternTextField label="Hasta" value="2026-10-30" onChange={onChange} pattern={DATE_RE} placeholder="AAAA-MM-DD" />);
    expect(screen.getByDisplayValue('2026-10-30')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('reports only valid text and reverts invalid text on blur', async () => {
    const onChange = jest.fn();
    await render(<PatternTextField label="Desde" value="2026-10-27" onChange={onChange} pattern={DATE_RE} placeholder="AAAA-MM-DD" />);
    const input = screen.getByLabelText('Desde');
    await fireEvent.changeText(input, '2026-10-3');
    expect(screen.getByText('Formato AAAA-MM-DD')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent(input, 'blur');
    expect(screen.getByDisplayValue('2026-10-27')).toBeTruthy();
    expect(screen.queryByText('Formato AAAA-MM-DD')).toBeNull();
    await fireEvent.changeText(input, '2026-10-31');
    expect(onChange).toHaveBeenCalledWith('2026-10-31');
  });
});
