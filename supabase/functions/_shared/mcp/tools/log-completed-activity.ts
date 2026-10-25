import { addDays, DEFAULT_TZ, isIsoDate, todayIn } from '../../dates.ts';
import { dateSchema, timeSchema, uuidSchema } from '../../planning/changes.ts';
import { sportLabel } from '../../planning/labels.ts';
import { intensityFromEffort } from '../../planning/load.ts';
import { findCompletedLookalike, matchActivity } from '../../planning/match.ts';
import type { ActivityLike } from '../../planning/match.ts';
import { enumOf, integer, number, object, optional, string } from '../../schema.ts';
import type { Infer } from '../../schema.ts';
import type { CompletedData, Workout } from '../../types.ts';
import { defineTool, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool, ToolContext, ToolResult } from '../tool.ts';

const ACTIVITY_SPORTS = ['swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other'] as const;

const input = object({
  date: dateSchema('Día de la actividad (YYYY-MM-DD, Europe/Madrid).'),
  sport: enumOf(ACTIVITY_SPORTS, 'swim, bike, run, brick (triatlón/transición), strength, mobility, other (pádel, fútbol, tenis…).'),
  duration_min: integer({ min: 1, max: 720, description: 'Duración en minutos.' }),
  start_time: optional(timeSchema('Hora de inicio HH:mm (ayuda a emparejar con el entreno planificado).')),
  distance_m: optional(integer({ min: 0, max: 1000000, description: 'Distancia en metros.' })),
  avg_hr: optional(integer({ min: 30, max: 230, description: 'FC media en lpm.' })),
  rpe: optional(integer({ min: 1, max: 10, description: 'Esfuerzo percibido 1-10.' })),
  tss: optional(number({ min: 0, max: 1000, description: 'Carga de la actividad (TSS o Training Load de Garmin).' })),
  title: optional(string({ min: 1, max: 120, description: 'Nombre de la actividad (p. ej. el de Garmin).' })),
  notes: optional(string({ max: 1000 })),
  garmin_activity_id: optional(
    string({ pattern: /^\d{1,30}$/, hint: 'solo dígitos', description: 'activityId de Garmin: evita duplicados si se registra dos veces.' }),
  ),
  workout_id: optional(uuidSchema('Entreno planificado concreto a marcar como hecho; si se omite se busca automáticamente.')),
});

type Args = Infer<typeof input>;

function completedFrom(args: Args, nowIso: string): CompletedData {
  return {
    source: 'claude',
    durationMin: args.duration_min,
    ...(args.distance_m !== undefined ? { distanceM: args.distance_m } : {}),
    ...(args.avg_hr !== undefined ? { avgHr: args.avg_hr } : {}),
    ...(args.rpe !== undefined ? { rpe: args.rpe } : {}),
    ...(args.tss !== undefined ? { tss: args.tss } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
    ...(args.garmin_activity_id ? { externalId: args.garmin_activity_id } : {}),
    completedAt: nowIso,
  };
}

function activityOf(args: Args): ActivityLike {
  return { date: args.date, sport: args.sport, durationMin: args.duration_min, startTime: args.start_time ?? null };
}

function pickTarget(args: Args, dayWorkouts: readonly Workout[]): Workout | null {
  if (args.workout_id) {
    const target = dayWorkouts.find((w) => w.id === args.workout_id);
    const planned = dayWorkouts.filter((w) => w.status === 'planned').map((w) => `${w.id} (${w.title})`);
    if (!target) throw new ToolInputError(`El entreno ${args.workout_id} no existe el ${args.date}. Planificados ese día: ${planned.join(', ') || 'ninguno'}.`);
    if (target.status !== 'planned') throw new ToolInputError(`El entreno «${target.title}» ya está ${target.status === 'completed' ? 'completado' : 'saltado'}.`);
    return target;
  }
  return matchActivity(activityOf(args), dayWorkouts);
}

async function handle(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const profile = await ctx.store.getProfile(ctx.userId);
  const today = todayIn(profile?.timezone ?? DEFAULT_TZ, ctx.now());
  if (!isIsoDate(args.date) || args.date > today || args.date < addDays(today, -60)) {
    throw new ToolInputError(`La fecha ${args.date} no es válida: debe ser real, no futura y de los últimos 60 días (hoy es ${today}).`);
  }
  if (args.garmin_activity_id) {
    const existing = await ctx.store.findByExternalId(ctx.userId, `garmin:${args.garmin_activity_id}`, args.garmin_activity_id);
    if (existing) return toolOk({ status: 'already_logged', workoutId: existing.id, title: existing.title, date: existing.date });
  }
  const dayWorkouts = await ctx.store.listWorkouts(ctx.userId, args.date, args.date);
  // An explicit workout_id wins; otherwise the same activity may already be there (e.g. from Apple Health).
  const lookalike = args.workout_id ? null : findCompletedLookalike(activityOf(args), dayWorkouts, { garminId: args.garmin_activity_id ?? null });
  if (lookalike) {
    return toolOk({
      status: 'already_logged',
      workoutId: lookalike.id,
      title: lookalike.title,
      date: lookalike.date,
      message: 'Esa actividad ya estaba registrada (por ejemplo, desde Apple Salud o la sincronización de Garmin).',
    });
  }
  const nowIso = ctx.now().toISOString();
  const completed = completedFrom(args, nowIso);
  const target = pickTarget(args, dayWorkouts);
  if (target && (await ctx.store.completeWorkout(ctx.userId, target.id, completed))) {
    return toolOk({ status: 'completed_planned', workoutId: target.id, title: target.title, date: target.date, plannedDurationMin: target.durationMin });
  }
  const created = await ctx.store.insertCompletedWorkout(ctx.userId, {
    date: args.date,
    startTime: args.start_time ?? null,
    sport: args.sport,
    title: args.title ?? sportLabel(args.sport),
    durationMin: args.duration_min,
    distanceM: args.distance_m ?? null,
    intensity: intensityFromEffort({ rpe: args.rpe, tss: args.tss, durationMin: args.duration_min }),
    completed,
    source: 'claude',
    // Always explicit so the app can tell unplanned (logged-by-Claude) rows from planned ones.
    externalId: args.garmin_activity_id ? `garmin:${args.garmin_activity_id}` : `claude:${crypto.randomUUID()}`,
  });
  if (!created) return toolOk({ status: 'already_logged', message: 'Esa actividad ya estaba registrada.' });
  return toolOk({ status: 'created_unplanned', workoutId: created.id, title: created.title, date: created.date });
}

export const logCompletedActivityTool: RegisteredTool = defineTool({
  name: 'log_completed_activity',
  title: 'Registrar actividad hecha',
  description: [
    'Registra una actividad ya realizada (por ejemplo, leída del conector de Garmin).',
    'Si encaja con un entreno planificado ese día (mismo deporte —brick acepta bici o carrera—, duración entre el 50 % y el 150 %, hora más cercana) lo marca como completado;',
    'si no, crea un entreno completado no planificado. Con garmin_activity_id no se duplica aunque se llame dos veces,',
    'y si la misma actividad ya está registrada (p. ej. importada de Apple Salud: mismo día, deporte, duración y hora parecidas) responde already_logged.',
    'Duración en minutos, distancia en metros, FC en lpm, RPE 1-10. Pádel, fútbol y similares van como sport "other".',
  ].join(' '),
  input,
  annotations: { title: 'Registrar actividad hecha', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: handle,
});
