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

/**
 * A proposal summary as a one-sentence headline plus the rest (null when it is
 * a single sentence): "Hoy: ámbar (52/100). Fatiga alta…" → "Hoy: ámbar (52/100)." + "Fatiga alta…".
 */
export function splitSummary(summary: string): { headline: string; rest: string | null } {
  const text = summary.replace(/\s+/g, ' ').trim();
  const end = /[.!?…](?=\s+\S)/.exec(text);
  if (!end) return { headline: text, rest: null };
  const cut = end.index + 1;
  return { headline: text.slice(0, cut), rest: text.slice(cut).trim() || null };
}

/** Coach IA permission as the coach screen sees it ('declined' = "Seguir sin IA" on this visit). */
export type EngineConsent = 'not_needed' | 'needed' | 'given' | 'declined';
