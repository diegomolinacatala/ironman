import { describe, expect, test } from '@jest/globals';

import type { Profile } from '@/domain/types';

import { DEFAULT_AVAILABILITY } from '../../settings/availabilityModel';
import {
  EMPTY_RACE,
  ONBOARDING_STEPS,
  buildProfilePatch,
  canAdvance,
  hasRaceInput,
  initialOnboardingState,
  isGeneratedUsername,
  raceDraftFromInput,
  stepIndex,
  toggleSport,
  type StepChecks,
} from '../onboardingModel';

const OK: StepChecks = { usernameError: null, usernameAvailable: true, raceError: null };

const PROFILE: Profile = {
  id: 'u1',
  username: 'diego',
  displayName: 'Diego',
  avatarUrl: null,
  sports: ['run'],
  level: 'advanced',
  thresholds: { ftpW: 250, restingHr: 45 },
  availability: { ...DEFAULT_AVAILABILITY, weeklyHoursTarget: 10 },
  visibility: 'full',
  notificationPrefs: {
    workoutReminders: true,
    reminderMinutesBefore: 30,
    morningSummary: true,
    morningTime: '07:30',
    eveningCheckin: true,
    eveningTime: '21:30',
    weeklyPlanReminder: true,
    social: true,
  },
  timezone: 'Europe/Madrid',
  coachNotes: null,
  onboardedAt: null,
  aiConsentAt: null,
  createdAt: '2026-10-25T10:00:00.000Z',
};

describe('onboardingModel', () => {
  test('has seven steps ending in done', () => {
    expect(ONBOARDING_STEPS).toHaveLength(7);
    expect(stepIndex('done')).toBe(6);
    expect(stepIndex('identity')).toBe(0);
  });

  test('initial state defaults and profile prefill', () => {
    const empty = initialOnboardingState(null);
    expect(empty.sports).toEqual(['swim', 'bike', 'run']);
    expect(empty.availability).toEqual(DEFAULT_AVAILABILITY);
    const filled = initialOnboardingState(PROFILE);
    expect(filled).toMatchObject({ displayName: 'Diego', username: 'diego', level: 'advanced', sports: ['run'] });
    expect(filled.thresholds.ftpW).toBe('250');
    expect(filled.availability.weeklyHoursTarget).toBe(10);
  });

  test('auto-generated usernames are replaced by a suggestion from the name', () => {
    expect(isGeneratedUsername('u1a2b3c4d')).toBe(true);
    expect(isGeneratedUsername('diego')).toBe(false);
    const state = initialOnboardingState({ ...PROFILE, username: 'u0f9e8d7c', displayName: 'Álex Ruiz' });
    expect(state.username).toBe('alex.ruiz');
  });

  test('identity step needs a name, a valid username and availability not false', () => {
    const state = { ...initialOnboardingState(null), displayName: 'Ana', username: 'ana' };
    expect(canAdvance('identity', state, OK)).toBe(true);
    expect(canAdvance('identity', { ...state, displayName: '  ' }, OK)).toBe(false);
    expect(canAdvance('identity', state, { ...OK, usernameError: 'Mínimo 3' })).toBe(false);
    expect(canAdvance('identity', state, { ...OK, usernameAvailable: false })).toBe(false);
    expect(canAdvance('identity', state, { ...OK, usernameAvailable: undefined })).toBe(true);
  });

  test('sports, thresholds and race checks', () => {
    const state = initialOnboardingState(null);
    expect(canAdvance('sports', { ...state, sports: [] }, OK)).toBe(false);
    expect(canAdvance('thresholds', { ...state, thresholds: { ...state.thresholds, ftpW: '9999' } }, OK)).toBe(false);
    expect(canAdvance('race', state, { ...OK, raceError: 'x' })).toBe(true);
    const withRace = { ...state, race: { ...EMPTY_RACE, name: 'Triatlón de Valencia' } };
    expect(canAdvance('race', withRace, { ...OK, raceError: 'Falta la fecha' })).toBe(false);
    expect(canAdvance('permissions', state, OK)).toBe(true);
  });

  test('raceDraftFromInput only when filled with a date', () => {
    expect(hasRaceInput(EMPTY_RACE)).toBe(false);
    expect(raceDraftFromInput({ ...EMPTY_RACE, name: 'X' })).toBeNull();
    expect(raceDraftFromInput({ ...EMPTY_RACE, name: ' Valencia ', date: '2027-04-18', distance: 'half' })).toEqual({
      name: 'Valencia',
      date: '2027-04-18',
      distance: 'half',
      priority: 'A',
    });
  });

  test('buildProfilePatch includes every collected field and onboardedAt', () => {
    const state = { ...initialOnboardingState(PROFILE), displayName: ' Diego M ' };
    const patch = buildProfilePatch(state, '2026-10-25T12:00:00.000Z', PROFILE.thresholds);
    expect(patch).toEqual({
      displayName: 'Diego M',
      username: 'diego',
      sports: ['run'],
      level: 'advanced',
      availability: PROFILE.availability,
      thresholds: { ftpW: 250, restingHr: 45 },
      onboardedAt: '2026-10-25T12:00:00.000Z',
    });
  });

  test('toggleSport is immutable', () => {
    const sports = ['swim'] as const;
    expect(toggleSport(sports, 'run')).toEqual(['swim', 'run']);
    expect(toggleSport(sports, 'swim')).toEqual([]);
    expect(sports).toEqual(['swim']);
  });
});
