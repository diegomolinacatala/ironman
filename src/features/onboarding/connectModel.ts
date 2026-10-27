/**
 * Garmin + Claude connection helpers (pure), shared by the onboarding steps,
 * the Tú tab and the settings screens.
 */
import { RepositoryError } from '@/data/repository';
import type { DailyMetrics, PersonalToken, UUID, Workout } from '@/domain/types';
import { errorMessage } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Garmin
// ---------------------------------------------------------------------------

/** "Seguir sin Garmin" appears after a failed attempt or after this long on the step. */
export const GARMIN_SKIP_AFTER_MS = 45_000;
/** We ask the athlete to choose "1 año" when creating the key in Garmin Connect. */
export const GARMIN_KEY_DAYS = 365;
/** Any key works in demo mode; short ones are replaced by this (the demo repo wants ≥ 16 chars). */
export const DEMO_GARMIN_KEY = 'demo-personal-api-key-road-to-ironman';
export const GARMIN_INVALID_KEY_MESSAGE = 'La clave no es válida o ha caducado: crea una nueva y vuelve a copiarla.';
const NETWORK_MESSAGE = 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
const INVALID_KEY_RE = /clave|key|caduc|expired|inv[aá]lid/i;

/** Clear, actionable Spanish message for a failed Garmin connection. */
export function garminErrorMessage(error: unknown): string {
  if (error instanceof RepositoryError) {
    if (error.code === 'network') return NETWORK_MESSAGE;
    if (error.code === 'validation' || error.code === 'conflict') return GARMIN_INVALID_KEY_MESSAGE;
    if (error.code === 'rate_limited') return 'Garmin está recibiendo demasiadas peticiones. Espera un minuto y vuelve a probar.';
  }
  const message = errorMessage(error, '');
  if (INVALID_KEY_RE.test(message)) return GARMIN_INVALID_KEY_MESSAGE;
  return message || 'No hemos podido conectar con Garmin. Inténtalo de nuevo en un momento.';
}

/** Key the demo repository accepts for any pasted text. */
export function demoSafeKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.length >= 16 && !/\s/.test(trimmed) ? trimmed : DEMO_GARMIN_KEY;
}

export interface ImportSummary {
  /** Days with at least one Garmin wellness value. */
  days: number;
  activities: number;
  /** What came in, in reading order ("sueño", "VFC"…). */
  kinds: string[];
}

const KIND_FIELDS: readonly { label: string; has: (m: DailyMetrics) => boolean }[] = [
  { label: 'sueño', has: (m) => m.sleepHours != null || m.sleepScore != null },
  { label: 'VFC', has: (m) => m.hrvMs != null },
  { label: 'pulso en reposo', has: (m) => m.restingHr != null },
  { label: 'Body Battery', has: (m) => m.bodyBattery != null },
];

function isGarminWorkout(w: Workout): boolean {
  return w.source === 'garmin' || w.completed?.source === 'garmin' || (w.externalId ?? '').startsWith('garmin:');
}

export function importSummary(metrics: readonly DailyMetrics[], workouts: readonly Workout[]): ImportSummary {
  const garmin = metrics.filter((m) => m.source === 'garmin' && KIND_FIELDS.some((k) => k.has(m)));
  return {
    days: new Set(garmin.map((m) => m.date)).size,
    activities: workouts.filter(isGarminWorkout).length,
    kinds: KIND_FIELDS.filter((k) => garmin.some(k.has)).map((k) => k.label),
  };
}

/** "uno, dos y tres". */
export function joinEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** "28 días de sueño, VFC y pulso en reposo · 9 actividades". */
export function importSummaryLine(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.days > 0) {
    const days = summary.days === 1 ? '1 día' : `${summary.days} días`;
    parts.push(summary.kinds.length ? `${days} de ${joinEs(summary.kinds)}` : days);
  }
  if (summary.activities > 0) parts.push(summary.activities === 1 ? '1 actividad' : `${summary.activities} actividades`);
  return parts.length ? parts.join(' · ') : 'Tus datos irán llegando en unos minutos.';
}

// ---------------------------------------------------------------------------
// Claude (personal `mcp` token)
// ---------------------------------------------------------------------------

export const CLAUDE_TOKEN_LABEL = 'Claude';
export const CLAUDE_POLL_MS = 3000;
export const CLAUDE_SKIP_AFTER_MS = 45_000;

export type ClaudeLink = 'connected' | 'waiting' | 'none';

function activeMcp(tokens: readonly PersonalToken[]): PersonalToken[] {
  return tokens.filter((t) => t.scope === 'mcp' && !t.revokedAt);
}

/** Most recently used active connector token (Claude has called our MCP endpoint with it). */
export function latestUsedClaudeToken(tokens: readonly PersonalToken[]): PersonalToken | null {
  const used = activeMcp(tokens).filter((t) => t.lastUsedAt);
  return [...used].sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))[0] ?? null;
}

/**
 * With a freshly created token we wait for THAT token to be used (claude.ai
 * calls our endpoint when the connector is added). Without one, any used
 * active connector means Claude is already connected.
 */
export function claudeLinkState(tokens: readonly PersonalToken[], createdId: UUID | null): ClaudeLink {
  if (createdId) {
    const created = tokens.find((t) => t.id === createdId);
    return created?.lastUsedAt && !created.revokedAt ? 'connected' : 'waiting';
  }
  return latestUsedClaudeToken(tokens) ? 'connected' : 'none';
}

/** Active connector tokens Claude never used, oldest first. */
export function unusedClaudeTokens(tokens: readonly PersonalToken[]): PersonalToken[] {
  return activeMcp(tokens)
    .filter((t) => !t.lastUsedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Before minting a new link we revoke the never-used ones: their secret URL
 * cannot be shown again, so they are only clutter. Used tokens are never
 * touched (they may be live in someone's Claude).
 */
export function tokensToRevokeBeforeCreate(tokens: readonly PersonalToken[]): UUID[] {
  return unusedClaudeTokens(tokens).map((t) => t.id);
}

/** Settings: wait on the latest unused link instead of minting one on every visit (none when Claude is connected). */
export function reusableClaudeTokenForSettings(tokens: readonly PersonalToken[]): PersonalToken | null {
  if (latestUsedClaudeToken(tokens)) return null;
  const unused = unusedClaudeTokens(tokens);
  return unused[unused.length - 1] ?? null;
}

/** An unused link younger than this is reused by the onboarding (e.g. after the app was killed). */
export const CLAUDE_REUSE_WINDOW_MS = 10 * 60_000;

/** Onboarding: the link it created (stored id), still unused and recent enough to keep waiting on. */
export function reusableClaudeTokenForOnboarding(
  tokens: readonly PersonalToken[],
  storedId: UUID | null,
  now: Date = new Date(),
): PersonalToken | null {
  if (!storedId) return null;
  const token = unusedClaudeTokens(tokens).find((t) => t.id === storedId);
  if (!token) return null;
  const age = now.getTime() - new Date(token.createdAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < CLAUDE_REUSE_WINDOW_MS ? token : null;
}
