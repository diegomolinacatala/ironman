import type { ISODateTime, Profile, TrainingWindow, Weekday } from '@/domain/types';

import { DEFAULT_NOTIFICATION_PREFS } from '../../supabase/parsers';
import { DEMO_USERS } from '../ids';

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4];
const WEEKEND: Weekday[] = [5, 6];

function windows(weekdays: { start: string; end: string }[], weekend: { start: string; end: string }): TrainingWindow[] {
  return [
    ...WEEKDAYS.flatMap((weekday) => weekdays.map((w) => ({ weekday, start: w.start, end: w.end }))),
    ...WEEKEND.map((weekday) => ({ weekday, start: weekend.start, end: weekend.end })),
  ];
}

function base(id: string, createdAt: ISODateTime): Pick<Profile, 'id' | 'timezone' | 'createdAt' | 'avatarUrl' | 'notificationPrefs'> {
  return { id, timezone: 'Europe/Madrid', createdAt, avatarUrl: null, notificationPrefs: DEFAULT_NOTIFICATION_PREFS };
}

export function seedProfiles(createdAt: ISODateTime): Profile[] {
  const diego: Profile = {
    ...base(DEMO_USERS.diego, createdAt),
    username: 'diego',
    displayName: 'Diego',
    sports: ['swim', 'bike', 'run', 'strength'],
    level: 'intermediate',
    thresholds: { ftpW: 245, runThresholdPaceSecPerKm: 268, swimCssSecPer100m: 102, maxHr: 192, lthr: 172, restingHr: 50 },
    availability: {
      weeklyHoursTarget: 10,
      restDay: 0,
      longSessionDays: [5, 6],
      windows: windows(
        [
          { start: '07:00', end: '08:30' },
          { start: '19:00', end: '21:30' },
        ],
        { start: '08:00', end: '13:00' },
      ),
      poolDays: [1, 3, 4],
    },
    visibility: 'full',
    coachNotes:
      'Estudiante de máster: clases de lunes a viernes de 9 a 14 h. Juego al pádel con los del máster algunas semanas. Molestias de cintilla iliotibial en 2025: cuidado con subir el volumen de carrera de golpe. Como de todo; intento llegar a 1,6 g/kg de proteína.',
    // Like the v2 migration (`onboarded_at = null`): the demo athlete goes through the new onboarding once.
    onboardedAt: null,
    aiConsentAt: null,
  };
  const alex: Profile = {
    ...base(DEMO_USERS.alex, createdAt),
    username: 'alex',
    displayName: 'Álex',
    sports: ['swim', 'bike', 'run'],
    level: 'advanced',
    thresholds: { ftpW: 272, runThresholdPaceSecPerKm: 252, swimCssSecPer100m: 96, maxHr: 188, lthr: 168, restingHr: 46 },
    availability: {
      weeklyHoursTarget: 11,
      restDay: 4,
      longSessionDays: [5, 6],
      windows: windows(
        [
          { start: '06:30', end: '08:00' },
          { start: '18:30', end: '21:00' },
        ],
        { start: '08:30', end: '13:30' },
      ),
      poolDays: [1, 3],
    },
    visibility: 'full',
    coachNotes: 'Trabaja de 9 a 17:30. Fútbol 7 algún martes.',
    onboardedAt: createdAt,
    aiConsentAt: null,
  };
  return [diego, alex, simpleProfile(DEMO_USERS.lucia, 'lucia', 'Lucía', createdAt), simpleProfile(DEMO_USERS.marcos, 'marcos', 'Marcos', createdAt)];
}

function simpleProfile(id: string, username: string, displayName: string, createdAt: ISODateTime): Profile {
  return {
    ...base(id, createdAt),
    username,
    displayName,
    sports: ['swim', 'bike', 'run'],
    level: 'intermediate',
    thresholds: {},
    availability: {
      weeklyHoursTarget: 7,
      restDay: 0,
      longSessionDays: [5, 6],
      windows: windows([{ start: '18:30', end: '21:00' }], { start: '09:00', end: '12:00' }),
      poolDays: [],
    },
    visibility: 'summary',
    coachNotes: null,
    onboardedAt: createdAt,
    aiConsentAt: null,
  };
}
