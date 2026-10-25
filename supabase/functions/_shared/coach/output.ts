/**
 * Structured output of the AI coach: a flat, all-required-but-nullable change
 * shape (structured outputs need every property listed and no numeric bounds),
 * converted to camelCase `PlanChange` and re-validated with the strict schema.
 */
import { planChangeSchema } from '../planning/changes.ts';
import { array, boolean, enumOf, integer, nullable, object, string, toStructuredOutputSchema } from '../schema.ts';
import type { Infer } from '../schema.ts';
import { INTENSITIES, SPORTS } from '../types.ts';
import type { PlanChange, WorkoutDraft } from '../types.ts';

export const MAX_COACH_CHANGES = 30;

const flatChange = object({
  op: enumOf(['add', 'update', 'move', 'delete'] as const),
  workoutId: nullable(string({ description: 'Id del entreno (update/move/delete) o null (add).' })),
  reason: string({ description: 'Motivo en una frase.' }),
  date: nullable(string({ format: 'date', description: 'YYYY-MM-DD (add: fecha; move: nueva fecha; update: nueva fecha o null).' })),
  startTime: nullable(string({ description: 'HH:mm o null.' })),
  sport: nullable(enumOf(SPORTS)),
  title: nullable(string()),
  description: nullable(string()),
  durationMin: nullable(integer()),
  distanceM: nullable(integer()),
  intensity: nullable(enumOf(INTENSITIES)),
  isKey: nullable(boolean()),
});

export const coachOutputSchema = object({
  reply: string({ min: 1, description: 'Respuesta al atleta en español.' }),
  summary: string({ description: 'Resumen de una línea de la propuesta.' }),
  changes: array(flatChange),
});

export type CoachOutput = Infer<typeof coachOutputSchema>;
type FlatChange = Infer<typeof flatChange>;

/** JSON Schema sent as `output_config.format.schema`. */
export const COACH_OUTPUT_JSON_SCHEMA = toStructuredOutputSchema(coachOutputSchema.json) as Record<string, unknown>;

function definedFields(c: FlatChange): Partial<WorkoutDraft> {
  return {
    ...(c.date !== null ? { date: c.date } : {}),
    ...(c.startTime !== null ? { startTime: c.startTime } : {}),
    ...(c.sport !== null ? { sport: c.sport } : {}),
    ...(c.title !== null ? { title: c.title } : {}),
    ...(c.description !== null ? { description: c.description } : {}),
    ...(c.durationMin !== null ? { durationMin: c.durationMin } : {}),
    ...(c.distanceM !== null ? { distanceM: c.distanceM } : {}),
    ...(c.intensity !== null ? { intensity: c.intensity } : {}),
    ...(c.isKey !== null ? { isKey: c.isKey } : {}),
  };
}

function toRawChange(c: FlatChange): Record<string, unknown> {
  switch (c.op) {
    case 'add':
      return { op: 'add', workout: definedFields(c), reason: c.reason };
    case 'update':
      return { op: 'update', workoutId: c.workoutId, patch: definedFields(c), reason: c.reason };
    case 'move':
      return {
        op: 'move',
        workoutId: c.workoutId,
        toDate: c.date,
        ...(c.startTime !== null ? { toStartTime: c.startTime } : {}),
        reason: c.reason,
      };
    case 'delete':
      return { op: 'delete', workoutId: c.workoutId, reason: c.reason };
  }
}

export interface ConvertedChanges {
  changes: PlanChange[];
  rejected: { index: number; error: string }[];
}

/** Flat model output → strictly validated PlanChange[] (invalid ones are reported, not thrown). */
export function toPlanChanges(flat: readonly FlatChange[]): ConvertedChanges {
  const changes: PlanChange[] = [];
  const rejected: ConvertedChanges['rejected'] = [];
  flat.slice(0, MAX_COACH_CHANGES).forEach((c, index) => {
    const parsed = planChangeSchema.parse(toRawChange(c), `changes[${index}]`);
    if (parsed.ok) changes.push(parsed.value);
    else rejected.push({ index, error: parsed.error });
  });
  flat.slice(MAX_COACH_CHANGES).forEach((_, i) => rejected.push({ index: MAX_COACH_CHANGES + i, error: 'demasiados cambios' }));
  return { changes, rejected };
}

/** Parses the model text (JSON) and validates its shape. */
export function parseCoachOutput(text: string): CoachOutput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = coachOutputSchema.parse(value, '');
  return parsed.ok ? parsed.value : null;
}
