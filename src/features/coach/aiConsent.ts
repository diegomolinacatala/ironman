/**
 * Consent to send the athlete's context to Anthropic for the Coach IA (pure).
 *
 * Only the Supabase backend calls the AI. The demo runs the rules engine on
 * the phone, so it needs no consent. Without consent the coach function
 * answers 403 `consent_required` and the app falls back to the rules engine.
 */
import type { ISODateTime, Profile } from '@/domain/types';
import type { IconName } from '@/ui';

export type AiConsentState = 'not_needed' | 'needed' | 'given';

export const AI_PROVIDER = 'Anthropic';

export function aiConsentState(
  mode: 'supabase' | 'demo',
  profile: Pick<Profile, 'aiConsentAt'> | null | undefined,
): AiConsentState {
  if (mode === 'demo') return 'not_needed';
  return profile?.aiConsentAt ? 'given' : 'needed';
}

export interface SharedDataItem {
  icon: IconName;
  label: string;
}

/** What the Coach IA sends to Anthropic (keep in sync with docs/PRIVACY.md). */
export const AI_SHARED_DATA: readonly SharedDataItem[] = [
  { icon: 'week', label: 'Tu plan: entrenos, carreras, quedadas y disponibilidad' },
  { icon: 'progress', label: 'Tu carga de entrenamiento' },
  { icon: 'bolt', label: 'Tus imprevistos, también molestias y lesiones' },
  { icon: 'moon', label: 'Tus check-ins diarios' },
  { icon: 'health', label: 'Métricas de Apple Salud y Garmin: sueño, pulso, VFC…' },
  { icon: 'calendarBadge', label: 'Las horas ocupadas de tu calendario, SIN títulos' },
  { icon: 'food', label: 'Tu registro de nutrición' },
  { icon: 'edit', label: 'Tus notas para el coach y lo que le escribas' },
];

export const AI_NEVER_SHARED = 'Nunca enviamos los títulos de tus eventos del calendario.';

export const AI_TERMS_NOTE =
  'Anthropic trata estos datos solo para generar tu propuesta y, según sus condiciones comerciales, no los usa para entrenar sus modelos.';

/** "25 oct 2026" style date for the consent timestamp. */
export function formatConsentDate(at: ISODateTime): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}
