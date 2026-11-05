import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { lifeEventLabel, severityLabel } from '@/domain/labels';

import { KindGrid } from '../KindGrid';
import { SeverityPicker } from '../SeverityPicker';

describe('KindGrid', () => {
  test('marks the selected kind and reports a new one', async () => {
    const onChange = jest.fn();
    await render(<KindGrid value="padel" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: lifeEventLabel('padel') }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('radio', { name: lifeEventLabel('travel') }));
    expect(onChange).toHaveBeenCalledWith('travel');
  });
});

describe('SeverityPicker', () => {
  test('selected level is announced and changes on press', async () => {
    const onChange = jest.fn();
    await render(<SeverityPicker kind="injury" value={2} onChange={onChange} label="Gravedad" />);
    expect(screen.getByRole('radio', { name: severityLabel('injury', 2) }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('radio', { name: severityLabel('injury', 3) }));
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
