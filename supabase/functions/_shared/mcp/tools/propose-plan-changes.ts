import { addDays, DEFAULT_TZ, isIsoDate, startOfWeek, todayIn, zonedToUtc } from '../../dates.ts';
import { busyView } from '../../planning/context.ts';
import {
  checkChanges,
  dateSchema,
  MAX_CHANGES,
  PLAN_WINDOW_DAYS,
  planChangesSchema,
  proposalKindFor,
  withSource,
} from '../../planning/changes.ts';
import { boolean, object, optional, string } from '../../schema.ts';
import type { PlanChange, Workout } from '../../types.ts';
import { defineTool, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

const input = object({
  week_start: dateSchema('Lunes de la semana que cambia (YYYY-MM-DD). Los cambios pueden afectar a esta semana y a la siguiente (14 días).'),
  summary: string({ min: 1, max: 1000, description: 'Resumen en español para el usuario: qué cambia y por qué (2-4 frases).' }),
  changes: planChangesSchema,
  apply_now: optional(
    boolean('false (por defecto): se guarda como propuesta y el usuario la acepta en la app. true: se aplica ya; úsalo solo si el usuario lo pide explícitamente.'),
  ),
});

/** One line naming a change, so Claude knows which one failed. */
function describeForClaude(change: PlanChange): string {
  if (change.op === 'add') return `add ${change.workout.date} ${change.workout.title}`;
  if (change.op === 'move') return `move ${change.workoutId} → ${change.toDate}${change.toStartTime ? ` ${change.toStartTime}` : ''}`;
  return `${change.op} ${change.workoutId}`;
}

function plannedList(workouts: readonly Workout[]): string {
  const planned = workouts.filter((w) => w.status === 'planned');
  if (planned.length === 0) return 'no hay entrenos planificados en esas dos semanas';
  return planned
    .slice(0, 30)
    .map((w) => `${w.id} = ${w.date} ${w.title}`)
    .join('; ');
}

export const proposePlanChangesTool: RegisteredTool = defineTool({
  name: 'propose_plan_changes',
  title: 'Proponer cambios en el plan',
  description: [
    'Guarda una propuesta de cambios del plan de entrenamiento para que el usuario la revise y acepte en la app (recibe una notificación).',
    'Cada cambio (camelCase) es uno de:',
    '{"op":"add","workout":{date,startTime?,sport,title,description?,durationMin,distanceM?,intensity,tss?,steps?,isKey?,coaching?},"reason"} ·',
    '{"op":"update","workoutId","patch":{…solo campos que cambian},"reason"} ·',
    '{"op":"move","workoutId","toDate","toStartTime?","reason"} ·',
    '{"op":"delete","workoutId","reason"}.',
    'workoutId es el id de get_planning_context; solo se pueden tocar entrenos planificados (no completados) dentro de los 14 días desde week_start y nunca en fechas pasadas. Una hora (startTime / toStartTime) que choque con las franjas ocupadas (busy de get_planning_context) se rechaza: elige un hueco libre o deja la hora en null.',
    'Duraciones en minutos, fechas YYYY-MM-DD, horas HH:mm (Europe/Madrid). Cada cambio lleva un reason breve en español.',
    'Cada sesión nueva o cuya estructura cambia es una prescripción completa:',
    'steps = [{kind warmup|work|recovery|cooldown|rest, durationMin (0.5 = 30") o distanceM, intensity, repeat (una serie son pasos seguidos con el mismo repeat: trabajo + recuperación), target? {hr|pace|power|rpe: {min,max}} (ppm; s/km o s/100 m con min = extremo rápido; vatios; RPE 1-10), cue? (≤ 200: sensaciones o técnica), leg? (bike|run, tramo de un brick), note?}]',
    'y coaching = {objective (≤ 200, para qué sirve), keys (≤ 4 de ≤ 160: cifras, sensaciones, técnica), success (≤ 200, lo has hecho bien si…), planB (≤ 200 o null, si no es tu día)}; en update, coaching null la quita.',
    'Copia las cifras de athlete.zones de get_planning_context (o pon target explícito); no las inventes: si faltan umbrales, usa RPE y sensaciones.',
    `Máximo ${MAX_CHANGES} cambios por propuesta. Si algún cambio no es válido no se guarda nada y la respuesta explica qué corregir.`,
  ].join(' '),
  input,
  annotations: {
    title: 'Proponer cambios en el plan',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (args, ctx) => {
    if (!isIsoDate(args.week_start)) throw new ToolInputError(`week_start ${args.week_start} no es una fecha real.`);
    const weekStart = startOfWeek(args.week_start);
    const profile = await ctx.store.getProfile(ctx.userId);
    const today = todayIn(profile?.timezone ?? DEFAULT_TZ, ctx.now());
    const tz = profile?.timezone ?? DEFAULT_TZ;
    const windowEnd = addDays(weekStart, PLAN_WINDOW_DAYS - 1);
    const [workouts, blocks] = await Promise.all([
      ctx.store.listWorkouts(ctx.userId, weekStart, windowEnd),
      ctx.store.listBusyBlocks(ctx.userId, zonedToUtc(weekStart, '00:00', tz), zonedToUtc(addDays(windowEnd, 1), '00:00', tz)),
    ]);
    const busy = busyView(blocks, tz, weekStart, windowEnd);
    const { valid, issues } = checkChanges(args.changes, { weekStart, today, workouts, busy });
    if (issues.length > 0) {
      const problems = issues.map((i) => `cambio ${i.index}: ${i.error}`).join(' | ');
      throw new ToolInputError(
        `No se ha guardado nada. Corrige estos cambios y vuelve a llamar: ${problems}. Entrenos planificados válidos: ${plannedList(workouts)}.`,
      );
    }
    const changes = withSource(valid, 'claude');
    // apply_now: stored as applied so the user is not asked to review what is already done (no notification).
    const proposalId = await ctx.store.insertProposal(ctx.userId, {
      kind: proposalKindFor(changes),
      source: 'claude',
      weekStart,
      summary: args.summary,
      changes,
      model: 'claude (conector MCP)',
      status: args.apply_now ? 'applied' : 'pending',
    });
    const base = { proposalId, weekStart, changes: changes.length, appLink: `roadtoironman://proposal/${proposalId}` };
    if (!args.apply_now) {
      return toolOk({ ...base, status: 'pending', message: 'Propuesta guardada. El usuario la revisará y aceptará en la app.' });
    }
    let result: Awaited<ReturnType<typeof ctx.store.applyPlanChanges>>;
    try {
      result = await ctx.store.applyPlanChanges(ctx.userId, changes, proposalId);
    } catch (error) {
      // Stored as applied but nothing went through: never leave a false "applied" behind.
      await ctx.store.setProposalStatus(ctx.userId, proposalId, 'discarded').catch(() => undefined);
      throw error;
    }
    const status = result.failed.length === 0 ? 'applied' : result.applied > 0 ? 'partially_applied' : 'failed';
    // Partly applied: the user can retry the rest from the app. Nothing applied: the proposal is dropped.
    if (status !== 'applied') await ctx.store.setProposalStatus(ctx.userId, proposalId, status === 'failed' ? 'discarded' : 'partially_applied');
    const failed = result.failed.map((f) => ({ ...f, change: changes[f.index] ? describeForClaude(changes[f.index] as PlanChange) : null }));
    return toolOk({
      ...base,
      status,
      applied: result.applied,
      failed,
      message:
        status === 'applied'
          ? 'Cambios aplicados al plan.'
          : status === 'partially_applied'
            ? 'Algunos cambios no se pudieron aplicar (ver failed). El usuario puede reintentarlos desde la propuesta en la app.'
            : 'No se pudo aplicar ningún cambio (ver failed): corrígelos y vuelve a llamar.',
    });
  },
});
