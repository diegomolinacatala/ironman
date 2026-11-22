/**
 * Short workout ids for the AI coach. Open models copy 36-char UUIDs badly
 * (a wrong character and the change was silently dropped), so the context
 * sent to the model names the editable workouts w1, w2… and the answer is
 * mapped back here. Unknown ids get a loose match (title, sport, date) and
 * are used only when exactly one planned workout fits. The prompt context is
 * also trimmed (labels, notes and timestamps the coach does not need), which
 * saves neurons of the shared free quota. Pure.
 */
import { UUID_PATTERN } from '../planning/changes.ts';
import type { PlanningContext, WorkoutView } from '../planning/context.ts';
import type { ISODate, UUID, Workout } from '../types.ts';

export interface ShortIds {
  /** w1 → UUID. */
  toUuid: ReadonlyMap<string, UUID>;
  /** UUID → w1. */
  toShort: ReadonlyMap<UUID, string>;
}

type Obj = Record<string, unknown>;

const SHORT_RE = /^#?\s*w\s*-?\s*(\d{1,3})$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function windowWorkouts(context: Pick<PlanningContext, 'week' | 'nextWeek'>): WorkoutView[] {
  return [...(context.week?.workouts ?? []), ...(context.nextWeek?.workouts ?? [])];
}

/** w1, w2… in date order over this week and the next. */
export function shortIdsFor(context: Pick<PlanningContext, 'week' | 'nextWeek'>): ShortIds {
  const toUuid = new Map<string, UUID>();
  const toShort = new Map<UUID, string>();
  windowWorkouts(context).forEach((w) => {
    if (toShort.has(w.id)) return;
    const short = `w${toShort.size + 1}`;
    toUuid.set(short, w.id);
    toShort.set(w.id, short);
  });
  return { toUuid, toShort };
}

/** The workout as the model sees it: short id, no Spanish labels (the prompt explains the codes). */
function promptWorkout(w: WorkoutView, ids: ShortIds): Obj {
  const { id, sportLabel: _s, intensityLabel: _i, ...rest } = w;
  return { id: ids.toShort.get(id) ?? id, ...rest };
}

function promptRecent(w: WorkoutView): Obj {
  // Past sessions cannot be changed: no id at all, so the model never targets them.
  const { id: _id, sportLabel: _s, intensityLabel: _i, ...rest } = w;
  return rest;
}

/**
 * The context JSON for the prompt: short ids, no labels, no MCP notes, no
 * timestamps or units (the system prompt states them).
 */
export function promptContext(context: PlanningContext, ids: ShortIds): Obj {
  const { generatedAt: _g, units: _u, notes: _n, week, nextWeek, recentSessions, jointSessions, ...rest } = context;
  return {
    ...rest,
    ...(week ? { week: { ...week, workouts: (week.workouts ?? []).map((w) => promptWorkout(w, ids)) } } : {}),
    ...(nextWeek ? { nextWeek: { ...nextWeek, workouts: (nextWeek.workouts ?? []).map((w) => promptWorkout(w, ids)) } } : {}),
    ...(jointSessions
      ? {
          jointSessions: jointSessions.map((s) => {
            const mine = typeof s.myWorkoutId === 'string' ? s.myWorkoutId : null;
            return { ...s, myWorkoutId: mine ? ids.toShort.get(mine) ?? null : null };
          }),
        }
      : {}),
    ...(recentSessions ? { recentSessions: recentSessions.map(promptRecent) } : {}),
  };
}

/** Workout UUIDs inside free text (chat history) → their short ids. */
export function shortenUuids(text: string, ids: ShortIds): string {
  return text.replace(UUID_ANYWHERE, (uuid) => ids.toShort.get(uuid.toLowerCase()) ?? ids.toShort.get(uuid) ?? uuid);
}

/** Short ids the model may use, one line each ("w1 mar 2026-10-27 run «Series»"), for repair prompts. */
export function idLegend(context: Pick<PlanningContext, 'week' | 'nextWeek'>, ids: ShortIds, today: ISODate): string {
  return windowWorkouts(context)
    .filter((w) => w.status === 'planned' && w.date >= today)
    .map((w) => `${ids.toShort.get(w.id) ?? w.id} ${w.weekday} ${w.date} ${w.sport} «${w.title}»`)
    .join('\n');
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** What the change says about its target (besides the id). */
export interface TargetHints {
  op: 'add' | 'update' | 'move' | 'delete';
  title: string | null;
  sport: string | null;
  /** For delete: the workout's date. For move/update it is the NEW date, so it is not used. */
  date: string | null;
}

function looseMatch(raw: string, hints: TargetHints, workouts: readonly Workout[], today: ISODate): UUID | null {
  const editable = workouts.filter((w) => w.status === 'planned' && w.date >= today);
  const wanted = [raw, hints.title ?? ''].map(normalize).filter((s) => s.length >= 3 && !SHORT_RE.test(s));
  const byTitle = wanted.length
    ? editable.filter((w) => {
        const title = normalize(w.title);
        return wanted.some((t) => title === t || title.includes(t) || t.includes(title));
      })
    : [];
  let candidates = byTitle.length > 0 ? byTitle : hints.sport ? editable.filter((w) => w.sport === hints.sport) : [];
  if (hints.op === 'delete' && hints.date) {
    const sameDay = candidates.filter((w) => w.date === hints.date);
    if (sameDay.length > 0) candidates = sameDay;
  }
  return candidates.length === 1 ? candidates[0].id : null;
}

export interface ResolvedId {
  id: UUID | null;
  /** True when found by title/sport/date instead of its id. */
  loose: boolean;
}

/**
 * The UUID the model meant: a short id (w3, "W 3", "#w3"), a real UUID of the
 * window, or a unique loose match. Null when nothing fits.
 */
export function resolveWorkoutId(raw: unknown, hints: TargetHints, ids: ShortIds, workouts: readonly Workout[], today: ISODate): ResolvedId {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const short = SHORT_RE.exec(text);
  if (short) {
    const id = ids.toUuid.get(`w${Number(short[1])}`);
    if (id) return { id, loose: false };
  }
  if (UUID_PATTERN.test(text)) {
    const exact = workouts.find((w) => w.id.toLowerCase() === text.toLowerCase());
    if (exact) return { id: exact.id, loose: false };
  }
  const loose = looseMatch(text, hints, workouts, today);
  return { id: loose, loose: loose !== null };
}
