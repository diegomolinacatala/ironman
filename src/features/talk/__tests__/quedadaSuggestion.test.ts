import { describe, expect, test } from '@jest/globals';

import type { QuedadaSuggestion } from '@/domain/types';
import { jointNewParams, parseJointParams } from '@/features/together/jointForm';

import { prefillFromQuedada, quedadaDetail, quedadaHeading } from '../quedadaSuggestion';

const QUEDADA: QuedadaSuggestion = {
  friendId: 'david-id',
  friendName: 'David Molina',
  sport: 'run',
  date: '2026-11-08',
  startTime: '08:00',
  durationMin: 60,
  intensity: 'endurance',
  title: 'Rodaje juntos',
  location: null,
  reason: 'Los dos tenéis libre el domingo por la mañana.',
};

describe('quedada suggestion copy', () => {
  test('heading uses the first name; detail joins day, time, title, duration and place', () => {
    expect(quedadaHeading(QUEDADA)).toBe('Quedada con David');
    expect(quedadaDetail(QUEDADA)).toBe('Dom 8 nov · 08:00 · Rodaje juntos · 1h');
    expect(quedadaDetail({ ...QUEDADA, startTime: null, durationMin: 90, location: 'Casa de Campo' })).toBe('Dom 8 nov · Rodaje juntos · 1h 30\' · Casa de Campo');
  });
});

describe('prefillFromQuedada', () => {
  test('maps every field the form understands', () => {
    expect(prefillFromQuedada({ ...QUEDADA, location: ' Retiro ', intensity: 'tempo' })).toEqual({
      friendId: 'david-id',
      date: '2026-11-08',
      sport: 'run',
      startTime: '08:00',
      durationMin: 60,
      intensity: 'tempo',
      title: 'Rodaje juntos',
      location: 'Retiro',
    });
  });

  test('no time / no place stay out; duration is clamped to the form limits', () => {
    const prefill = prefillFromQuedada({ ...QUEDADA, startTime: null, location: '  ', durationMin: 5 });
    expect(prefill.startTime).toBeUndefined();
    expect(prefill.location).toBeUndefined();
    expect(prefill.durationMin).toBe(15);
    expect(prefillFromQuedada({ ...QUEDADA, durationMin: 720 }).durationMin).toBe(480);
  });

  test('round-trips through the /joint/new route params', () => {
    const prefill = prefillFromQuedada({ ...QUEDADA, location: 'Retiro' });
    expect(parseJointParams(jointNewParams(prefill))).toMatchObject(prefill);
  });
});
