import { addDays, maxDate } from '@/domain/dates';
import type { BusyBlock, ISODate, ISODateTime, LifeEvent, Race, UUID } from '@/domain/types';

import type { DemoClock } from '../db';
import { DEMO_USERS, localIso } from '../ids';

function race(clock: DemoClock, userId: UUID, fields: Omit<Race, 'id' | 'userId' | 'createdAt'>, createdAt: ISODateTime): Race {
  return { ...fields, id: clock.newId(), userId, createdAt };
}

export function seedRaces(clock: DemoClock, createdAt: ISODateTime): Race[] {
  const { today } = clock;
  const halfDate = addDays(today, 168);
  const half = {
    name: 'Triatlón de Valencia · Media distancia',
    date: halfDate,
    distance: 'half' as const,
    priority: 'A' as const,
    location: 'Valencia',
  };
  return [
    race(clock, DEMO_USERS.diego, { ...half, goal: 'Bajar de 5 h 15', notes: 'Objetivo de la temporada, con Álex.' }, createdAt),
    race(
      clock,
      DEMO_USERS.diego,
      {
        name: 'Triatlón Olímpico de Madrid',
        date: addDays(today, 70),
        distance: 'olympic',
        priority: 'B',
        location: 'Madrid · Casa de Campo',
        goal: 'Sub 2 h 30',
        notes: 'Test de forma a mitad de bloque.',
      },
      createdAt,
    ),
    race(clock, DEMO_USERS.alex, { ...half, goal: 'Sub 4 h 50', notes: null }, createdAt),
    race(
      clock,
      DEMO_USERS.alex,
      { name: 'Medio maratón de Getafe', date: addDays(today, 35), distance: 'run_half', priority: 'C', location: 'Getafe', goal: null, notes: null },
      createdAt,
    ),
  ];
}

export function seedLifeEvents(clock: DemoClock, weekStart: ISODate): LifeEvent[] {
  const padelDay = maxDate(clock.today, addDays(weekStart, 2));
  const footballDay = addDays(weekStart, 8);
  return [
    {
      id: clock.newId(),
      userId: DEMO_USERS.diego,
      kind: 'padel',
      title: 'Pádel con los del máster',
      startDate: padelDay,
      endDate: padelDay,
      startTime: '20:00',
      durationMin: 90,
      severity: 2,
      bodyArea: null,
      notes: 'Partido a 3 sets, bastante intenso.',
      createdAt: clock.now,
    },
    {
      id: clock.newId(),
      userId: DEMO_USERS.alex,
      kind: 'football',
      title: 'Fútbol 7 con el trabajo',
      startDate: footballDay,
      endDate: footballDay,
      startTime: '21:00',
      durationMin: 60,
      severity: 2,
      bodyArea: null,
      notes: null,
      createdAt: clock.now,
    },
  ];
}

function block(clock: DemoClock, userId: UUID, date: ISODate, start: string, end: string, title: string): BusyBlock {
  return {
    id: clock.newId(),
    userId,
    start: localIso(date, start),
    end: localIso(date, end),
    source: 'device_calendar',
    title,
    externalId: null,
  };
}

/** Diego: classes Mon–Fri 09:00–14:00. Álex: work Mon–Thu 09:00–17:30, Fri 08:00–15:00. */
export function seedBusyBlocks(clock: DemoClock, weekStart: ISODate): BusyBlock[] {
  const days = Array.from({ length: 14 }, (_, i) => ({ date: addDays(weekStart, i), weekday: i % 7 })).filter(
    (d) => d.weekday <= 4,
  );
  return days.flatMap(({ date, weekday }) => [
    block(clock, DEMO_USERS.diego, date, '09:00', '14:00', 'Clases del máster'),
    weekday === 4
      ? block(clock, DEMO_USERS.alex, date, '08:00', '15:00', 'Trabajo')
      : block(clock, DEMO_USERS.alex, date, '09:00', '17:30', 'Trabajo'),
  ]);
}
