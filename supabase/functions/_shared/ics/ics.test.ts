import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex } from '../crypto.ts';
import { silentLogger } from '../log.ts';
import { extractIcsSecret } from '../mcp/guards.ts';
import { createRateLimiter } from '../mcp/token-gate.ts';
import { emptyState, fakeStore, fixedNow, FRIEND, USER, workout } from '../testing/fakes.ts';
import { buildIcsFeed } from './feed.ts';
import { escapeText, foldLine, formatUtcStamp, localEnd } from './format.ts';
import { handleIcsHttp } from './http.ts';

const octets = (s: string): number => new TextEncoder().encode(s).length;

test('TEXT escaping and UTC stamps', () => {
  assert.equal(escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  assert.equal(formatUtcStamp(new Date('2026-10-25T08:05:09.123Z')), '20261025T080509Z');
  assert.deepEqual(localEnd('2026-10-27', '23:30', 60), { date: '2026-10-28', time: '00:30' });
});

test('line folding keeps every line ≤ 75 octets and never splits UTF-8 characters', () => {
  const line = `DESCRIPTION:${'Natación técnica con pull buoy y palas, ñ ü '.repeat(6)}`;
  const folded = foldLine(line);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(octets(p) <= 75, `${octets(p)} octets`);
  assert.ok(parts.slice(1).every((p) => p.startsWith(' ')));
  assert.equal(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join(''), line);
  assert.equal(foldLine('SHORT:x'), 'SHORT:x');
});

test('feed: VTIMEZONE, stable UIDs, timed and all-day events, partners, CRLF', () => {
  const jointId = '44444444-4444-4444-8444-444444444444';
  const ics = buildIcsFeed({
    userId: USER,
    now: fixedNow(),
    workouts: [
      workout({ id: 'w1', date: '2026-10-27', startTime: '07:00', durationMin: 50, title: 'Rodaje; suave, Z2' }),
      workout({ id: 'w2', date: '2026-10-28', startTime: null, sport: 'swim', title: 'Natación' }),
      workout({ id: 'w3', date: '2026-10-31', startTime: '09:00', sport: 'bike', title: 'Grupeta', jointSessionId: jointId }),
      workout({ id: 'w4', date: '2026-10-29', status: 'skipped', title: 'Saltado' }),
      workout({ id: 'w5', date: '2026-10-30', status: 'completed', completed: { durationMin: 40, avgHr: 150 }, title: 'Hecho' }),
    ],
    jointSessions: [
      {
        id: jointId,
        organizerId: FRIEND,
        sport: 'bike',
        date: '2026-10-31',
        startTime: '09:00',
        durationMin: 150,
        intensity: 'endurance',
        title: 'Grupeta',
        location: 'Casa de Campo',
        status: 'confirmed',
        participants: [
          { userId: FRIEND, displayName: 'Álex', status: 'accepted', workoutId: null },
          { userId: USER, displayName: 'Diego', status: 'accepted', workoutId: 'w3' },
        ],
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        organizerId: FRIEND,
        sport: 'run',
        date: '2026-11-01',
        startTime: '10:00',
        durationMin: 60,
        intensity: 'endurance',
        title: 'Rodaje juntos',
        location: null,
        status: 'confirmed',
        participants: [{ userId: USER, displayName: 'Diego', status: 'accepted', workoutId: null }],
      },
    ],
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'only CRLF line breaks');
  assert.match(ics, /X-WR-CALNAME:Road to Ironman\r\n/);
  assert.match(ics, /PRODID:-\/\/Road to Ironman\/\/Plan de entrenamiento\/\/ES\r\n/);
  assert.match(ics, /Plan de Road to Ironman/);
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Madrid/);
  assert.match(ics, /UID:workout-w1@roadtoironman\.app/);
  assert.match(ics, /DTSTART;TZID=Europe\/Madrid:20261027T070000\r\nDTEND;TZID=Europe\/Madrid:20261027T075000/);
  assert.match(ics, /SUMMARY:Rodaje\\; suave\\, Z2 \(Carrera\)/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261028\r\nDTEND;VALUE=DATE:20261029/);
  assert.match(ics, /SUMMARY:Grupeta \(Bici\) · con Álex/);
  assert.match(ics, /LOCATION:Casa de Campo/);
  assert.ok(!ics.includes('Saltado'), 'skipped workouts are hidden');
  assert.match(ics, /SUMMARY:✓ Hecho/);
  assert.match(ics, /UID:joint-55555555-5555-4555-8555-555555555555@roadtoironman\.app/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 5);
  for (const line of ics.split('\r\n')) assert.ok(octets(line) <= 75);
});

test('ICS HTTP: secret path, token scope, 404s and calendar response', async () => {
  const secret = `rb_${'a1'.repeat(32)}`;
  assert.equal(extractIcsSecret(`/ics/${secret}.ics`), secret);
  assert.equal(extractIcsSecret(`/functions/v1/ics/${secret}.ics`), secret);
  assert.equal(extractIcsSecret('/ics/whatever.ics'), null);
  const hash = await sha256Hex(secret);
  const state = emptyState();
  state.workouts.push(workout({ date: '2026-10-27' }));
  const deps = {
    resolveUserId: async (h: string) => (h === hash ? USER : null),
    reader: fakeStore(state),
    rateLimiter: createRateLimiter({ limit: 10, windowMs: 60_000 }),
    now: fixedNow,
    logger: silentLogger,
  };
  const ok = await handleIcsHttp(new Request(`https://x/functions/v1/ics/${secret}.ics`), deps);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.match(ok.headers.get('cache-control') ?? '', /max-age=300/);
  assert.match(await ok.text(), /BEGIN:VEVENT/);
  assert.equal((await handleIcsHttp(new Request(`https://x/ics/rb_${'b'.repeat(64)}.ics`), deps)).status, 404);
  assert.equal((await handleIcsHttp(new Request('https://x/ics/nope.ics'), deps)).status, 404);
  assert.equal((await handleIcsHttp(new Request(`https://x/ics/${secret}.ics`, { method: 'POST' }), deps)).status, 405);
  const head = await handleIcsHttp(new Request(`https://x/ics/${secret}.ics`, { method: 'HEAD' }), deps);
  assert.equal(head.status, 200);
});
