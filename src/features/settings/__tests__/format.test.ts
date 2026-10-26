import { describe, expect, test } from '@jest/globals';

import {
  addDaysISO,
  clockToMinutes,
  daysUntil,
  formatDateShort,
  formatMinutesCompact,
  formatRelativeTime,
  isPlausibleEmail,
  minutesToClock,
  sanitizeUsername,
  suggestUsername,
  toWebcalUrl,
} from '../format';

const NOW = new Date(2026, 9, 25, 12, 0, 0);

describe('format helpers', () => {
  test('formatRelativeTime covers the relative buckets', () => {
    expect(formatRelativeTime(null, NOW)).toBe('Nunca');
    expect(formatRelativeTime('nope', NOW)).toBe('Nunca');
    expect(formatRelativeTime(new Date(2026, 9, 25, 11, 59, 40).toISOString(), NOW)).toBe('hace un momento');
    expect(formatRelativeTime(new Date(2026, 9, 25, 11, 55).toISOString(), NOW)).toBe('hace 5 min');
    expect(formatRelativeTime(new Date(2026, 9, 25, 9, 0).toISOString(), NOW)).toBe('hace 3 h');
    expect(formatRelativeTime(new Date(2026, 9, 24, 18, 30).toISOString(), NOW)).toBe('ayer, 18:30');
    expect(formatRelativeTime(new Date(2026, 9, 20, 7, 5).toISOString(), NOW)).toBe('20 oct, 07:05');
  });

  test('formatDateShort includes the year only when different', () => {
    expect(formatDateShort('2026-11-02', NOW)).toBe('2 nov');
    expect(formatDateShort('2027-04-18', NOW)).toBe('18 abr 2027');
  });

  test('date arithmetic works across month and DST boundaries', () => {
    expect(addDaysISO('2026-10-25', 7)).toBe('2026-11-01');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysUntil('2026-11-01', '2026-10-25')).toBe(7);
    expect(daysUntil('2026-10-20', '2026-10-25')).toBe(-5);
  });

  test('toWebcalUrl swaps the scheme', () => {
    expect(toWebcalUrl('https://x.supabase.co/functions/v1/ics/rb_1.ics')).toBe(
      'webcal://x.supabase.co/functions/v1/ics/rb_1.ics',
    );
    expect(toWebcalUrl('http://localhost/ics/a.ics')).toBe('webcal://localhost/ics/a.ics');
  });

  test('clock conversions', () => {
    expect(minutesToClock(450)).toBe('07:30');
    expect(minutesToClock(-15)).toBe('23:45');
    expect(clockToMinutes('21:30')).toBe(1290);
    expect(clockToMinutes('25:00', 60)).toBe(60);
    expect(clockToMinutes(null, 5)).toBe(5);
  });

  test('formatMinutesCompact', () => {
    expect(formatMinutesCompact(45)).toBe("45'");
    expect(formatMinutesCompact(120)).toBe('2h');
    expect(formatMinutesCompact(330)).toBe("5h 30'");
  });

  test('username helpers', () => {
    expect(sanitizeUsername('@Álex_Run!')).toBe('alex_run');
    expect(suggestUsername('Diego  Molina')).toBe('diego.molina');
    expect(suggestUsername(' .Ñu. ')).toBe('nu');
  });

  test('isPlausibleEmail', () => {
    expect(isPlausibleEmail('diego@roadtoironman.app')).toBe(true);
    expect(isPlausibleEmail('diego@roadtoironman')).toBe(false);
    expect(isPlausibleEmail('di ego@x.com')).toBe(false);
  });
});
