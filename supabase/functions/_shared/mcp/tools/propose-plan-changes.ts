import { addDays, DEFAULT_TZ, isIsoDate, startOfWeek, todayIn } from '../../dates.ts';
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
import type { Workout } from '../../types.ts';
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
    '{"op":"add","workout":{date,startTime?,sport,title,description?,durationMin,distanceM?,intensity,tss?,steps?,isKey?},"reason"} ·',
    '{"op":"update","workoutId","patch":{…solo campos que cambian},"reason"} ·',
    '{"op":"move","workoutId","toDate","toStartTime?","reason"} ·',
    '{"op":"delete","workoutId","reason"}.',
    'workoutId es el id de get_planning_context; solo se pueden tocar entrenos planificados (no completados) dentro de los 14 días desde week_start y nunca en fechas pasadas.',
    'Duraciones en minutos, fechas YYYY-MM-DD, horas HH:mm (Europe/Madrid). Cada cambio lleva un reason breve en español.',
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
    const workouts = await ctx.store.listWorkouts(ctx.userId, weekStart, addDays(weekStart, PLAN_WINDOW_DAYS - 1));
    const { valid, issues } = checkChanges(args.changes, { weekStart, today, workouts });
    if (issues.length > 0) {
      const problems = issues.map((i) => `cambio ${i.index}: ${i.error}`).join(' | ');
      throw new ToolInputError(
        `No se ha guardado nada. Corrige estos cambios y vuelve a llamar: ${problems}. Entrenos planificados válidos: ${plannedList(workouts)}.`,
      );
    }
    const changes = withSource(valid, 'claude');
    const proposalId = await ctx.store.insertProposal(ctx.userId, {
      kind: proposalKindFor(changes),
      source: 'claude',
      weekStart,
      summary: args.summary,
      changes,
      model: 'claude (conector MCP)',
    });
    const base = { proposalId, weekStart, changes: changes.length, appLink: `rebufo://proposal/${proposalId}` };
    if (!args.apply_now) {
      return toolOk({ ...base, status: 'pending', message: 'Propuesta guardada. El usuario la revisará y aceptará en la app.' });
    }
    const result = await ctx.store.applyPlanChanges(ctx.userId, changes, proposalId);
    return toolOk({
      ...base,
      status: result.failed.length === 0 ? 'applied' : result.applied > 0 ? 'partially_applied' : 'failed',
      applied: result.applied,
      failed: result.failed,
      message: result.failed.length === 0 ? 'Cambios aplicados al plan.' : 'Algunos cambios no se pudieron aplicar (ver failed).',
    });
  },
});
