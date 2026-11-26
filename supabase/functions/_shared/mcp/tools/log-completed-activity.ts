import { addDays, DEFAULT_TZ, isIsoDate, todayIn } from '../../dates.ts';
import { dateSchema, timeSchema, uuidSchema } from '../../planning/changes.ts';
import { enrichManualCompletion } from '../../planning/domain/watchCompletion.ts';
import { sportLabel } from '../../planning/labels.ts';
import { intensityFromEffort } from '../../planning/load.ts';
import { findCompletedLookalikes, matchActivity } from '../../planning/match.ts';
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
  avg_hr: optional(integer({ min: 30, max: 230, description: 'FC media en ppm.' })),
  max_hr: optional(integer({ min: 30, max: 240, description: 'FC máxima de la actividad en ppm.' })),
  calories: optional(integer({ min: 1, max: 20000, description: 'Calorías de la actividad (kcal).' })),
  avg_power_w: optional(integer({ min: 1, max: 2500, description: 'Potencia media en vatios (bici con potenciómetro o potencia de carrera).' })),
  rpe: optional(integer({ min: 1, max: 10, description: 'Esfuerzo percibido 1-10.' })),
  feel: optional(integer({ min: 1, max: 5, description: 'Sensaciones 1-5 (1 muy mal … 5 genial), solo si el usuario las cuenta.' })),
  tss: optional(number({ min: 0, max: 1000, description: 'Carga de la actividad (TSS o la carga que da el reloj).' })),
  title: optional(string({ min: 1, max: 120, description: 'Nombre de la actividad (p. ej. el del reloj).' })),
  notes: optional(string({ max: 1000 })),
  garmin_activity_id: optional(
    string({ pattern: /^\d{1,30}$/, hint: 'solo dígitos', description: 'activityId de Garmin: evita duplicados si se registra dos veces.' }),
  ),
  coros_activity_id: optional(
    string({ pattern: /^[A-Za-z0-9_-]{1,40}$/, hint: 'letras, dígitos, _ o -', description: 'Id de la actividad en COROS (conector de COROS): evita duplicados si se registra dos veces.' }),
  ),
  workout_id: optional(uuidSchema('Entreno planificado concreto a marcar como hecho; si se omite se busca automáticamente.')),
});

type Args = Infer<typeof input>;

/** The watch activity id as stored in workouts.external_id ('garmin:<id>' / 'coros:<id>'), and as kept in completed.externalId. */
function externalRefOf(args: Args): { key: string; raw: string } | null {
  if (args.garmin_activity_id) return { key: `garmin:${args.garmin_activity_id}`, raw: args.garmin_activity_id };
  if (args.coros_activity_id) return { key: `coros:${args.coros_activity_id}`, raw: `coros:${args.coros_activity_id}` };
  return null;
}

function completedFrom(args: Args, nowIso: string): CompletedData {
  const ref = externalRefOf(args);
  return {
    source: 'claude',
    durationMin: args.duration_min,
    ...(args.distance_m !== undefined ? { distanceM: args.distance_m } : {}),
    ...(args.avg_hr !== undefined ? { avgHr: args.avg_hr } : {}),
    ...(args.max_hr !== undefined ? { maxHr: args.max_hr } : {}),
    ...(args.calories !== undefined ? { kcal: args.calories } : {}),
    ...(args.avg_power_w !== undefined ? { avgPowerW: args.avg_power_w } : {}),
    ...(args.rpe !== undefined ? { rpe: args.rpe } : {}),
    ...(args.feel !== undefined ? { feel: args.feel } : {}),
    ...(args.tss !== undefined ? { tss: args.tss } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
    ...(ref ? { externalId: ref.raw } : {}),
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
  const ref = externalRefOf(args);
  if (ref) {
    const existing = await ctx.store.findByExternalId(ctx.userId, ref.key, ref.raw);
    if (existing) return toolOk({ status: 'already_logged', workoutId: existing.id, title: existing.title, date: existing.date });
  }
  const dayWorkouts = await ctx.store.listWorkouts(ctx.userId, args.date, args.date);
  const nowIso = ctx.now().toISOString();
  const completed = completedFrom(args, nowIso);
  // An explicit workout_id wins; otherwise the same activity may already be there (e.g. from Apple Health).
  const lookalike = args.workout_id ? null : findCompletedLookalikes(activityOf(args), dayWorkouts, { garminId: args.garmin_activity_id ?? null });
  if (lookalike?.linked) {
    return toolOk({
      status: 'already_logged',
      workoutId: lookalike.linked.id,
      title: lookalike.linked.title,
      date: lookalike.linked.date,
      message: 'Esa actividad ya estaba registrada (por ejemplo, desde Apple Salud o la sincronización del reloj).',
    });
  }
  const manual = lookalike?.manual ?? null;
  if (manual) {
    // False only when another import linked it meanwhile: then the activity is already there.
    const enriched = await ctx.store.enrichCompletedWorkout(ctx.userId, manual.id, enrichManualCompletion(manual.completed, completed));
    return toolOk({
      status: enriched ? 'enriched_manual' : 'already_logged',
      workoutId: manual.id,
      title: manual.title,
      date: manual.date,
      message: enriched
        ? 'El atleta ya la había marcado como hecha a mano: se han añadido los datos de la actividad sin tocar su RPE, sus sensaciones ni sus notas.'
        : 'Esa actividad ya estaba registrada.',
    });
  }
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
    externalId: ref ? ref.key : `claude:${crypto.randomUUID()}`,
  });
  if (!created) return toolOk({ status: 'already_logged', message: 'Esa actividad ya estaba registrada.' });
  return toolOk({ status: 'created_unplanned', workoutId: created.id, title: created.title, date: created.date });
}

export const logCompletedActivityTool: RegisteredTool = defineTool({
  name: 'log_completed_activity',
  title: 'Registrar actividad hecha',
  description: [
    'Registra una actividad ya realizada (por ejemplo, leída del conector de Garmin o de COROS).',
    'Si encaja con un entreno planificado ese día (mismo deporte —brick acepta bici o carrera—, duración entre el 50 % y el 150 %, hora más cercana) lo marca como completado;',
    'si no, crea un entreno completado no planificado. Con garmin_activity_id o coros_activity_id no se duplica aunque se llame dos veces,',
    'y si la misma actividad ya está registrada (p. ej. importada de Apple Salud: mismo día, deporte, duración y hora parecidas) responde already_logged.',
    'Si el atleta ya la había marcado como hecha a mano, le añade los datos de la actividad (duración, distancia, FC, carga, calorías, potencia y el id) sin tocar su RPE, sensaciones ni notas y responde enriched_manual.',
    'Duración en minutos, distancia en metros, FC en ppm, RPE 1-10 y sensaciones 1-5. Pádel, fútbol y similares van como sport "other".',
  ].join(' '),
  input,
  annotations: { title: 'Registrar actividad hecha', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: handle,
});
