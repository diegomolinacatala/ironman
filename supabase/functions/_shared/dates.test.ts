import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  datesBetween,
  diffDays,
  isIsoDate,
  localParts,
  minutesToTime,
  normalizeTime,
  startOfWeek,
  timeToMinutes,
  todayIn,
  weekdayOf,
  zonedToUtc,
} from './dates.ts';

test('calendar arithmetic is timezone independent', () => {
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-11-01', '2026-10-25'), 7);
  assert.equal(weekdayOf('2026-10-26'), 0, 'Monday');
  assert.equal(weekdayOf('2026-10-25'), 6, 'Sunday');
  assert.equal(startOfWeek('2026-10-25'), '2026-10-19');
  assert.equal(startOfWeek('2026-10-26'), '2026-10-26');
  assert.deepEqual(datesBetween('2026-10-26', '2026-10-28'), ['2026-10-26', '2026-10-27', '2026-10-28']);
});

test('isIsoDate rejects impossible dates', () => {
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.equal(isIsoDate('26-10-01'), false);
});

test('time helpers normalize Postgres times', () => {
  assert.equal(normalizeTime('07:30:00'), '07:30');
  assert.equal(normalizeTime('7:30'), null);
  assert.equal(normalizeTime(null), null);
  assert.equal(timeToMinutes('18:45'), 1125);
  assert.equal(minutesToTime(1125), '18:45');
  assert.equal(minutesToTime(-5), '00:00');
});

test('Madrid local time across the DST change of 2026-10-25', () => {
  assert.deepEqual(localParts('2026-10-24T22:30:00Z', 'Europe/Madrid'), { date: '2026-10-25', time: '00:30' });
  assert.deepEqual(localParts('2026-10-25T12:00:00Z', 'Europe/Madrid'), { date: '2026-10-25', time: '13:00' });
  assert.equal(todayIn('Europe/Madrid', new Date('2026-10-25T23:30:00Z')), '2026-10-26');
  assert.equal(todayIn('Invalid/Zone', new Date('2026-10-25T10:00:00Z')), '2026-10-25');
  assert.equal(zonedToUtc('2026-10-24', '00:00', 'Europe/Madrid'), '2026-10-23T22:00:00.000Z');
  assert.equal(zonedToUtc('2026-10-26', '00:00', 'Europe/Madrid'), '2026-10-25T23:00:00.000Z');
});
