/**
 * Meal analysis on Supabase: the `meal` edge function (Claude vision; nothing
 * is stored). With the AI off, or when it is unavailable / slow, a rough local
 * estimate from the description is returned instead (`engine: 'rules'`).
 */
import { isISODate, isISOTime } from '@/domain/dates';
import { estimateMealLocally } from '@/domain/mealEstimate';
import type { MealAnalysis, MealAnalysisInput } from '@/domain/types';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import { RepositoryError, type Repository } from '../repository';
import { invokeAiFunction } from './aiFunctions';
import type { SupabaseCtx } from './base';
import { parseMealAnalysis } from './mappersAi';

export const MEAL_TIMEOUT_MS = 45_000;
/** The function rejects base64 bodies above 2 MB (413 `too_large`). */
export const MEAL_IMAGE_MAX_BASE64 = 2 * 1024 * 1024;
const TEXT_MAX = 1000;

export const MEAL_MESSAGES = {
  tooLarge: 'La foto es demasiado grande. Prueba con otra o hazla de nuevo.',
  empty: 'Haz una foto o describe la comida para analizarla.',
  invalidDate: 'La fecha o la hora de la comida no son válidas.',
} as const;

/** Trims the text, drops empty fields and validates what the function would reject. */
export function cleanMealInput(input: MealAnalysisInput): MealAnalysisInput {
  if (!isISODate(input.date) || !isISOTime(input.time)) throw new RepositoryError('validation', MEAL_MESSAGES.invalidDate);
  const text = input.text?.trim().slice(0, TEXT_MAX) || undefined;
  const imageBase64 = input.imageBase64?.trim() || undefined;
  if (!text && !imageBase64) throw new RepositoryError('validation', MEAL_MESSAGES.empty);
  if (imageBase64 && imageBase64.length > MEAL_IMAGE_MAX_BASE64) throw new RepositoryError('validation', MEAL_MESSAGES.tooLarge);
  return { date: input.date, time: input.time, ...(text ? { text } : {}), ...(imageBase64 ? { imageBase64 } : {}) };
}

export function mealApi(ctx: SupabaseCtx, timeoutMs = MEAL_TIMEOUT_MS): Pick<Repository, 'analyzeMeal'> {
  async function analyzeMeal(raw: MealAnalysisInput): Promise<MealAnalysis> {
    const input = cleanMealInput(raw);
    if (!env.aiCoachEnabled) return estimateMealLocally(input);
    const result = await invokeAiFunction(ctx, {
      name: 'meal',
      body: { ...input },
      timeoutMs,
      fallbackMessage: 'No hemos podido analizar la comida. Inténtalo de nuevo.',
      statusErrors: { 413: { code: 'validation', message: MEAL_MESSAGES.tooLarge } },
    });
    if (result.kind === 'fallback') {
      logger.warn('meal: using the local estimate', result.reason);
      return estimateMealLocally(input);
    }
    const analysis = parseMealAnalysis(result.data, input);
    if (analysis) return analysis;
    logger.warn('meal: unexpected response, using the local estimate');
    return estimateMealLocally(input);
  }

  return { analyzeMeal };
}
