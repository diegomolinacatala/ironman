/**
 * Spanish labels for coach engines and plan proposals (pure).
 */
import type { ProposalKind, ProposalSource } from '@/domain/types';

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

/** Coach IA permission as the coach screen sees it ('declined' = "Seguir sin IA" on this visit). */
export type EngineConsent = 'not_needed' | 'needed' | 'given' | 'declined';
