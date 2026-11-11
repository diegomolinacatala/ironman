/**
 * v2 onboarding step machine (pure). Seven guided steps, one idea per screen.
 * The screen keeps the current step id, persists it per user (resume) and asks
 * this module where to go next/back and which steps block progress.
 */
import type { IntegrationStatus, PersonalToken, Profile, ProfilePatch, TrainableSport, WatchBrand } from '@/domain/types';
import { usernameSchema } from '@/domain/validation';
import { watchBrandOf, watchName } from '@/features/settings/watchBrand';
import type { IconName } from '@/ui';

import { suggestUsername } from '../settings/format';
import { claudeLinkState } from './connectModel';

export type OnboardingStepId = 'welcome' | 'goal' | 'garmin' | 'claude' | 'calendar' | 'morning' | 'plan';

export interface OnboardingStep {
  id: OnboardingStepId;
  icon: IconName;
  overline: string;
  title: string;
  subtitle: string;
  /** Onboarding cannot go past it until it is satisfied (see `isStepSatisfied`). */
  required: boolean;
  /** Needs the iPhone (calendar, notifications, widgets): skipped on web. */
  nativeOnly: boolean;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'welcome',
    icon: 'bolt',
    overline: 'Bienvenida',
    title: 'Tu coach de bolsillo',
    subtitle: 'Te prepara para tu carrera con lo que de verdad pasa en tu día.',
    required: true,
    nativeOnly: false,
  },
  {
    id: 'goal',
    icon: 'flag',
    overline: 'Tu objetivo',
    title: '¿A por qué vamos?',
    subtitle: 'Con tu carrera y tus horas, el plan sabe cuánto apretar.',
    required: false,
    nativeOnly: false,
  },
  {
    // Kept as 'garmin' so onboardings saved before COROS resume here: it is "Tu reloj" now.
    id: 'garmin',
    icon: 'watch',
    overline: 'Tu reloj',
    title: 'Conecta tu reloj',
    subtitle: 'Así sé cómo duermes, cómo te recuperas y lo que entrenas. Es un minuto.',
    required: true,
    nativeOnly: false,
  },
  {
    id: 'claude',
    icon: 'sparkles',
    overline: 'Claude',
    title: 'Conecta tu Claude',
    subtitle: 'Habla con Claude de tu plan y lo cambia por ti.',
    required: true,
    nativeOnly: false,
  },
  {
    id: 'calendar',
    icon: 'calendarCheck',
    overline: 'Calendario',
    title: 'Tu plan, en tu calendario',
    subtitle: 'Leo cuándo estás ocupado y apunto tus entrenos con aviso.',
    required: false,
    nativeOnly: true,
  },
  {
    id: 'morning',
    icon: 'sunrise',
    overline: 'Cada mañana',
    title: 'Tu informe de cada mañana',
    subtitle: 'Cómo has dormido y qué toca hoy, en un aviso que puedes escuchar.',
    required: false,
    nativeOnly: true,
  },
  {
    id: 'plan',
    icon: 'week',
    overline: 'Tu plan',
    title: 'Preparando tu plan',
    subtitle: 'Con todo lo que me has contado, armo tus próximos días.',
    required: false,
    nativeOnly: false,
  },
];

const ORDER: readonly OnboardingStepId[] = ONBOARDING_STEPS.map((s) => s.id);

export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return typeof value === 'string' && (ORDER as readonly string[]).includes(value);
}

/** Steps shown on this platform: web skips the native-only ones automatically. */
export function visibleSteps(platform: string): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((s) => platform !== 'web' || !s.nativeOnly);
}

export function stepIndexOf(steps: readonly OnboardingStep[], id: OnboardingStepId): number {
  return steps.findIndex((s) => s.id === id);
}

export function nextStepId(steps: readonly OnboardingStep[], id: OnboardingStepId): OnboardingStepId | null {
  const index = stepIndexOf(steps, id);
  return index >= 0 && index < steps.length - 1 ? (steps[index + 1]?.id ?? null) : null;
}

export function prevStepId(steps: readonly OnboardingStep[], id: OnboardingStepId): OnboardingStepId | null {
  const index = stepIndexOf(steps, id);
  return index > 0 ? (steps[index - 1]?.id ?? null) : null;
}

/**
 * Back is offered except on the first step, while something is in flight
 * (connecting, saving) and on the plan step (it generates and applies the plan:
 * going back and forth would do it twice).
 */
export function canGoBack(steps: readonly OnboardingStep[], id: OnboardingStepId, busy: boolean): boolean {
  if (busy || id === 'plan') return false;
  return prevStepId(steps, id) !== null;
}

/** "Conecta tu Garmin" / "Conecta tu COROS": the watch step names the watch chosen on it. */
export function watchStepTitle(brand: WatchBrand): string {
  return `Conecta tu ${watchName(brand)}`;
}

/** What we know about the athlete, to gate required steps and to resume. */
export interface OnboardingFacts {
  displayName: string;
  /**
   * Their watch is connected (Garmin: the key; COROS: Apple Salud enabled on this device), or the
   * athlete chose "Seguir sin reloj".
   */
  watchDone: boolean;
  /** Claude connected (a used `mcp` token), or the athlete chose to skip it for now. */
  claudeDone: boolean;
}

/**
 * Facts from the server state, this device's Apple Salud opt-in (`healthEnabled`, what a COROS
 * watch needs) and the locally stored skip/done flags.
 */
export function onboardingFacts(
  profile: Pick<Profile, 'displayName' | 'watchBrand'>,
  integrations: readonly IntegrationStatus[] | undefined,
  tokens: readonly PersonalToken[] | undefined,
  local: Pick<StoredProgress, 'claudeDone' | 'garminSkipped'>,
  healthEnabled = false,
): OnboardingFacts {
  const garminConnected = (integrations ?? []).some((i) => i.provider === 'garmin_personal' && i.state === 'connected');
  const watchConnected = watchBrandOf(profile) === 'coros' ? healthEnabled : garminConnected;
  return {
    displayName: profile.displayName ?? '',
    watchDone: local.garminSkipped || watchConnected,
    claudeDone: local.claudeDone || claudeLinkState(tokens ?? [], null) === 'connected',
  };
}

/** Whether a step lets the athlete move on (always true for optional steps). */
export function isStepSatisfied(id: OnboardingStepId, facts: OnboardingFacts): boolean {
  switch (id) {
    case 'welcome':
      return facts.displayName.trim().length > 0;
    case 'garmin':
      return facts.watchDone;
    case 'claude':
      return facts.claudeDone;
    default:
      return true;
  }
}

/**
 * Where to resume: the saved step, unless an earlier required step is not
 * satisfied any more (e.g. the watch was disconnected meanwhile). A saved step
 * hidden on this platform resumes at the next visible one.
 */
export function resolveResumeStep(
  steps: readonly OnboardingStep[],
  saved: OnboardingStepId | null,
  facts: OnboardingFacts,
): OnboardingStepId {
  const first = steps[0]?.id ?? 'welcome';
  let target = 0;
  if (saved) {
    const savedOrder = ORDER.indexOf(saved);
    const visible = steps.findIndex((s) => ORDER.indexOf(s.id) >= savedOrder);
    target = visible >= 0 ? visible : steps.length - 1;
  }
  const blocking = steps.findIndex((s, i) => i < target && s.required && !isStepSatisfied(s.id, facts));
  return steps[blocking >= 0 ? blocking : target]?.id ?? first;
}

// ---------------------------------------------------------------------------
// Persisted progress (AsyncStorage, per user)
// ---------------------------------------------------------------------------

export const PROGRESS_VERSION = 2;

export interface StoredProgress {
  version: typeof PROGRESS_VERSION;
  step: OnboardingStepId;
  /** Claude connected or skipped (demo connections have no `lastUsedAt` to check later). */
  claudeDone: boolean;
  /**
   * "Seguir sin reloj" (no watch, Garmin down, key rejected, no iPhone for COROS…) or the demo's
   * simulated COROS. Name kept from v2 so saved onboardings still parse.
   */
  garminSkipped: boolean;
  /** Id (never the secret URL) of the connector token created by this onboarding, to avoid minting another. */
  claudeTokenId: string | null;
  /** Mondays whose first plan was already generated and applied (never applied twice). */
  plannedWeeks: string[];
}

export function emptyProgress(step: OnboardingStepId): StoredProgress {
  return { version: PROGRESS_VERSION, step, claudeDone: false, garminSkipped: false, claudeTokenId: null, plannedWeeks: [] };
}

export function parseStoredProgress(value: unknown): StoredProgress | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== PROGRESS_VERSION || !isOnboardingStepId(record.step)) return null;
  const weeks = Array.isArray(record.plannedWeeks) ? record.plannedWeeks.filter((w): w is string => typeof w === 'string') : [];
  return {
    version: PROGRESS_VERSION,
    step: record.step,
    claudeDone: record.claudeDone === true,
    garminSkipped: record.garminSkipped === true,
    claudeTokenId: typeof record.claudeTokenId === 'string' ? record.claudeTokenId : null,
    plannedWeeks: weeks,
  };
}

// ---------------------------------------------------------------------------
// Welcome step
// ---------------------------------------------------------------------------

export const NAME_MAX = 60;

/** Default time of the morning report ("Informe de cada mañana"). */
export const DEFAULT_MORNING_TIME = '07:00';

/** "Lee tu reloj" on the welcome step: the chosen watch, or both when none is chosen yet. */
export function welcomeWatchValue(watchBrand: WatchBrand | null | undefined): { title: string; text: string } {
  if (watchBrand === 'coros') return { title: 'Lee tu COROS', text: 'Sueño, recuperación y entrenos, sin apuntar nada.' };
  if (watchBrand === 'garmin') return { title: 'Lee tu Garmin', text: 'Sueño, VFC y entrenos, sin apuntar nada.' };
  return { title: 'Lee tu reloj', text: 'Garmin o COROS: sueño, recuperación y entrenos, sin apuntar nada.' };
}

/** Usernames auto-generated by the sign-up trigger ("u" + 8 hex chars). */
export function isGeneratedUsername(username: string | null | undefined): boolean {
  return /^u[0-9a-f]{8}$/.test(username ?? '');
}

export function nameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Dinos cómo te llamas';
  if (trimmed.length > NAME_MAX) return `Máximo ${NAME_MAX} caracteres`;
  return null;
}

/**
 * Profile patches to try, in order, when saving the name. A generated
 * "u1a2b3c4" username is replaced by one suggested from the name; if that one
 * is taken the next attempt saves just the name. Empty when nothing changes.
 */
export function welcomePatches(profile: Pick<Profile, 'displayName' | 'username'>, name: string): ProfilePatch[] {
  const displayName = name.trim();
  const suggested = suggestUsername(displayName);
  const canRename = isGeneratedUsername(profile.username) && usernameSchema.safeParse(suggested).success;
  if (canRename) return [{ displayName, username: suggested }, { displayName }];
  return displayName === profile.displayName ? [] : [{ displayName }];
}

export function toggleSport(sports: readonly TrainableSport[], sport: TrainableSport): TrainableSport[] {
  return sports.includes(sport) ? sports.filter((s) => s !== sport) : [...sports, sport];
}
