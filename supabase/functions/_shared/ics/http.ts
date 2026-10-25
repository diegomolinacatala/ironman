/** `GET /ics/<secret>.ics` → text/calendar for the token's owner (scope 'ics'). */
import { sha256Hex } from '../crypto.ts';
import { addDays, DEFAULT_TZ, todayIn } from '../dates.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { extractIcsSecret } from '../mcp/guards.ts';
import { authorizeToken, clientKeyOf } from '../mcp/token-gate.ts';
import type { RateLimiter } from '../mcp/token-gate.ts';
import type { PlanningReader } from '../planning/store.ts';
import type { UUID } from '../types.ts';
import { buildIcsFeed, ICS_FUTURE_DAYS, ICS_PAST_DAYS } from './feed.ts';

export interface IcsDeps {
  resolveUserId: (tokenHash: string) => Promise<UUID | null>;
  reader: Pick<PlanningReader, 'getProfile' | 'listWorkouts' | 'listJointSessions'>;
  rateLimiter: RateLimiter;
  now: () => Date;
  logger: Logger;
}

const text = (status: number, body: string, extra: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extra } });

export async function handleIcsHttp(req: Request, deps: IcsDeps): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Método no permitido', { Allow: 'GET, HEAD' });
  const secret = extractIcsSecret(new URL(req.url).pathname);
  if (!secret) return text(404, 'Calendario no encontrado');
  try {
    const tokenHash = await sha256Hex(secret);
    const auth = await authorizeToken(deps.rateLimiter, deps.resolveUserId, { tokenHash, clientKey: clientKeyOf(req.headers), nowMs: deps.now().getTime() });
    if (!auth.ok && auth.reason === 'rate_limited') return text(429, 'Demasiadas peticiones', { 'Retry-After': String(auth.retryAfterSec) });
    if (!auth.ok) return text(404, 'Calendario no encontrado o revocado. Genera un enlace nuevo en la app.');
    const userId = auth.userId;
    const now = deps.now();
    const profile = await deps.reader.getProfile(userId);
    const today = todayIn(profile?.timezone ?? DEFAULT_TZ, now);
    const from = addDays(today, -ICS_PAST_DAYS);
    const to = addDays(today, ICS_FUTURE_DAYS);
    const [workouts, jointSessions] = await Promise.all([
      deps.reader.listWorkouts(userId, from, to),
      deps.reader.listJointSessions(userId, from, to),
    ]);
    const body = buildIcsFeed({ userId, workouts, jointSessions, now, calendarName: 'Rebufo' });
    deps.logger.info('ics served', { events: workouts.length });
    return new Response(req.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': 'inline; filename="rebufo.ics"',
      },
    });
  } catch (error) {
    deps.logger.error('ics failed', errorInfo(error));
    return text(500, 'No se pudo generar el calendario. Inténtalo más tarde.');
  }
}
