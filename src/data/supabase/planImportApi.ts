/**
 * Imported plans on Supabase: the `plan-import` edge function reads photos,
 * PDFs and pasted text with the free AI; `apply_plan_import` /
 * `delete_plan_import` RPCs write; `plan_imports` rows (own, RLS) are read
 * directly. Pasted text falls back to the local rules parser when the AI is
 * off or unavailable; photos and PDFs say why they could not be read.
 */
import { todayISO } from '@/domain/dates';
import { IMPORT_CONFIDENCES, PLAN_IMPORT_SOURCES } from '@/domain/planImport';
import type { ImportedPlan, PlanImport, PlanImportDraft, PlanImportResult, PlanParseInput } from '@/domain/planImport';
import { parsePlanText } from '@/domain/planImportText';
import type { UUID } from '@/domain/types';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import { assertParseInput, assertPlanImportDraft, planFromResponse, sourceOfInput } from '../planImportShared';
import { RepositoryError, type Repository } from '../repository';
import { invokeAiFunction } from './aiFunctions';
import { run, type SupabaseCtx } from './base';
import { asNumber, asString, isRecord, oneOfOr } from './narrow';

type PlanImportMethods = Pick<Repository, 'parsePlanImport' | 'listPlanImports' | 'applyPlanImport' | 'deletePlanImport'>;

export const PLAN_IMPORT_TIMEOUT_MS = 110_000;
export const PLAN_IMPORT_COLUMNS = 'id,source,title,start_date,end_date,session_count,confidence,created_at';

export const PLAN_IMPORT_ERRORS = {
  tooLarge: 'El archivo es demasiado grande (máximo 4,5 MB el PDF y 2 MB la foto).',
  scanned: 'Este PDF es una imagen escaneada y no tiene texto. Haz una foto o una captura de cada página y súbelas como foto.',
  consent: 'Para leer fotos y PDF con IA, acepta el uso de la IA del coach en Tú › Privacidad y datos. Mientras tanto, pega el texto o importa un Excel o CSV.',
  limited: 'Has leído muchos planes hoy. Vuelve a intentarlo más tarde o importa un Excel o CSV.',
  unavailable: 'Ahora mismo no puedo leer fotos ni PDF. Inténtalo en un rato, pega el texto o importa un Excel o CSV.',
  off: 'La lectura de fotos y PDF necesita la IA del coach, que está desactivada. Pega el texto o importa un Excel o CSV.',
  unexpected: 'No he entendido la respuesta del servidor al leer el plan. Inténtalo de nuevo.',
} as const;

function fallbackMessage(reason: string): string {
  if (reason === 'consent_required') return PLAN_IMPORT_ERRORS.consent;
  if (reason === 'rate_limited' || reason === 'http_429') return PLAN_IMPORT_ERRORS.limited;
  return PLAN_IMPORT_ERRORS.unavailable;
}

export function rowToPlanImport(row: Record<string, unknown>): PlanImport {
  return {
    id: asString(row.id) ?? '',
    source: oneOfOr(row.source, PLAN_IMPORT_SOURCES, 'text'),
    title: asString(row.title) ?? '',
    startDate: asString(row.start_date) ?? asString(row.startDate) ?? '',
    endDate: asString(row.end_date) ?? asString(row.endDate) ?? '',
    sessionCount: asNumber(row.session_count) ?? asNumber(row.sessionCount) ?? 0,
    confidence: oneOfOr(row.confidence, IMPORT_CONFIDENCES, 'medium'),
    createdAt: asString(row.created_at) ?? asString(row.createdAt) ?? '',
  };
}

export function planImportApi(ctx: SupabaseCtx, timeoutMs = PLAN_IMPORT_TIMEOUT_MS): PlanImportMethods {
  const { client } = ctx;
  const today = () => todayISO(new Date(ctx.now()));

  async function parsePlanImport(raw: PlanParseInput): Promise<ImportedPlan> {
    const input = assertParseInput(raw);
    const source = sourceOfInput(input);
    if (!env.aiCoachEnabled) {
      if (input.kind === 'text') return parsePlanText(input.text);
      throw new RepositoryError('unavailable', PLAN_IMPORT_ERRORS.off);
    }
    const result = await invokeAiFunction(ctx, {
      name: 'plan-import',
      body: { ...input },
      timeoutMs,
      fallbackMessage: 'No hemos podido leer el plan. Inténtalo de nuevo.',
      statusErrors: {
        413: { code: 'validation', message: PLAN_IMPORT_ERRORS.tooLarge },
        422: { code: 'validation', message: PLAN_IMPORT_ERRORS.scanned },
      },
    });
    if (result.kind === 'fallback') {
      logger.warn('plan import: AI unavailable', result.reason);
      if (input.kind === 'text') return parsePlanText(input.text);
      throw new RepositoryError(result.reason === 'rate_limited' ? 'rate_limited' : 'unavailable', fallbackMessage(result.reason));
    }
    const plan = planFromResponse(result.data, source);
    if (plan) return plan;
    if (input.kind === 'text') return parsePlanText(input.text);
    throw new RepositoryError('unknown', PLAN_IMPORT_ERRORS.unexpected);
  }

  async function listPlanImports(): Promise<PlanImport[]> {
    const me = await ctx.userId();
    const rows = await run<Record<string, unknown>[] | null>(
      'listPlanImports',
      client.from('plan_imports').select(PLAN_IMPORT_COLUMNS).eq('user_id', me).order('created_at', { ascending: false }),
    );
    return (rows ?? []).map(rowToPlanImport);
  }

  async function applyPlanImport(raw: PlanImportDraft): Promise<PlanImportResult> {
    const draft = assertPlanImportDraft(raw, today());
    const data = await run<unknown>(
      'applyPlanImport',
      client.rpc('apply_plan_import', {
        p_import: { source: draft.source, title: draft.title, confidence: draft.confidence, plan: draft.plan },
        p_workouts: draft.workouts,
        p_replace: draft.replaceGenerated,
      }),
      'No se ha podido guardar el plan importado.',
    );
    if (!isRecord(data) || !isRecord(data.import)) throw new RepositoryError('unknown', PLAN_IMPORT_ERRORS.unexpected);
    return { import: rowToPlanImport(data.import), added: asNumber(data.added) ?? 0, replaced: asNumber(data.replaced) ?? 0 };
  }

  async function deletePlanImport(id: UUID): Promise<{ removed: number }> {
    const removed = await run<unknown>('deletePlanImport', client.rpc('delete_plan_import', { p_id: id }), 'No se ha podido quitar el plan importado.');
    return { removed: asNumber(removed) ?? 0 };
  }

  return { parsePlanImport, listPlanImports, applyPlanImport, deletePlanImport };
}
