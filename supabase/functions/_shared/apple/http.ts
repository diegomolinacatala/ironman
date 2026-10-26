/**
 * `POST /apple-revoke` `{ authorizationCode }` (verify_jwt = false; the user
 * JWT is verified here) → 200 `{ revoked: boolean }`. Called by the app right
 * before `delete_my_account` for users who signed in with Apple; the app
 * deletes the account whatever the outcome. 503 `apple_not_configured` when
 * the APPLE_* secrets are missing or the key cannot be used.
 */
import { bodyErrorResponse, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { RateLimiter } from '../mcp/token-gate.ts';
import { object, string } from '../schema.ts';
import type { UUID } from '../types.ts';
import type { AppleConfig } from './client-secret.ts';
import { importP8PrivateKey } from './jwt.ts';
import { revokeWithAuthorizationCode } from './revoke.ts';
import type { FetchFn } from './revoke.ts';

export interface AppleRevokeDeps {
  config: AppleConfig | null;
  /** Verifies the caller's JWT and returns the user id (null → 401). */
  authenticate: (req: Request) => Promise<UUID | null>;
  fetch: FetchFn;
  /** Per-user cap (each call makes two requests to Apple). */
  rateLimiter: Pick<RateLimiter, 'hitToken'>;
  now: () => Date;
  logger: Logger;
}

const bodySchema = object(
  { authorizationCode: string({ min: 1, max: 4096, pattern: /^\S+$/, hint: 'el authorizationCode de Apple tal cual' }) },
  undefined,
  { stripUnknown: true },
);

const NOT_CONFIGURED = 'La revocación de Iniciar sesión con Apple no está configurada en el servidor.';

async function usableConfig(deps: AppleRevokeDeps): Promise<AppleConfig | null> {
  if (!deps.config) return null;
  try {
    await importP8PrivateKey(deps.config.privateKey);
    return deps.config;
  } catch (error) {
    deps.logger.error('apple private key unusable', errorInfo(error));
    return null;
  }
}

export async function handleAppleRevokeHttp(req: Request, deps: AppleRevokeDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  const config = await usableConfig(deps);
  if (!config) return errorResponse(503, 'apple_not_configured', NOT_CONFIGURED);
  try {
    const userId = await deps.authenticate(req);
    if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo para borrar tu cuenta.');
    const decision = deps.rateLimiter.hitToken(userId, deps.now().getTime());
    if (!decision.allowed) {
      return errorResponse(429, 'rate_limited', 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.', { 'Retry-After': String(decision.retryAfterSec) });
    }
    const parsed = bodySchema.parse(await readJson(req, 8 * 1024), '');
    if (!parsed.ok) return errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
    const outcome = await revokeWithAuthorizationCode(deps.fetch, config, parsed.value.authorizationCode, deps.now().getTime() / 1000);
    if (outcome.revoked) deps.logger.info('apple authorization revoked');
    else deps.logger.warn('apple revocation failed', { reason: outcome.reason });
    return json({ revoked: outcome.revoked });
  } catch (error) {
    const bodyError = bodyErrorResponse(error);
    if (bodyError) return bodyError;
    deps.logger.error('apple revoke failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudo revocar el acceso de Apple. Inténtalo de nuevo.');
  }
}
