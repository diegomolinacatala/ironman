/**
 * Form/input validation schemas (zod 4) with Spanish messages. Limits mirror
 * the database CHECK constraints (supabase/migrations/20261025000100_schema.sql)
 * and, for coaching, steps and week plans, 20261109000100_coach_v4.sql with the
 * server's own wording, so client and database errors match.
 */
import { z } from 'zod';

import { validateCoaching } from './changes';
import { diffDays, isISODate, timeToMinutes, weekdayOf } from './dates';
import {
  BODY_AREAS,
  INTENSITIES,
  LIFE_EVENT_KINDS,
  MEAL_SLOTS,
  RACE_DISTANCES,
  SPORTS,
  TRAINABLE_SPORTS,
  WATCH_BRANDS,
  WEEK_PLAN_KINDS,
  WORKOUT_SOURCES,
} from './types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_EVENT_DAYS = 120;

export const isoDateSchema = z.string({ error: 'Indica una fecha' }).refine((s) => isISODate(s), { error: 'Fecha inválida' });

export const isoTimeSchema = z.string({ error: 'Indica una hora' }).regex(TIME_RE, { error: 'Hora inválida (usa HH:mm)' });

const optionalText = (max: number, label: string) =>
  z
    .string({ error: `${label}: texto no válido` })
    .max(max, { error: `${label}: máximo ${max} caracteres` })
    .nullable()
    .optional();

const optionalInt = (min: number, max: number, label: string) =>
  z
    .number({ error: `${label}: debe ser un número` })
    .int({ error: `${label}: usa un número entero` })
    .min(min, { error: `${label}: mínimo ${min}` })
    .max(max, { error: `${label}: máximo ${max}` })
    .nullable()
    .optional();

const requiredTitle = (label: string, max = 120) =>
  z
    .string({ error: `Pon un ${label}` })
    .trim()
    .min(1, { error: `Pon un ${label}` })
    .max(max, { error: `El ${label} es demasiado largo (máximo ${max})` });

/** Inclusive range within [lo, hi] with min ≤ max (heart rate, pace, power, RPE). */
const targetRange = (lo: number, hi: number, label: string) =>
  z
    .object(
      {
        min: z.number({ error: `${label}: debe ser un número` }).min(lo, { error: `${label}: entre ${lo} y ${hi}` }).max(hi, { error: `${label}: entre ${lo} y ${hi}` }),
        max: z.number({ error: `${label}: debe ser un número` }).min(lo, { error: `${label}: entre ${lo} y ${hi}` }).max(hi, { error: `${label}: entre ${lo} y ${hi}` }),
      },
      { error: `${label}: rango no válido` },
    )
    .refine((r) => r.min <= r.max, { error: `${label}: el mínimo no puede ser mayor que el máximo` });

/** Explicit step targets: pulse 40–230 ppm, pace 20–1200 s (per km or per 100 m), power 0–2000 W, RPE 1–10. */
export const stepTargetSchema = z.object(
  {
    hr: targetRange(40, 230, 'Pulso objetivo').optional(),
    pace: targetRange(20, 1200, 'Ritmo objetivo').optional(),
    power: targetRange(0, 2000, 'Potencia objetivo').optional(),
    rpe: targetRange(1, 10, 'RPE objetivo').optional(),
  },
  { error: 'Objetivos del paso no válidos' },
);

export const workoutStepSchema = z.object({
  kind: z.enum(['warmup', 'work', 'recovery', 'cooldown', 'rest'], { error: 'Tipo de paso no válido' }),
  durationMin: z.number().min(0).max(720).optional(),
  distanceM: z.number().min(0).max(1_000_000).optional(),
  intensity: z.enum(INTENSITIES, { error: 'Intensidad no válida' }).optional(),
  repeat: z.number().int().min(1).max(100).optional(),
  note: z.string().max(300).optional(),
  target: stepTargetSchema.optional(),
  cue: z.string({ error: 'Indicación del paso no válida' }).max(200, { error: 'Indicación del paso: máximo 200 caracteres' }).optional(),
  leg: z.enum(['bike', 'run'], { error: 'Tramo del brick no válido (bici o carrera)' }).optional(),
});

const COACHING_TEXT_MAX = 200;
const COACHING_KEY_MAX = 160;
const COACHING_KEYS_MAX = 4;
const MAX_STEPS = 50;

const coachingText = (max: number, message: string) => z.string({ error: message }).trim().min(1, { error: message }).max(max, { error: message });

/**
 * The coach's prescription of a session, with the database's messages (lengths
 * after trimming): objective and success 1–200, up to 4 keys of 1–160, plan B
 * null or 1–200; the stored size check is the server's (`changes.validateCoaching`).
 */
export const workoutCoachingSchema = z
  .object(
    {
      objective: coachingText(COACHING_TEXT_MAX, 'Objetivo del entreno no válido (1–200 caracteres)'),
      keys: z
        .array(coachingText(COACHING_KEY_MAX, 'Claves del entreno no válidas (1–160 caracteres cada una)'), {
          error: 'Claves del entreno no válidas (1–160 caracteres cada una)',
        })
        .max(COACHING_KEYS_MAX, { error: 'Máximo 4 claves por entreno' })
        .default([]),
      success: coachingText(COACHING_TEXT_MAX, 'Criterio de éxito no válido (1–200 caracteres)'),
      planB: coachingText(COACHING_TEXT_MAX, 'Plan B no válido (1–200 caracteres)').nullable().default(null),
    },
    { error: 'Indicaciones del entreno no válidas' },
  )
  .superRefine((value, ctx) => {
    const error = validateCoaching(value);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });

export const workoutDraftSchema = z.object({
  date: isoDateSchema,
  startTime: isoTimeSchema.nullable().optional(),
  sport: z.enum(SPORTS, { error: 'Elige un deporte' }),
  title: requiredTitle('título'),
  description: optionalText(4000, 'Descripción'),
  durationMin: z
    .number({ error: 'Indica la duración en minutos' })
    .int({ error: 'La duración debe ser un número entero de minutos' })
    .min(0, { error: 'La duración no puede ser negativa' })
    .max(720, { error: 'Máximo 12 horas por entreno' }),
  distanceM: optionalInt(0, 1_000_000, 'Distancia'),
  intensity: z.enum(INTENSITIES, { error: 'Elige una intensidad' }),
  tss: z.number({ error: 'Carga: debe ser un número' }).min(0).max(2000, { error: 'Carga demasiado alta' }).nullable().optional(),
  steps: z.array(workoutStepSchema).max(MAX_STEPS, { error: 'Demasiados pasos (máximo 50)' }).optional(),
  isKey: z.boolean().optional(),
  source: z.enum(WORKOUT_SOURCES).optional(),
  coaching: workoutCoachingSchema.nullable().optional(),
});

export const raceDraftSchema = z.object({
  name: requiredTitle('nombre a la carrera'),
  date: isoDateSchema,
  distance: z.enum(RACE_DISTANCES, { error: 'Elige la distancia' }),
  priority: z.enum(['A', 'B', 'C'], { error: 'Elige la prioridad (A, B o C)' }),
  location: optionalText(200, 'Lugar'),
  goal: optionalText(200, 'Objetivo'),
  notes: optionalText(2000, 'Notas'),
});

export const lifeEventDraftSchema = z
  .object({
    kind: z.enum(LIFE_EVENT_KINDS, { error: 'Elige el tipo de imprevisto' }),
    title: requiredTitle('título'),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional(),
    startTime: isoTimeSchema.nullable().optional(),
    durationMin: optionalInt(0, 1440, 'Duración'),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3)], { error: 'Elige la intensidad (1, 2 o 3)' }),
    bodyArea: z.enum(BODY_AREAS, { error: 'Zona del cuerpo no válida' }).nullable().optional(),
    notes: optionalText(2000, 'Notas'),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && isISODate(v.endDate) && isISODate(v.startDate)) {
      const days = diffDays(v.endDate, v.startDate);
      if (days < 0) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'La fecha de fin no puede ser anterior al inicio' });
      if (days > MAX_EVENT_DAYS) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Máximo 120 días por imprevisto' });
    }
    if (v.kind === 'injury' && !v.bodyArea) ctx.addIssue({ code: 'custom', path: ['bodyArea'], message: 'Indica la zona del cuerpo' });
  });

const score5 = (label: string) =>
  z
    .number({ error: `${label}: elige un valor` })
    .int({ error: `${label}: elige un valor de 1 a 5` })
    .min(1, { error: `${label}: elige un valor de 1 a 5` })
    .max(5, { error: `${label}: elige un valor de 1 a 5` });

export const checkinDraftSchema = z.object({
  date: isoDateSchema,
  sleepQuality: score5('Calidad del sueño'),
  sleepHours: z.number({ error: 'Horas de sueño: debe ser un número' }).min(0).max(16, { error: 'Horas de sueño: máximo 16' }).nullable(),
  fatigue: score5('Fatiga'),
  soreness: score5('Agujetas'),
  stress: score5('Estrés'),
  motivation: score5('Motivación'),
  notes: z.string().max(1000, { error: 'Notas: máximo 1000 caracteres' }).nullable(),
});

/** What the athlete logs when completing a session (CompleteSheet, imports): sensaciones 1–5, RPE 1–10. */
export const completedDataSchema = z.object({
  durationMin: z.number({ error: 'Duración: debe ser un número' }).min(0, { error: 'La duración no puede ser negativa' }).max(1440, { error: 'Duración: máximo 24 horas' }).optional(),
  distanceM: z.number({ error: 'Distancia: debe ser un número' }).min(0).max(1_000_000, { error: 'Distancia demasiado larga' }).optional(),
  avgHr: z.number({ error: 'FC media: debe ser un número' }).min(30, { error: 'FC media no válida' }).max(250, { error: 'FC media no válida' }).optional(),
  rpe: z.number({ error: 'RPE: elige un valor de 1 a 10' }).min(1, { error: 'RPE: elige un valor de 1 a 10' }).max(10, { error: 'RPE: elige un valor de 1 a 10' }).optional(),
  feel: score5('Sensaciones').optional(),
  tss: z.number({ error: 'Carga: debe ser un número' }).min(0).max(2000, { error: 'Carga demasiado alta' }).optional(),
  notes: z.string().max(2000, { error: 'Notas: máximo 2000 caracteres' }).optional(),
  source: z.enum(['manual', 'healthkit', 'garmin', 'claude'], { error: 'Origen no válido' }).optional(),
  externalId: z.string().max(200).optional(),
  completedAt: z.string().optional(),
});

/**
 * One week of the general plan ("Ajustar semana"): Monday of the week, kind,
 * optional volume (0–3000 min) and note (≤ 300). The from-this-week…+52 range
 * depends on today, so the repository checks it.
 */
export const weekPlanDraftSchema = z.object({
  weekStart: isoDateSchema.refine((d) => !isISODate(d) || weekdayOf(d) === 0, {
    error: 'Cada semana del plan general empieza en lunes: elige el lunes de esa semana.',
  }),
  kind: z.enum(WEEK_PLAN_KINDS, { error: 'Elige qué semana es: carga, más volumen, descarga o semana libre.' }),
  targetMinutes: z
    .number({ error: 'El volumen de la semana debe estar entre 0 y 50 horas.' })
    .min(0, { error: 'El volumen de la semana debe estar entre 0 y 50 horas.' })
    .max(3000, { error: 'El volumen de la semana debe estar entre 0 y 50 horas.' })
    .nullable()
    .optional(),
  note: z.string().trim().max(300, { error: 'La nota de la semana no puede pasar de 300 caracteres.' }).nullable().optional(),
  source: z.enum(['manual', 'ai_coach', 'claude'], { error: 'El origen del ajuste no es válido.' }).optional(),
});

export const nutritionDraftSchema = z.object({
  date: isoDateSchema,
  meal: z.enum(MEAL_SLOTS, { error: 'Elige la comida' }),
  description: requiredTitle('texto describiendo la comida', 1000),
  kcal: optionalInt(0, 10_000, 'Kcal'),
  carbsG: optionalInt(0, 2000, 'Hidratos'),
  proteinG: optionalInt(0, 1000, 'Proteína'),
  fatG: optionalInt(0, 1000, 'Grasa'),
});

export const usernameSchema = z
  .string({ error: 'Elige un nombre de usuario' })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,24}$/, { error: 'Entre 3 y 24 caracteres: minúsculas, números, punto o guion bajo' });

const weekdaySchema = z.number().int().min(0, { error: 'Día no válido' }).max(6, { error: 'Día no válido' });

const windowSchema = z
  .object({ weekday: weekdaySchema, start: isoTimeSchema, end: isoTimeSchema })
  .refine((w) => timeToMinutes(w.end) > timeToMinutes(w.start), { error: 'La franja debe terminar después de empezar' });

export const availabilitySchema = z.object({
  weeklyHoursTarget: z.number({ error: 'Horas semanales: debe ser un número' }).min(0).max(40, { error: 'Máximo 40 h por semana' }),
  restDay: weekdaySchema.nullable(),
  longSessionDays: z.array(weekdaySchema).max(7),
  windows: z.array(windowSchema).max(28, { error: 'Demasiadas franjas' }),
  poolDays: z.array(weekdaySchema).max(7),
});

export const thresholdsSchema = z.object({
  ftpW: z.number().min(50, { error: 'FTP: mínimo 50 W' }).max(700, { error: 'FTP: máximo 700 W' }).optional(),
  runThresholdPaceSecPerKm: z.number().min(150, { error: 'Ritmo umbral demasiado rápido' }).max(600, { error: 'Ritmo umbral demasiado lento' }).optional(),
  swimCssSecPer100m: z.number().min(50).max(240, { error: 'CSS: máximo 4:00 /100 m' }).optional(),
  maxHr: z.number().int().min(100).max(230, { error: 'FC máxima no válida' }).optional(),
  lthr: z.number().int().min(80).max(220, { error: 'FC umbral no válida' }).optional(),
  restingHr: z.number().int().min(25).max(120, { error: 'FC en reposo no válida' }).optional(),
});

export const notificationPrefsSchema = z.object({
  workoutReminders: z.boolean(),
  reminderMinutesBefore: z.number().int().min(0).max(24 * 60),
  morningSummary: z.boolean(),
  morningTime: isoTimeSchema,
  eveningCheckin: z.boolean(),
  eveningTime: isoTimeSchema,
  weeklyPlanReminder: z.boolean(),
  social: z.boolean(),
});

export const profilePatchSchema = z
  .object({
    username: usernameSchema,
    displayName: requiredTitle('nombre', 60),
    avatarUrl: z.string().max(500).nullable(),
    sports: z.array(z.enum(TRAINABLE_SPORTS, { error: 'Deporte no válido' })).min(1, { error: 'Elige al menos un deporte' }),
    level: z.enum(['beginner', 'intermediate', 'advanced'], { error: 'Elige tu nivel' }),
    thresholds: thresholdsSchema,
    availability: availabilitySchema,
    visibility: z.enum(['full', 'summary', 'busy'], { error: 'Visibilidad no válida' }),
    notificationPrefs: notificationPrefsSchema,
    timezone: z.string().min(1).max(64),
    coachNotes: z.string().max(4000, { error: 'Notas para el coach: máximo 4000 caracteres' }).nullable(),
    onboardedAt: z.string().nullable(),
    watchBrand: z.enum(WATCH_BRANDS, { error: 'Elige tu reloj: Garmin o COROS' }).nullable(),
  })
  .partial();

export type WorkoutDraftInput = z.infer<typeof workoutDraftSchema>;
export type RaceDraftInput = z.infer<typeof raceDraftSchema>;
export type LifeEventDraftInput = z.infer<typeof lifeEventDraftSchema>;
export type CheckinDraftInput = z.infer<typeof checkinDraftSchema>;
export type NutritionDraftInput = z.infer<typeof nutritionDraftSchema>;
export type ProfilePatchInput = z.infer<typeof profilePatchSchema>;
export type WorkoutCoachingInput = z.infer<typeof workoutCoachingSchema>;
export type CompletedDataInput = z.infer<typeof completedDataSchema>;
export type WeekPlanDraftInput = z.infer<typeof weekPlanDraftSchema>;

/** Minimal shape of a zod safeParse result. */
export type SafeParseLike = { success: true } | { success: false; error: { issues: readonly { message: string }[] } };

/** Spanish message of the first issue, or null when valid. */
export function firstError(result: SafeParseLike): string | null {
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'Revisa los datos del formulario';
}
