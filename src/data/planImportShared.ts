/**
 * Plan import helpers shared by the Supabase and demo repositories: the
 * draft check before saving (same rules as `apply_plan_import`) and the
 * `plan-import` function response → `ImportedPlan`.
 */
import { addDays } from '@/domain/dates';
import { buildPlan, IMPORT_CONFIDENCES, IMPORT_LIMITS, PLAN_IMPORT_SOURCES, PLAN_TEXT_MAX } from '@/domain/planImport';
import type { ImportConfidence, ImportedPlan, PlanImportDraft, PlanImportSource, PlanParseInput } from '@/domain/planImport';
import type { ISODate } from '@/domain/types';

import { RepositoryError } from './repository';
import { assertWorkoutDraft } from './demo/validation';

export const PLAN_IMPORT_MESSAGES = {
  empty: 'El plan no tiene sesiones desde hoy. Revisa la fecha de inicio.',
  tooMany: `Demasiadas sesiones (máximo ${IMPORT_LIMITS.sessions}).`,
  past: 'Hay sesiones con fecha pasada. Mueve la semana 1 a partir de hoy.',
  far: 'Hay sesiones a más de un año vista.',
  title: 'Ponle un nombre al plan (máximo 120 caracteres).',
  text: `Pega el plan (máximo ${PLAN_TEXT_MAX.toLocaleString('es-ES')} caracteres).`,
  file: 'No he podido leer el archivo.',
} as const;

/** Throws RepositoryError('validation') when the draft would be rejected by the server. */
export function assertPlanImportDraft(draft: PlanImportDraft, today: ISODate): PlanImportDraft {
  const title = draft.title.trim();
  if (!title || title.length > IMPORT_LIMITS.title) throw new RepositoryError('validation', PLAN_IMPORT_MESSAGES.title);
  if (!PLAN_IMPORT_SOURCES.includes(draft.source)) throw new RepositoryError('validation', 'Origen del plan no válido.');
  if (draft.workouts.length === 0) throw new RepositoryError('validation', PLAN_IMPORT_MESSAGES.empty);
  if (draft.workouts.length > IMPORT_LIMITS.sessions) throw new RepositoryError('validation', PLAN_IMPORT_MESSAGES.tooMany);
  const last = addDays(today, 400);
  for (const w of draft.workouts) {
    assertWorkoutDraft(w, false);
    if (w.date < today) throw new RepositoryError('validation', PLAN_IMPORT_MESSAGES.past);
    if (w.date > last) throw new RepositoryError('validation', PLAN_IMPORT_MESSAGES.far);
  }
  return { ...draft, title, workouts: draft.workouts.map((w) => ({ ...w, source: 'imported' })) };
}

export function assertParseInput(input: PlanParseInput): PlanParseInput {
  if (input.kind === 'text') {
    const text = input.text.trim();
    if (!text || text.length > PLAN_TEXT_MAX) throw new RepositoryError('validation', PLAN_IMPORT_MESSAGES.text);
    return { kind: 'text', text };
  }
  const base64 = (input.kind === 'image' ? input.imageBase64 : input.pdfBase64).trim();
  if (!base64) throw new RepositoryError('validation', PLAN_IMPORT_MESSAGES.file);
  return input.kind === 'image' ? { kind: 'image', imageBase64: base64 } : { kind: 'pdf', pdfBase64: base64 };
}

export function sourceOfInput(input: PlanParseInput): PlanImportSource {
  return input.kind === 'image' ? 'photo' : input.kind;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `plan-import` response → ImportedPlan (re-normalized on the device), or null when unusable. */
export function planFromResponse(data: unknown, source: PlanImportSource): ImportedPlan | null {
  if (!isObj(data) || !Array.isArray(data.sessions)) return null;
  const confidence = IMPORT_CONFIDENCES.find((c) => c === data.confidence) as ImportConfidence | undefined;
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter((w): w is string => typeof w === 'string').slice(0, 3) : [];
  const dates = data.sessions
    .map((s) => (isObj(s) && typeof s.sourceDate === 'string' ? s.sourceDate : null))
    .filter((d): d is string => d !== null)
    .sort();
  return buildPlan({
    source,
    title: typeof data.title === 'string' ? data.title : null,
    sessions: data.sessions,
    sourceStart: dates[0] ?? null,
    warnings,
    engine: 'ai',
    confidence: confidence ?? null,
  });
}
