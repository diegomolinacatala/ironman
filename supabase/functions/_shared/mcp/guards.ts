/**
 * Request guards for the personal-URL MCP endpoint and the ICS feed:
 * secret extraction from the path and the Origin allow-list (rate limiting
 * lives in token-gate.ts). Never log the path or the secret.
 */

/** Personal token format created by `create_personal_token`: 'rb_' + 64 hex chars. */
export const SECRET_RE = /^rb_[0-9a-f]{64}$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

/**
 * Supabase forwards the full path (`/mcp/u/<secret>` or
 * `/functions/v1/mcp/u/<secret>`, possibly with a trailing slash).
 */
export function extractMcpSecret(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const idx = segments.lastIndexOf('u');
  if (idx === -1 || idx !== segments.length - 2) return null;
  const secret = safeDecode(segments[idx + 1] ?? '');
  return SECRET_RE.test(secret) ? secret : null;
}

/** `/ics/<secret>.ics` (also tolerates a missing `.ics`). */
export function extractIcsSecret(pathname: string): string | null {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  const secret = safeDecode(last).replace(/\.ics$/i, '');
  return SECRET_RE.test(secret) ? secret : null;
}

const ALLOWED_ORIGINS = new Set(['https://claude.ai', 'https://claude.com', 'https://www.claude.ai', 'https://www.claude.com']);

/** Absent Origin (server-to-server, Anthropic backend) or Claude's own origins. */
export function isAllowedOrigin(origin: string | null, extra: readonly string[] = []): boolean {
  if (origin === null || origin === '') return true;
  const normalized = origin.trim().toLowerCase().replace(/\/$/, '');
  return ALLOWED_ORIGINS.has(normalized) || extra.map((o) => o.toLowerCase()).includes(normalized);
}
