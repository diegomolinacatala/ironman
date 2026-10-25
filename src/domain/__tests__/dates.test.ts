import {
  addDays,
  dateTimeParts,
  daysInRange,
  diffDays,
  formatDayLabel,
  formatDayLong,
  formatDayMedium,
  formatDayShort,
  formatDistance,
  formatDuration,
  formatTime,
  formatWeekRange,
  isDateInRange,
  isISODate,
  isISOTime,
  isoWeekNumber,
  maxDate,
  minDate,
  minutesToTime,
  parseISODate,
  startOfWeek,
  timeToMinutes,
  todayISO,
  toISODate,
  toLocalDateTime,
  weekdayOf,
  weekRange,
} from '../dates';

describe('dates', () => {
  test('toISODate uses the local calendar date (no UTC shift)', () => {
    expect(toISODate(new Date(2026, 9, 25, 23, 59))).toBe('2026-10-25');
    expect(toISODate(new Date(2026, 0, 1, 0, 1))).toBe('2026-01-01');
    expect(todayISO(new Date(2026, 9, 25, 8))).toBe('2026-10-25');
  });

  test('parseISODate returns local midday and rejects garbage', () => {
    const d = parseISODate('2026-10-25');
    expect(d.getHours()).toBe(12);
    expect(d.getDate()).toBe(25);
    expect(() => parseISODate('mañana')).toThrow(RangeError);
  });

  test('addDays and diffDays cross month, year and DST boundaries', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-10-26', '2026-10-24')).toBe(2);
    expect(diffDays('2026-03-30', '2026-03-28')).toBe(2);
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(-364);
  });

  test('weeks start on Monday', () => {
    expect(weekdayOf('2026-10-26')).toBe(0);
    expect(weekdayOf('2026-10-25')).toBe(6);
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26');
    expect(weekRange('2026-10-28')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });

  test('daysInRange is inclusive and empty when reversed', () => {
    expect(daysInRange({ from: '2026-10-30', to: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(daysInRange({ from: '2026-11-02', to: '2026-10-30' })).toEqual([]);
    expect(isDateInRange('2026-10-31', { from: '2026-10-30', to: '2026-11-02' })).toBe(true);
    expect(isDateInRange('2026-11-03', { from: '2026-10-30', to: '2026-11-02' })).toBe(false);
  });

  test('iso week numbers', () => {
    expect(isoWeekNumber('2026-10-26')).toBe(44);
    expect(isoWeekNumber('2027-01-01')).toBe(53);
    expect(isoWeekNumber('2027-01-04')).toBe(1);
  });

  test('validators', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('26-02-01')).toBe(false);
    expect(isISODate(42)).toBe(false);
    expect(isISOTime('18:30')).toBe(true);
    expect(isISOTime('18:30:00')).toBe(true);
    expect(isISOTime('25:00')).toBe(false);
  });

  test('time helpers', () => {
    expect(timeToMinutes('07:05')).toBe(425);
    expect(Number.isNaN(timeToMinutes('xx'))).toBe(true);
    expect(minutesToTime(425)).toBe('07:05');
    expect(minutesToTime(-10)).toBe('00:00');
    expect(minutesToTime(5000)).toBe('23:59');
    expect(minutesToTime(Number.NaN)).toBe('00:00');
    expect(toLocalDateTime('2026-10-27', '18:30')).toBe('2026-10-27T18:30:00');
    expect(dateTimeParts('2026-10-27T18:30:00')).toEqual({ date: '2026-10-27', minutes: 1110 });
    expect(dateTimeParts('not a date')).toBeNull();
    expect(maxDate('2026-10-01', '2026-09-30')).toBe('2026-10-01');
    expect(minDate('2026-10-01', '2026-09-30')).toBe('2026-09-30');
  });

  test('Spanish formatting', () => {
    expect(formatDayShort('2026-10-26')).toBe('lun 26');
    expect(formatDayLong('2026-10-27')).toBe('martes 27 de octubre');
    expect(formatDayMedium('2026-10-27')).toBe('mar 27 oct');
    expect(formatDayLabel('2026-10-25', '2026-10-25')).toBe('Hoy');
    expect(formatDayLabel('2026-10-26', '2026-10-25')).toBe('Mañana');
    expect(formatDayLabel('2026-10-24', '2026-10-25')).toBe('Ayer');
    expect(formatDayLabel('2026-10-30', '2026-10-25')).toBe('vie 30 oct');
    expect(typeof formatDayLabel('2026-10-30')).toBe('string');
  });

  test('durations, distances and times', () => {
    expect(formatDuration(45)).toBe("45'");
    expect(formatDuration(75)).toBe("1h 15'");
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(-3)).toBe("0'");
    expect(formatDistance(2500, 'swim')).toBe('2.500 m');
    expect(formatDistance(42195, 'run')).toBe('42,2 km');
    expect(formatDistance(10000, 'bike')).toBe('10 km');
    expect(formatTime('18:30:00')).toBe('18:30');
    expect(formatTime(null)).toBe('');
    expect(formatTime('nope')).toBe('');
  });

  test('week range label', () => {
    expect(formatWeekRange('2026-10-27')).toBe('26 oct – 1 nov');
    expect(formatWeekRange('2026-11-02')).toBe('2 – 8 nov');
  });
});
