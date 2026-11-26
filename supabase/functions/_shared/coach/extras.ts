/**
 * Side effects of a valid coach answer beyond the plan proposal (docs/V2.md §3):
 * memory lines appended to `profiles.coach_notes` and the imprevisto logged in
 * `life_events`, plus the quedada suggested with a friend (validated, never
 * sent: the app opens a prefilled form) and (v4) the general plan of the next
 * weeks (validated, never saved here: the app saves it on the athlete's tap).
 * Only for what the athlete said themselves in a chat (mode 'chat' with a
 * non-empty message): plan_week (onboarding) and replans never write them.
 * Each one is best effort: a failure is logged and never fails the job (the
 * reply and proposal still reach the athlete).
 */
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { PlanningContext } from '../planning/context.ts';
import type { PlanningReader } from '../planning/store.ts';
import type { CoachJobExtras, CoachQuedada, CoachRequest, UUID, WeekPlanDraft } from '../types.ts';
import { isDuplicateLifeEvent, toLifeEventInsert } from './life-event.ts';
import { mergeCoachNotes, normalizeMemory } from './memory.ts';
import type { CoachOutput } from './output.ts';
import type { CoachStore } from './ports.ts';
import { toCoachQuedada } from './quedada.ts';
import { toCoachWeekPlans } from './week-plans.ts';

export interface ExtrasDeps {
  reader: Pick<PlanningReader, 'getProfile' | 'listRaces'>;
  store: Pick<CoachStore, 'insertLifeEvent' | 'updateCoachNotes'>;
}

/** What `coach_jobs.extras` holds when nothing was written or suggested. */
export function noExtras(): CoachJobExtras {
  return { memory: [], lifeEventId: null, quedada: null, weekPlans: [] };
}

/** Appends new facts to coach_notes (re-read just before writing). Returns the facts remembered. */
async function remember(deps: ExtrasDeps, userId: UUID, raw: readonly string[], log: Logger): Promise<string[]> {
  const memory = normalizeMemory(raw);
  if (memory.length === 0) return [];
  try {
    const profile = await deps.reader.getProfile(userId);
    const merged = mergeCoachNotes(profile?.coachNotes ?? null, memory);
    if (merged.notes !== null) await deps.store.updateCoachNotes(userId, merged.notes);
    log.info('coach memory saved', { items: memory.length, added: merged.added.length, skipped: merged.skipped.length });
    // What the athlete sees as "remembered": facts now in the notes (new or already there).
    return memory.filter((m) => !merged.skipped.includes(m));
  } catch (error) {
    log.warn('coach memory not saved', errorInfo(error));
    return [];
  }
}

async function logLifeEvent(deps: ExtrasDeps, userId: UUID, raw: unknown, context: PlanningContext, log: Logger): Promise<UUID | null> {
  if (raw === null || raw === undefined) return null;
  const parsed = toLifeEventInsert(raw, context.today);
  if (!parsed.ok) {
    log.info('coach life event dropped', { reason: parsed.error });
    return null;
  }
  if (isDuplicateLifeEvent(parsed.value, context.lifeEvents)) {
    log.info('coach life event already logged', { kind: parsed.value.kind });
    return null;
  }
  try {
    return await deps.store.insertLifeEvent(userId, parsed.value);
  } catch (error) {
    log.warn('coach life event not saved', errorInfo(error));
    return null;
  }
}

/** The suggested quedada, when it targets a friend of this request inside the plan window. */
function suggestQuedada(request: Pick<CoachRequest, 'friendIds'>, raw: unknown, context: PlanningContext, log: Logger): CoachQuedada | null {
  if (raw === null || raw === undefined) return null;
  const parsed = toCoachQuedada(raw, {
    friendIds: request.friendIds ?? [],
    friends: context.friends,
    today: context.today,
    weekStart: context.weekStart,
  });
  if (!parsed.ok) {
    log.info('coach quedada dropped', { reason: parsed.error });
    return null;
  }
  return parsed.value;
}

/** The general plan suggested for the next weeks (checked against the athlete's periodization). */
async function suggestWeekPlans(deps: ExtrasDeps, userId: UUID, raw: unknown, context: PlanningContext, log: Logger): Promise<WeekPlanDraft[]> {
  if (raw === null || raw === undefined) return [];
  try {
    const races = await deps.reader.listRaces(userId);
    const level = typeof context.athlete.level === 'string' ? context.athlete.level : null;
    const { weekPlans, dropped } = toCoachWeekPlans(raw, { today: context.today, races, level });
    if (dropped.length > 0) log.info('coach week plans dropped', { dropped: dropped.slice(0, 5) });
    return weekPlans;
  } catch (error) {
    log.warn('coach week plans not checked', errorInfo(error));
    return [];
  }
}

/** Only a chat message typed or dictated by the athlete may add memory or imprevistos. */
export function mayWriteExtras(request: Pick<CoachRequest, 'mode' | 'message'>): boolean {
  return request.mode === 'chat' && (request.message ?? '').trim().length > 0;
}

/** Runs both side effects, checks the quedada and the week plans and returns what goes into `coach_jobs.extras`. */
export async function applyCoachExtras(
  deps: ExtrasDeps,
  userId: UUID,
  request: Pick<CoachRequest, 'mode' | 'message' | 'friendIds'>,
  output: Pick<CoachOutput, 'memory' | 'life_event' | 'quedada' | 'week_plans'>,
  context: PlanningContext,
  log: Logger,
): Promise<CoachJobExtras> {
  if (!mayWriteExtras(request)) {
    if (output.memory.length || output.life_event || output.quedada || output.week_plans) log.info('coach extras ignored outside a chat message', { mode: request.mode });
    return noExtras();
  }
  const memory = await remember(deps, userId, output.memory, log);
  const lifeEventId = await logLifeEvent(deps, userId, output.life_event, context, log);
  const quedada = suggestQuedada(request, output.quedada, context, log);
  const weekPlans = await suggestWeekPlans(deps, userId, output.week_plans, context, log);
  return { memory, lifeEventId, quedada, weekPlans };
}
