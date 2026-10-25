import { describe, expect, test } from '@jest/globals';

import { relativeTime } from '../relativeTime';

const NOW = new Date(2026, 9, 25, 12, 0);

describe('relativeTime', () => {
  test.each([
    [new Date(2026, 9, 25, 11, 59, 40), 'ahora'],
    [new Date(2026, 9, 25, 12, 5), 'ahora'],
    [new Date(2026, 9, 25, 11, 55), 'hace 5 min'],
    [new Date(2026, 9, 25, 9, 0), 'hace 3 h'],
    [new Date(2026, 9, 24, 20, 0), 'ayer'],
    [new Date(2026, 9, 22, 10, 0), 'hace 3 días'],
  ])('%p → %p', (date, expected) => {
    expect(relativeTime(date.toISOString(), NOW)).toBe(expected);
  });

  test('older dates use a day label and invalid dates are empty', () => {
    expect(relativeTime(new Date(2026, 9, 10, 10, 0).toISOString(), NOW)).toMatch(/10 oct/);
    expect(relativeTime('nope', NOW)).toBe('');
  });
});
