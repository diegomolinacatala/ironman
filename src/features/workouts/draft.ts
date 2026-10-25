/** Pure helpers to derive drafts / links from existing workouts. */
import type { JointSession, Sport, UUID, Workout, WorkoutDraft } from '@/domain/types';

/** Copy of a workout as a fresh draft (same day unless `date` is given). */
export function workoutToDraft(w: Workout, overrides: Partial<WorkoutDraft> = {}): WorkoutDraft {
  return {
    date: w.date,
    startTime: w.startTime,
    sport: w.sport,
    title: w.title,
    description: w.description,
    durationMin: w.durationMin,
    distanceM: w.distanceM,
    intensity: w.intensity,
    tss: w.tss,
    steps: w.steps.map((s) => ({ ...s })),
    isKey: w.isKey,
    source: 'manual',
    ...overrides,
  };
}

/** Swim distances are typed in metres, everything else in kilometres. */
export function distanceUnit(sport: Sport): 'm' | 'km' {
  return sport === 'swim' ? 'm' : 'km';
}

/** Text field value → metres (accepts "21,1" or "21.1"). Null when empty/invalid. */
export function parseDistanceInput(text: string, sport: Sport): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(distanceUnit(sport) === 'm' ? value : value * 1000);
}

/** Metres → text field value in the sport's unit ("21,1" km or "2500" m). */
export function formatDistanceInput(distanceM: number | null | undefined, sport: Sport): string {
  if (distanceM == null || distanceM <= 0) return '';
  if (distanceUnit(sport) === 'm') return String(Math.round(distanceM));
  const km = Math.round(distanceM / 100) / 10;
  return String(km).replace('.', ',');
}

/** Display names of the other participants of a joint session (accepted or invited). */
export function partnerNames(session: JointSession | undefined, myId: UUID | undefined): string[] {
  if (!session || session.status === 'cancelled') return [];
  return session.participants
    .filter((p) => p.userId !== myId && p.status !== 'declined')
    .map((p) => p.displayName.split(/\s+/)[0] ?? p.displayName);
}

/** "Álex" / "Álex y Marta" / null for the "con …" label of a workout. */
export function partnerNameFor(
  workout: Pick<Workout, 'jointSessionId'>,
  sessions: readonly JointSession[] | undefined,
  myId: UUID | undefined,
): string | null {
  if (!workout.jointSessionId) return null;
  const session = sessions?.find((s) => s.id === workout.jointSessionId);
  const names = partnerNames(session, myId);
  if (names.length === 0) return session ? null : 'tu grupo';
  if (names.length === 1) return names[0] ?? null;
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** Query string for /joint/new prefilled from a workout. */
export function jointNewHref(w: Workout): string {
  const params: Record<string, string> = {
    fromWorkoutId: w.id,
    date: w.date,
    sport: w.sport,
    durationMin: String(w.durationMin),
    title: w.title,
    ...(w.startTime ? { startTime: w.startTime } : {}),
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `/joint/new?${query}`;
}
