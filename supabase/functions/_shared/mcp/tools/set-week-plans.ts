/**
 * set_week_plans: the general plan ("Plan → General") set by Claude — which
 * weeks are carga, más volumen, descarga or semana libre, optionally with the
 * week's minutes and a note — without detailing workouts. Applied directly
 * (source 'claude'; the app shows it at once), idempotent (upsert by week),
 * all-or-nothing validation, and the season rows as they result.
 */
import { addDays, DEFAULT_TZ, diffDays, startOfWeek, todayIn } from '../../dates.ts';
import { dateSchema } from '../../planning/changes.ts';
import { NotFoundError } from '../../planning/context.ts';
import { seasonOf, seasonView } from '../../planning/season-view.ts';
import type { SeasonView } from '../../planning/season-view.ts';
import { checkWeekPlans, checkWeekStart, CLAUDE_WEEK_PLAN_WEEKS, WEEK_PLAN_LIMITS } from '../../planning/week-plans.ts';
import type { PlanningStore } from '../../planning/store.ts';
import { array, enumOf, integer, nullable, object, optional, string } from '../../schema.ts';
import type { Infer } from '../../schema.ts';
import { WEEK_PLAN_KINDS } from '../../types.ts';
import type { ISODate, Profile, Race, UUID, WeekPlanDraft } from '../../types.ts';
import { defineTool, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

const TITLE = 'Ajustar el plan general (semanas)';
const MAX_WEEKS_PER_CALL = 26;
const MIN_SEASON_ROWS = 8;

const week = object({
  week_start: dateSchema(`Lunes de la semana (YYYY-MM-DD), de esta semana a ${CLAUDE_WEEK_PLAN_WEEKS} semanas vista.`),
  kind: enumOf(WEEK_PLAN_KINDS, 'load = carga normal; push = más volumen (+10 %); recovery = descarga (~40 % menos); rest = semana libre (actividad suave, sin estructura).'),
  target_minutes: optional(nullable(integer({ min: 0, max: WEEK_PLAN_LIMITS.minutesMax, description: 'Minutos de entrenamiento de esa semana; omítelo para usar los del plan.' }))),
  note: optional(nullable(string({ max: WEEK_PLAN_LIMITS.noteMax, description: 'El porqué en una frase, en español (se ve en Plan › General).' }))),
});

const input = object({
  weeks: optional(array(week, { min: 1, max: MAX_WEEKS_PER_CALL, description: 'Semanas que ajustas (1-26). Una semana ya ajustada se sustituye.' })),
  clear: optional(array(dateSchema('Lunes de una semana cuyo ajuste quitas (vuelve a la periodización).'), { min: 1, max: MAX_WEEKS_PER_CALL })),
});

type Args = Infer<typeof input>;

interface Checked {
  drafts: WeekPlanDraft[];
  clear: ISODate[];
}

function checkClear(dates: readonly string[], today: ISODate, drafts: readonly WeekPlanDraft[]): { clear: ISODate[]; issues: string[] } {
  const issues: string[] = [];
  const clear: ISODate[] = [];
  for (const date of dates) {
    const monday = checkWeekStart(date, { today, maxWeeks: CLAUDE_WEEK_PLAN_WEEKS });
    if (!monday.ok) issues.push(`clear: ${monday.error}`);
    else if (drafts.some((d) => d.weekStart === monday.value)) issues.push(`la semana del ${monday.value} está en weeks y en clear`);
    else if (!clear.includes(monday.value)) clear.push(monday.value);
  }
  return { clear, issues };
}

interface Situation {
  profile: Profile;
  today: ISODate;
  races: Race[];
}

function validate(args: Args, { profile, today, races }: Situation): Checked {
  if (!args.weeks?.length && !args.clear?.length) throw new ToolInputError('Indica al menos una semana en weeks o en clear.');
  const check = { today, maxWeeks: CLAUDE_WEEK_PLAN_WEEKS, races, level: profile.level, source: 'claude' as const };
  const weeks = checkWeekPlans(args.weeks ?? [], check);
  const cleared = checkClear(args.clear ?? [], today, weeks.valid);
  const issues = [...weeks.issues, ...cleared.issues];
  if (issues.length > 0) {
    throw new ToolInputError(`No se ha guardado nada. Corrige y vuelve a llamar: ${issues.join(' | ')}. Las semanas con fixed=true en season (afinamiento, carrera, recuperación) no admiten ajuste.`);
  }
  return { drafts: weeks.valid, clear: cleared.clear };
}

/** The season from this week to the last week touched (at least 8 weeks). */
async function resultingSeason(store: PlanningStore, userId: UUID, situation: Situation, touched: readonly ISODate[]): Promise<SeasonView> {
  const { profile, today, races } = situation;
  const monday = startOfWeek(today);
  const last = touched.reduce((max, d) => (d > max ? d : max), monday);
  const rows = Math.max(MIN_SEASON_ROWS, diffDays(last, monday) / 7 + 1);
  const weekPlans = await store.listWeekPlans(userId, monday, addDays(monday, 7 * CLAUDE_WEEK_PLAN_WEEKS));
  const weeklyHoursTarget = profile.availability.weeklyHoursTarget;
  const season = seasonOf({ today, races, level: profile.level, weeklyHoursTarget, weekPlans, horizonWeeks: rows });
  return seasonView(season, rows);
}

export const setWeekPlansTool: RegisteredTool = defineTool({
  name: 'set_week_plans',
  title: TITLE,
  description: [
    'Ajusta el plan general del usuario (Plan › General): qué semanas son de carga (load), más volumen (push), descarga (recovery) o semana libre (rest),',
    'opcionalmente con los minutos de la semana y una nota, sin detallar entrenos. Úsala para "planifica las próximas semanas por encima"; la planificación semanal (propose_plan_changes) usa después estos ajustes.',
    `Se aplica directamente (no es una propuesta). Solo lunes de esta semana a ${CLAUDE_WEEK_PLAN_WEEKS} semanas vista y semanas sin fixed en season de get_planning_context (afinamiento, carrera y recuperación tras carrera siguen la periodización).`,
    'clear quita el ajuste de esas semanas. Si algo no es válido no se guarda nada. Devuelve las semanas resultantes (season) como las ve el usuario.',
  ].join(' '),
  input,
  annotations: { title: TITLE, readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    const profile = await ctx.store.getProfile(ctx.userId);
    if (!profile) throw new NotFoundError('No hay perfil para este usuario. Completa el registro en la app.');
    const situation: Situation = { profile, today: todayIn(profile.timezone || DEFAULT_TZ, ctx.now()), races: await ctx.store.listRaces(ctx.userId) };
    const { drafts, clear } = validate(args, situation);
    const saved = await ctx.store.saveWeekPlans(ctx.userId, drafts);
    const cleared = clear.length > 0 ? await ctx.store.deleteWeekPlans(ctx.userId, clear) : 0;
    const season = await resultingSeason(ctx.store, ctx.userId, situation, [...drafts.map((d) => d.weekStart), ...clear]);
    return toolOk({
      saved: saved.length,
      cleared,
      weekPlans: saved.map((p) => ({ weekStart: p.weekStart, kind: p.kind, targetMinutes: p.targetMinutes, note: p.note })),
      season: { ...season },
      message: 'Plan general actualizado: el usuario lo ve ya en Plan › General.',
    });
  },
});
