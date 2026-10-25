/**
 * Sign in with Apple revocation for account deletion:
 * POST { authorizationCode } with the user JWT (verify_jwt = false; verified in code) → { revoked }.
 * Secrets: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (.p8 PEM), APPLE_CLIENT_ID (bundle id).
 */
import { appleConfigFromEnv } from '../_shared/apple/client-secret.ts';
import { handleAppleRevokeHttp } from '../_shared/apple/http.ts';
import { bearerToken } from '../_shared/http.ts';
import { createRateLimiter } from '../_shared/mcp/token-gate.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('apple-revoke', env);
const config = appleConfigFromEnv(env);
const rateLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

Deno.serve((req: Request) => {
  if (!db) return misconfigured();
  return handleAppleRevokeHttp(req, {
    config,
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    fetch: (input, init) => fetch(input, init),
    rateLimiter,
    now: systemNow,
    logger,
  });
});
