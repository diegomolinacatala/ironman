/**
 * PlanChange schemas (camelCase, identical to src/domain/types.ts) and the
 * semantic checks every proposal goes through before it is stored: dates
 * inside the 14-day window starting at `weekStart`, not in the past, target
 * workouts owned by the user and still planned. v4: steps carry optional
 * explicit targets (ppm, pace, W, RPE ranges), a cue and the brick leg;
 * drafts and patches carry the coach's prescription (`coaching`).
 */
import { addDays, isIsoDate } from '../dates.ts';
import {
  array,
  boolean,
  discriminated,
  enumOf,
  integer,
  literal,
  nullable,
  number,
  object,
  optional,
  string,
} from '../schema.ts';
import type { Schema } from '../schema.ts';
import { INTENSITIES, SPORTS, STEP_KINDS } from '../types.ts';
import type { ISODate, NumberRange, PlanChange, ProposalSource, UUID, Workout, WorkoutDraft } from '../types.ts';

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PLAN_WINDOW_DAYS = 14;
export const MAX_CHANGES = 40;

export const dateSchema = (description?: string): Schema<string> =>
  string({ pattern: DATE_PATTERN, hint: 'YYYY-MM-DD', format: 'date', description });
export const timeSchema = (description?: string): Schema<string> =>
  string({ pattern: TIME_PATTERN, hint: 'HH:mm en 24 h', description });
export const uuidSchema = (description?: string): Schema<string> =>
  string({ pattern: UUID_PATTERN, hint: 'el id (UUID) que devuelve get_planning_context', description });

/** Text limits of the prescription (same as the DB checks of `workouts.coaching` and the app contract). */
export const COACHING_LIMITS = { objective: 200, keys: 4, key: 160, success: 200, planB: 200, cue: 200 } as const;

/** Sane bounds of explicit step targets (the same ones domain/zones.ts accepts). */
export const STEP_TARGET_BOUNDS = {
  hr: { min: 40, max: 230 },
  pace: { min: 20, max: 1200 },
  power: { min: 0, max: 2000 },
  rpe: { min: 1, max: 10 },
} as const;

/** Inclusive {min, max} range inside `bounds`, with min ≤ max. */
function rangeSchema(bounds: { min: number; max: number }, description: string): Schema<NumberRange> {
  const shape = object({ min: number(bounds), max: number(bounds) }, description);
  return {
    json: shape.json,
    parse(input, path = '') {
      const r = shape.parse(input, path);
      if (!r.ok) return r;
      if (r.value.min > r.value.max) return { ok: false, error: `${path || 'valor'}: min no puede ser mayor que max` };
      return r;
    },
  };
}

const stepTargetSchema = object(
  {
    hr: optional(rangeSchema(STEP_TARGET_BOUNDS.hr, 'FC en ppm, p. ej. {"min":145,"max":151}.')),
    pace: optional(rangeSchema(STEP_TARGET_BOUNDS.pace, 'Ritmo en segundos: s/km en carrera, s/100 m en natación; min es el extremo rápido ({"min":308,"max":348} = 5:08–5:48 /km).')),
    power: optional(rangeSchema(STEP_TARGET_BOUNDS.power, 'Potencia en vatios.')),
    rpe: optional(rangeSchema(STEP_TARGET_BOUNDS.rpe, 'Esfuerzo percibido 1-10.')),
  },
  'Objetivos explícitos del paso. Si faltan, la app los calcula con la intensidad y los umbrales del atleta (athlete.zones).',
);

const stepSchema = object({
  kind: enumOf(STEP_KINDS, 'warmup=calentamiento, work=bloque principal/intervalo, recovery=recuperación entre series, cooldown=vuelta a la calma, rest=pausa.'),
  durationMin: optional(number({ min: 0, max: 720, description: 'Minutos del paso (0.5 = 30").' })),
  distanceM: optional(integer({ min: 0, max: 100000, description: 'Metros del paso (natación por ejemplo).' })),
  intensity: optional(enumOf(INTENSITIES)),
  repeat: optional(integer({ min: 1, max: 50, description: 'Repeticiones. Una serie son pasos seguidos con el mismo repeat: trabajo + recuperación.' })),
  note: optional(string({ max: 200 })),
  target: optional(stepTargetSchema),
  cue: optional(string({ max: COACHING_LIMITS.cue, description: 'Cómo debe sentirse o en qué fijarse (respiración, técnica, cadencia), en español.' })),
  leg: optional(enumOf(['bike', 'run'] as const, 'Solo en brick: tramo de bici o de carrera al que pertenece el paso.')),
});

/** The coach's prescription of a session (Objetivo, Claves, Lo has hecho bien si…, Si no es tu día). */
export const coachingSchema = object(
  {
    objective: string({ min: 1, max: COACHING_LIMITS.objective, description: 'Para qué sirve la sesión, en una frase.' }),
    keys: array(string({ min: 1, max: COACHING_LIMITS.key }), {
      max: COACHING_LIMITS.keys,
      description: 'Hasta 4 claves concretas: objetivos con cifras de athlete.zones, sensaciones, técnica o nutrición.',
    }),
    success: string({ min: 1, max: COACHING_LIMITS.success, description: 'Lo has hecho bien si… (criterio medible).' }),
    planB: nullable(string({ min: 1, max: COACHING_LIMITS.planB, description: 'Si no es tu día: la versión más suave, o null.' })),
  },
  'Prescripción del entrenador para la sesión.',
);

const draftFields = {
  date: dateSchema('Fecha del entreno (YYYY-MM-DD, hora local Europe/Madrid).'),
  startTime: optional(nullable(timeSchema('Hora de inicio HH:mm (24 h, Europe/Madrid) o null si no tiene hora.'))),
  sport: enumOf(SPORTS, 'swim, bike, run, brick (bici+carrera), strength, mobility, other, rest.'),
  title: string({ min: 1, max: 120, description: 'Título corto en español, p. ej. "Rodaje Z2".' }),
  description: optional(nullable(string({ max: 4000, description: 'Detalle de la sesión (series, ritmos…).' }))),
  durationMin: integer({ min: 0, max: 720, description: 'Duración total en minutos.' }),
  distanceM: optional(nullable(integer({ min: 0, max: 1000000, description: 'Distancia en metros.' }))),
  intensity: enumOf(INTENSITIES, 'recovery=Z1, endurance=Z2, tempo=Z3, threshold=Z4, vo2=Z5, race=ritmo de carrera.'),
  tss: optional(nullable(number({ min: 0, max: 2000, description: 'Carga planificada (≈TSS). Omítelo si no lo sabes.' }))),
  steps: optional(array(stepSchema, { max: 30, description: 'Estructura por pasos (calentamiento, series, recuperaciones, vuelta a la calma).' })),
  isKey: optional(boolean('Sesión clave de la semana (protegida al replanificar).')),
  coaching: optional(nullable(coachingSchema)),
};

export const workoutDraftSchema = object(draftFields, 'Entreno nuevo.');

const patchSchema = object(
  {
    date: optional(draftFields.date),
    startTime: draftFields.startTime,
    sport: optional(draftFields.sport),
    title: optional(draftFields.title),
    description: draftFields.description,
    durationMin: optional(draftFields.durationMin),
    distanceM: draftFields.distanceM,
    intensity: optional(draftFields.intensity),
    tss: draftFields.tss,
    steps: draftFields.steps,
    isKey: draftFields.isKey,
    coaching: draftFields.coaching,
  },
  'Solo los campos que cambian.',
);

const reasonSchema = string({ min: 1, max: 300, description: 'Motivo en una frase, en español.' });

export const planChangeSchema: Schema<PlanChange> = discriminated<PlanChange>(
  'op',
  {
    add: object({ op: literal('add'), workout: workoutDraftSchema, reason: reasonSchema }, 'Añadir un entreno.'),
    update: object(
      { op: literal('update'), workoutId: uuidSchema(), patch: patchSchema, reason: reasonSchema },
      'Modificar campos de un entreno planificado.',
    ),
    move: object(
      {
        op: literal('move'),
        workoutId: uuidSchema(),
        toDate: dateSchema('Nueva fecha YYYY-MM-DD.'),
        toStartTime: optional(nullable(timeSchema('Nueva hora HH:mm; omítelo para conservar la hora, null para quitarla.'))),
        reason: reasonSchema,
      },
      'Mover un entreno planificado a otro día/hora.',
    ),
    delete: object({ op: literal('delete'), workoutId: uuidSchema(), reason: reasonSchema }, 'Quitar un entreno planificado.'),
  },
  'Cambio del plan: op = add | update | move | delete.',
);

export const planChangesSchema = array(planChangeSchema, { min: 1, max: MAX_CHANGES });

export interface ChangeCheckContext {
  weekStart: ISODate;
  today: ISODate;
  /** The user's workouts in [weekStart, weekStart + 13]. */
  workouts: readonly Workout[];
}

export interface ChangeIssue {
  index: number;
  error: string;
}

export interface ChangeCheckResult {
  valid: PlanChange[];
  issues: ChangeIssue[];
}

function checkDate(date: string, ctx: ChangeCheckContext): string | null {
  if (!isIsoDate(date)) return `la fecha ${date} no existe`;
  const end = addDays(ctx.weekStart, PLAN_WINDOW_DAYS - 1);
  if (date < ctx.weekStart || date > end) return `la fecha ${date} está fuera de la ventana ${ctx.weekStart}…${end}`;
  if (date < ctx.today) return `la fecha ${date} ya ha pasado (hoy es ${ctx.today})`;
  return null;
}

function checkTarget(id: UUID, ctx: ChangeCheckContext, deleted: ReadonlySet<UUID>): string | null {
  if (deleted.has(id)) return `el entreno ${id} ya se elimina en un cambio anterior`;
  const target = ctx.workouts.find((w) => w.id === id);
  if (!target) return `el entreno ${id} no existe en las dos semanas desde ${ctx.weekStart}`;
  if (target.status !== 'planned') return `el entreno ${id} («${target.title}») ya está ${target.status === 'completed' ? 'completado' : 'saltado'}`;
  return null;
}

function checkOne(change: PlanChange, ctx: ChangeCheckContext, deleted: ReadonlySet<UUID>): string | null {
  switch (change.op) {
    case 'add':
      return checkDate(change.workout.date, ctx);
    case 'delete':
      return checkTarget(change.workoutId, ctx, deleted);
    case 'move':
      return checkTarget(change.workoutId, ctx, deleted) ?? checkDate(change.toDate, ctx);
    case 'update': {
      if (Object.keys(change.patch).length === 0) return 'patch vacío: indica al menos un campo';
      const target = checkTarget(change.workoutId, ctx, deleted);
      if (target) return target;
      return change.patch.date ? checkDate(change.patch.date, ctx) : null;
    }
  }
}

/** Splits changes into valid ones and issues (index + Spanish reason). Pure. */
export function checkChanges(changes: readonly PlanChange[], ctx: ChangeCheckContext): ChangeCheckResult {
  const deleted = new Set<UUID>();
  const valid: PlanChange[] = [];
  const issues: ChangeIssue[] = [];
  changes.forEach((change, index) => {
    const error = checkOne(change, ctx, deleted);
    if (error) {
      issues.push({ index, error });
      return;
    }
    if (change.op === 'delete') deleted.add(change.workoutId);
    valid.push(change);
  });
  return { valid, issues };
}

/** Stamps the source on added workouts and trims titles (immutable). */
export function withSource(changes: readonly PlanChange[], source: ProposalSource): PlanChange[] {
  return changes.map((change) => {
    if (change.op !== 'add') return change;
    const workout: WorkoutDraft = { ...change.workout, title: change.workout.title.trim(), source };
    return { ...change, workout };
  });
}

export function proposalKindFor(changes: readonly PlanChange[]): 'generate_week' | 'replan' {
  return changes.length > 0 && changes.every((c) => c.op === 'add') ? 'generate_week' : 'replan';
}
