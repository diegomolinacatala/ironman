import { describe, expect, test } from '@jest/globals';

import { RepositoryError } from '@/data/repository';
import type { DailyMetrics, PersonalToken, PlanChange, Profile, Race, Workout, WorkoutDraft } from '@/domain/types';

import { defaultReadCalendarIds, alarmLabel } from '../calendarModel';
import {
  DEMO_GARMIN_KEY,
  GARMIN_INVALID_KEY_MESSAGE,
  claudeLinkState,
  demoSafeKey,
  garminErrorMessage,
  importSummary,
  importSummaryLine,
  joinEs,
  latestUsedClaudeToken,
  reusableClaudeTokenForOnboarding,
  reusableClaudeTokenForSettings,
  tokensToRevokeBeforeCreate,
} from '../connectModel';
import { clampHours, goalError, goalProfilePatch, goalRaceDraft, initialGoal, nextRace, raceNeedsSave, type GoalInput } from '../goalModel';
import { planSummary, weeksToPlan } from '../planSummary';

const TODAY = '2026-10-27'; // Tuesday

function race(patch: Partial<Race>): Race {
  return {
    id: 'r1',
    userId: 'u1',
    name: 'Valencia',
    date: '2027-04-18',
    distance: 'olympic',
    priority: 'A',
    location: null,
    goal: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...patch,
  };
}

const profile = {
  sports: ['swim', 'bike', 'run'],
  availability: { weeklyHoursTarget: 9, restDay: 0, longSessionDays: [5, 6], windows: [], poolDays: [] },
} as unknown as Profile;

describe('goal', () => {
  test('prefills the next A race and the profile hours/sports', () => {
    const races = [race({ id: 'past', date: '2026-05-01' }), race({ id: 'b', priority: 'B', date: '2026-12-01' }), race({ id: 'a' })];
    expect(nextRace(races, TODAY)?.id).toBe('a');
    const goal = initialGoal(profile, races, TODAY);
    expect(goal).toMatchObject({ hasRace: true, raceId: 'a', weeklyHours: 9, sports: ['swim', 'bike', 'run'] });
    expect(goal.race).toEqual({ name: 'Valencia', date: '2027-04-18', distance: 'olympic' });
  });

  test('without races or profile: empty race, 8 h, triathlon sports', () => {
    const goal = initialGoal(null, [], TODAY);
    expect(goal).toMatchObject({ hasRace: true, raceId: null, weeklyHours: 8, sports: ['swim', 'bike', 'run'] });
  });

  test('validation: sports, then the race only when "Tengo carrera"', () => {
    const base: GoalInput = initialGoal(profile, [], TODAY);
    expect(goalError({ ...base, sports: [] }, TODAY)).toBe('Elige al menos un deporte');
    expect(goalError(base, TODAY)).toBe('Ponle un nombre a la carrera');
    expect(goalError({ ...base, race: { ...base.race, name: 'X' } }, TODAY)).toBe('Elige la fecha de la carrera');
    expect(goalError({ ...base, race: { name: 'X', date: '2026-01-01', distance: 'half' } }, TODAY)).toBe('Esa fecha ya ha pasado');
    expect(goalError({ ...base, race: { name: 'X', date: '2027-06-01', distance: 'half' } }, TODAY)).toBeNull();
    expect(goalError({ ...base, hasRace: false }, TODAY)).toBeNull();
    expect(goalRaceDraft({ ...base, hasRace: false })).toBeNull();
  });

  test('the race is saved only when new or edited', () => {
    const races = [race({})];
    const goal = initialGoal(profile, races, TODAY);
    expect(raceNeedsSave(goal, races)).toBe(false);
    expect(raceNeedsSave({ ...goal, race: { ...goal.race, name: 'Valencia 2027' } }, races)).toBe(true);
    expect(raceNeedsSave({ ...goal, raceId: null }, races)).toBe(true);
    expect(raceNeedsSave({ ...goal, hasRace: false }, races)).toBe(false);
  });

  test('hours are clamped to half hours and keep the rest of the availability', () => {
    expect(clampHours(0)).toBe(2);
    expect(clampHours(40)).toBe(25);
    expect(clampHours(7.3)).toBe(7.5);
    const patch = goalProfilePatch({ ...initialGoal(profile, [], TODAY), weeklyHours: 6 }, profile);
    expect(patch.availability).toEqual({ ...profile.availability, weeklyHoursTarget: 6 });
  });
});

describe('Garmin', () => {
  test('errors explain how to fix them', () => {
    expect(garminErrorMessage(new RepositoryError('validation', 'Garmin no acepta esta clave.'))).toBe(GARMIN_INVALID_KEY_MESSAGE);
    expect(garminErrorMessage(new RepositoryError('network', 'x'))).toMatch(/Sin conexión/);
    expect(garminErrorMessage(new Error('Clave de Garmin caducada o revocada.'))).toBe(GARMIN_INVALID_KEY_MESSAGE);
    expect(garminErrorMessage(new Error('Servidor caído'))).toBe('Servidor caído');
    expect(garminErrorMessage(null)).toMatch(/No hemos podido conectar/);
  });

  test('demo accepts any key', () => {
    expect(demoSafeKey('abc')).toBe(DEMO_GARMIN_KEY);
    expect(demoSafeKey(' abcdefghijklmnopqr ')).toBe('abcdefghijklmnopqr');
  });

  test('import summary counts Garmin days, kinds and activities', () => {
    const metric = (date: string, patch: Partial<DailyMetrics>): DailyMetrics =>
      ({ userId: 'u1', date, source: 'garmin', hrvMs: null, restingHr: null, sleepHours: null, sleepScore: null, bodyBattery: null, ...patch }) as DailyMetrics;
    const metrics = [
      metric('2026-10-25', { sleepHours: 7, hrvMs: 60 }),
      metric('2026-10-26', { sleepHours: 6.5, restingHr: 48 }),
      metric('2026-10-26', { source: 'healthkit', bodyBattery: 50 }),
      metric('2026-10-27', {}),
    ];
    const workouts = [
      { source: 'garmin', completed: null, externalId: null },
      { source: 'manual', completed: { source: 'garmin' }, externalId: null },
      { source: 'rules', completed: null, externalId: 'garmin:123' },
      { source: 'rules', completed: null, externalId: null },
    ] as unknown as Workout[];
    const summary = importSummary(metrics, workouts);
    expect(summary).toEqual({ days: 2, activities: 3, kinds: ['sueño', 'VFC', 'pulso en reposo'] });
    expect(importSummaryLine(summary)).toBe('2 días de sueño, VFC y pulso en reposo · 3 actividades');
    expect(importSummaryLine({ days: 0, activities: 0, kinds: [] })).toMatch(/irán llegando/);
    expect(importSummaryLine({ days: 1, activities: 1, kinds: ['sueño'] })).toBe('1 día de sueño · 1 actividad');
  });

  test('joinEs', () => {
    expect(joinEs([])).toBe('');
    expect(joinEs(['a'])).toBe('a');
    expect(joinEs(['a', 'b', 'c'])).toBe('a, b y c');
  });
});

describe('Claude', () => {
  const t = (id: string, patch: Partial<PersonalToken> = {}): PersonalToken => ({
    id,
    scope: 'mcp',
    label: 'Claude',
    prefix: 'rb_',
    createdAt: `2026-10-2${id}T00:00:00Z`,
    lastUsedAt: null,
    revokedAt: null,
    ...patch,
  });

  test('a new token waits until THAT token is used', () => {
    const old = t('1', { lastUsedAt: '2026-10-26T10:00:00Z' });
    expect(claudeLinkState([old, t('2')], '2')).toBe('waiting');
    expect(claudeLinkState([old, t('2', { lastUsedAt: '2026-10-27T10:00:00Z' })], '2')).toBe('connected');
    expect(claudeLinkState([old], '9')).toBe('waiting');
  });

  test('without a new token, any used active connector counts', () => {
    expect(claudeLinkState([t('1')], null)).toBe('none');
    expect(claudeLinkState([t('1', { lastUsedAt: '2026-10-26T10:00:00Z' })], null)).toBe('connected');
    expect(claudeLinkState([t('1', { lastUsedAt: '2026-10-26T10:00:00Z', revokedAt: '2026-10-27T00:00:00Z' })], null)).toBe('none');
    expect(claudeLinkState([t('1', { scope: 'ics', lastUsedAt: '2026-10-26T10:00:00Z' })], null)).toBe('none');
  });

  test('latest used token', () => {
    const tokens = [t('1', { lastUsedAt: '2026-10-20T10:00:00Z' }), t('2', { lastUsedAt: '2026-10-26T10:00:00Z' }), t('3')];
    expect(latestUsedClaudeToken(tokens)?.id).toBe('2');
  });

  test('before minting, every never-used link is revoked; used ones never', () => {
    const used = t('1', { lastUsedAt: '2026-10-26T10:00:00Z' });
    expect(tokensToRevokeBeforeCreate([used, t('3'), t('2'), t('4', { revokedAt: '2026-10-27T00:00:00Z' })])).toEqual(['2', '3']);
    expect(tokensToRevokeBeforeCreate([used])).toEqual([]);
  });

  test('settings wait on the latest unused link, unless Claude is already connected', () => {
    expect(reusableClaudeTokenForSettings([t('2'), t('3')])?.id).toBe('3');
    expect(reusableClaudeTokenForSettings([t('1', { lastUsedAt: '2026-10-26T10:00:00Z' }), t('3')])).toBeNull();
    expect(reusableClaudeTokenForSettings([])).toBeNull();
  });

  test('onboarding reuses only its own stored link, unused and younger than 10 minutes', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    const fresh = t('7', { createdAt: '2026-10-27T09:55:00Z' });
    const old = t('8', { createdAt: '2026-10-27T09:45:00Z' });
    expect(reusableClaudeTokenForOnboarding([fresh, old], '7', now)?.id).toBe('7');
    expect(reusableClaudeTokenForOnboarding([fresh, old], '8', now)).toBeNull();
    expect(reusableClaudeTokenForOnboarding([fresh], null, now)).toBeNull();
    expect(reusableClaudeTokenForOnboarding([{ ...fresh, lastUsedAt: '2026-10-27T09:58:00Z' }], '7', now)).toBeNull();
    expect(reusableClaudeTokenForOnboarding([{ ...fresh, revokedAt: '2026-10-27T09:58:00Z' }], '7', now)).toBeNull();
  });
});

describe('calendar', () => {
  test('reads everything except birthdays, holidays, Siri and our own calendar', () => {
    const calendars = [
      { id: 'work', title: 'Trabajo' },
      { id: 'bday', title: 'Cumpleaños' },
      { id: 'hol', title: 'Festivos en España' },
      { id: 'us', title: 'US Holidays' },
      { id: 'siri', title: 'Sugerencias de Siri' },
      { id: 'own', title: 'Road to Ironman' },
      { id: 'home', title: 'Casa' },
    ];
    expect(defaultReadCalendarIds(calendars)).toEqual(['work', 'home']);
  });

  test('alarm labels', () => {
    expect(alarmLabel(0)).toBe('sin aviso');
    expect(alarmLabel(30)).toBe('aviso 30 min antes');
    expect(alarmLabel(60)).toBe('aviso 1 h antes');
  });
});

describe('first plan', () => {
  test('plans this week, and next week too from Friday on', () => {
    expect(weeksToPlan('2026-10-27')).toEqual(['2026-10-26']);
    expect(weeksToPlan('2026-10-30')).toEqual(['2026-10-26', '2026-11-02']);
    expect(weeksToPlan('2026-11-01')).toEqual(['2026-10-26', '2026-11-02']);
  });

  const add = (patch: Partial<WorkoutDraft>): PlanChange => ({
    op: 'add',
    reason: 'plan',
    workout: { date: '2026-10-28', sport: 'run', title: 'Rodaje suave', durationMin: 50, intensity: 'endurance', ...patch },
  });

  test('three lines: sessions & time, the key session, the sport mix', () => {
    const changes: PlanChange[] = [
      add({}),
      add({ date: '2026-10-29', sport: 'swim', title: 'Técnica', durationMin: 45 }),
      add({ date: '2026-11-01', sport: 'bike', title: 'Tirada larga', durationMin: 150, isKey: true }),
      add({ date: '2026-10-30', sport: 'run', title: 'Series', durationMin: 60 }),
      add({ date: '2026-10-31', sport: 'rest', title: 'Descanso', durationMin: 0 }),
      add({ date: '2026-10-20', title: 'Pasado' }),
      { op: 'delete', workoutId: 'w1', reason: 'x' },
    ];
    expect(planSummary(changes, TODAY)).toEqual([
      "4 sesiones en los próximos días · 5h 5' en total",
      "La clave: Tirada larga, dom 1 nov (2h 30')",
      'Reparto: 2 de carrera, 1 de natación y 1 de bici',
    ]);
  });

  test('without new sessions it says so', () => {
    expect(planSummary([], TODAY)).toEqual(['Tu semana ya tenía plan: lo dejamos como está.']);
    expect(planSummary([{ op: 'delete', workoutId: 'w', reason: 'x' }], TODAY)).toEqual(['He ajustado tu semana a lo que me has contado.']);
  });
});
