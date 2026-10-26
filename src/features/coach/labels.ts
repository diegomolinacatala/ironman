/**
 * Spanish labels for coach engines and plan proposals (pure).
 */
import type { ProposalKind, ProposalSource } from '@/domain/types';

import { isAiCoachEnabled } from './aiCoachFlag';

export { proposalStatusLabel } from '@/domain/labels';

export function proposalSourceLabel(source: ProposalSource): string {
  switch (source) {
    case 'rules':
      return 'Reglas';
    case 'ai_coach':
      return 'Coach IA';
    case 'claude':
      return 'Tu Claude';
  }
}

export function proposalKindLabel(kind: ProposalKind): string {
  switch (kind) {
    case 'generate_week':
      return 'Semana nueva';
    case 'replan':
      return 'Reorganización';
    case 'chat':
      return 'Sugerencia';
  }
}

export function changeCountLabel(n: number): string {
  return n === 1 ? '1 cambio' : `${n} cambios`;
}

export type EngineKind = 'ai' | 'rules';

export interface EngineInfo {
  kind: EngineKind;
  label: string;
  explanation: string;
}

/** Coach IA permission as the coach screen sees it ('declined' = "Seguir sin IA" on this visit). */
export type EngineConsent = 'not_needed' | 'needed' | 'given' | 'declined';

/**
 * Which engine the coach screen advertises.
 * - demo backend → rules engine, always.
 * - AI coach switched off (EXPO_PUBLIC_AI_COACH) → rules engine, always.
 * - Supabase without permission for the AI → rules (or a heads-up that we will ask).
 * - Supabase → Claude, unless the last answer fell back to the rules.
 */
export function engineInfo(
  mode: 'supabase' | 'demo',
  lastEngine: EngineKind | null,
  consent: EngineConsent = 'given',
  aiEnabled: boolean = isAiCoachEnabled(),
): EngineInfo {
  if (mode === 'demo') {
    return {
      kind: 'rules',
      label: 'Reglas',
      explanation: 'Modo demo: el motor de reglas planifica en tu móvil, sin conexión ni IA.',
    };
  }
  if (!aiEnabled) {
    return {
      kind: 'rules',
      label: 'Reglas',
      explanation: 'Tu coach planifica con reglas de entrenamiento: tus horas, tu carga y tu fase de temporada.',
    };
  }
  if (consent === 'declined') {
    return {
      kind: 'rules',
      label: 'Reglas',
      explanation: 'Sin tu permiso para la IA te responde el motor de reglas. Puedes activar el Coach IA cuando quieras.',
    };
  }
  if (lastEngine === 'rules') {
    return {
      kind: 'rules',
      label: 'Reglas',
      explanation: 'La IA no estaba disponible: te ha respondido el motor de reglas. Puedes reintentarlo luego.',
    };
  }
  if (consent === 'needed') {
    return {
      kind: 'ai',
      label: 'IA · Claude',
      explanation: 'Antes de la primera petición te pediremos permiso para compartir tus datos con Anthropic.',
    };
  }
  return {
    kind: 'ai',
    label: 'IA · Claude',
    explanation: 'Claude (Anthropic) lee tu semana, tu carga, tus imprevistos y tus quedadas, y te propone cambios.',
  };
}

/** Rotating progress lines while the coach works (AI can take ~2 min). */
export function thinkingLines(friendName: string | null): string[] {
  return [
    'Leyendo tu semana…',
    'Revisando tu carga…',
    'Mirando tus imprevistos…',
    friendName ? `Cuadrando huecos con ${friendName}…` : 'Buscando huecos libres…',
    'Respetando tus quedadas y sesiones clave…',
    'Ajustando intensidades…',
    'Escribiendo la propuesta…',
  ];
}
