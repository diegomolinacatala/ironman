import { describe, expect, test } from '@jest/globals';

import type { IntegrationStatus, PersonalToken } from '@/domain/types';

import {
  ONBOARDING_STEPS,
  emptyProgress,
  canGoBack,
  isGeneratedUsername,
  isStepSatisfied,
  nameError,
  nextStepId,
  onboardingFacts,
  parseStoredProgress,
  prevStepId,
  resolveResumeStep,
  toggleSport,
  visibleSteps,
  welcomePatches,
  type OnboardingFacts,
} from '../onboardingModel';

const ALL_DONE: OnboardingFacts = { displayName: 'Diego', garminDone: true, claudeDone: true };
const NOTHING: OnboardingFacts = { displayName: '', garminDone: false, claudeDone: false };

const ios = visibleSteps('ios');
const web = visibleSteps('web');

function token(patch: Partial<PersonalToken> = {}): PersonalToken {
  return {
    id: 't1',
    scope: 'mcp',
    label: 'Claude',
    prefix: 'rb_1234',
    createdAt: '2026-10-27T08:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    ...patch,
  };
}

describe('steps', () => {
  test('the seven v2 steps, in order', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual(['welcome', 'goal', 'garmin', 'claude', 'calendar', 'morning', 'plan']);
    expect(ONBOARDING_STEPS.filter((s) => s.required).map((s) => s.id)).toEqual(['welcome', 'garmin', 'claude']);
  });

  test('web skips the native-only steps (calendar, morning report)', () => {
    expect(ios.map((s) => s.id)).toHaveLength(7);
    expect(web.map((s) => s.id)).toEqual(['welcome', 'goal', 'garmin', 'claude', 'plan']);
    expect(nextStepId(web, 'claude')).toBe('plan');
    expect(prevStepId(web, 'plan')).toBe('claude');
  });

  test('next/prev stop at the ends', () => {
    expect(prevStepId(ios, 'welcome')).toBeNull();
    expect(nextStepId(ios, 'plan')).toBeNull();
    expect(nextStepId(ios, 'garmin')).toBe('claude');
  });

  test('back is hidden on the first step, while busy and on the plan step', () => {
    expect(canGoBack(ios, 'welcome', false)).toBe(false);
    expect(canGoBack(ios, 'goal', false)).toBe(true);
    expect(canGoBack(ios, 'garmin', true)).toBe(false);
    expect(canGoBack(ios, 'plan', false)).toBe(false);
  });
});

describe('required-step gating', () => {
  test('welcome needs a name, Garmin and Claude a connection or a skip', () => {
    expect(isStepSatisfied('welcome', NOTHING)).toBe(false);
    expect(isStepSatisfied('welcome', { ...NOTHING, displayName: '  Ana ' })).toBe(true);
    expect(isStepSatisfied('garmin', NOTHING)).toBe(false);
    expect(isStepSatisfied('garmin', { ...NOTHING, garminDone: true })).toBe(true);
    expect(isStepSatisfied('claude', NOTHING)).toBe(false);
    expect(isStepSatisfied('claude', { ...NOTHING, claudeDone: true })).toBe(true);
  });

  test('optional steps never block', () => {
    for (const id of ['goal', 'calendar', 'morning', 'plan'] as const) expect(isStepSatisfied(id, NOTHING)).toBe(true);
  });
});

describe('resume', () => {
  test('starts at the welcome step without saved progress', () => {
    expect(resolveResumeStep(ios, null, NOTHING)).toBe('welcome');
  });

  test('resumes at the saved step when everything before it is satisfied', () => {
    expect(resolveResumeStep(ios, 'calendar', ALL_DONE)).toBe('calendar');
  });

  test('goes back to the first unsatisfied required step (Garmin disconnected meanwhile)', () => {
    expect(resolveResumeStep(ios, 'morning', { ...ALL_DONE, garminDone: false })).toBe('garmin');
    expect(resolveResumeStep(ios, 'plan', { ...ALL_DONE, claudeDone: false })).toBe('claude');
  });

  test('the saved step itself may be unsatisfied (that is where the athlete was)', () => {
    expect(resolveResumeStep(ios, 'garmin', { ...ALL_DONE, garminDone: false })).toBe('garmin');
  });

  test('a native-only step saved on the iPhone resumes at the next visible step on web', () => {
    expect(resolveResumeStep(web, 'calendar', ALL_DONE)).toBe('plan');
    expect(resolveResumeStep(web, 'morning', ALL_DONE)).toBe('plan');
  });

  test('stored progress is validated', () => {
    expect(
      parseStoredProgress({ version: 2, step: 'garmin', claudeDone: true, garminSkipped: true, claudeTokenId: 't9', plannedWeeks: ['2026-10-26', 3] }),
    ).toEqual({ version: 2, step: 'garmin', claudeDone: true, garminSkipped: true, claudeTokenId: 't9', plannedWeeks: ['2026-10-26'] });
    expect(parseStoredProgress({ version: 2, step: 'garmin' })).toEqual(emptyProgress('garmin'));
    expect(parseStoredProgress({ version: 1, step: 'garmin' })).toBeNull();
    expect(parseStoredProgress({ version: 2, step: 'identity' })).toBeNull();
    expect(parseStoredProgress('garmin')).toBeNull();
    expect(parseStoredProgress(null)).toBeNull();
  });
});

describe('facts from the server', () => {
  const connected: IntegrationStatus = { provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null };
  const none = { claudeDone: false, garminSkipped: false };

  test('Garmin is done when connected (not expired) or skipped', () => {
    expect(onboardingFacts({ displayName: 'D' }, [connected], [], none).garminDone).toBe(true);
    expect(onboardingFacts({ displayName: 'D' }, [{ ...connected, state: 'expired' }], [], none).garminDone).toBe(false);
    expect(onboardingFacts({ displayName: 'D' }, undefined, undefined, none).garminDone).toBe(false);
    expect(onboardingFacts({ displayName: 'D' }, [], [], { ...none, garminSkipped: true }).garminDone).toBe(true);
  });

  test('Claude is done with a used connector token or the stored flag (demo / skipped)', () => {
    expect(onboardingFacts({ displayName: 'D' }, [], [token()], none).claudeDone).toBe(false);
    expect(onboardingFacts({ displayName: 'D' }, [], [token({ lastUsedAt: '2026-10-27T09:00:00Z' })], none).claudeDone).toBe(true);
    expect(onboardingFacts({ displayName: 'D' }, [], [], { ...none, claudeDone: true }).claudeDone).toBe(true);
  });
});

describe('welcome', () => {
  test('name validation', () => {
    expect(nameError('')).toBe('Dinos cómo te llamas');
    expect(nameError('   ')).toBe('Dinos cómo te llamas');
    expect(nameError('x'.repeat(61))).toMatch(/Máximo/);
    expect(nameError('Diego')).toBeNull();
  });

  test('a generated username is replaced by one from the name, falling back to the name only', () => {
    expect(isGeneratedUsername('u1a2b3c4d')).toBe(true);
    expect(isGeneratedUsername('diego')).toBe(false);
    expect(welcomePatches({ displayName: '', username: 'u1a2b3c4d' }, ' Diego Molina ')).toEqual([
      { displayName: 'Diego Molina', username: 'diego.molina' },
      { displayName: 'Diego Molina' },
    ]);
  });

  test('a chosen username is kept and an unchanged name saves nothing', () => {
    expect(welcomePatches({ displayName: 'Diego', username: 'diego' }, 'Diego')).toEqual([]);
    expect(welcomePatches({ displayName: 'Diego', username: 'diego' }, 'Diego M')).toEqual([{ displayName: 'Diego M' }]);
  });

  test('a name too short for a username saves just the name', () => {
    expect(welcomePatches({ displayName: '', username: 'u1a2b3c4d' }, 'Al')).toEqual([{ displayName: 'Al' }]);
  });

  test('toggleSport adds and removes without mutating', () => {
    const sports = ['swim', 'bike'] as const;
    expect(toggleSport(sports, 'run')).toEqual(['swim', 'bike', 'run']);
    expect(toggleSport(sports, 'swim')).toEqual(['bike']);
    expect(sports).toEqual(['swim', 'bike']);
  });
});
