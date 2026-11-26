/**
 * «Tu contexto» › «¿Algo más que deba saber?» without the AI (AI off, demo, or
 * the AI failed): the rules engine never plans from it — it only acknowledges.
 * The screen saves the athlete's text as a note of their context.
 */
import type { CoachRequest, CoachResponse } from '@/domain/types';

export const CONTEXT_RULES_REPLY = 'Apuntado. Lo tendré en cuenta al planificar tus semanas.';

export function isContextRequest(request: CoachRequest): boolean {
  return request.topic === 'context';
}

export function contextRulesResponse(): CoachResponse {
  return { reply: CONTEXT_RULES_REPLY, proposal: null, engine: 'rules', memory: [], lifeEvent: null, quedada: null };
}
