/**
 * COROS through the official COROS MCP: POST { action: start | sync | disconnect | sync_all }
 * and GET /coros/callback (OAuth redirect from COROS). start/sync/disconnect need the user
 * JWT; sync_all needs a server secret key (pg_cron); the callback is authenticated by its
 * encrypted `state`. verify_jwt = false (COROS calls the callback without a JWT).
 *
 * Secrets: COROS_TOKEN_SECRET (≥ 32 random characters; encrypts the token bundles and the
 * OAuth state). Optional COROS_MCP_URL (default https://mcp.coros.com/mcp).
 */
import { handleCorosHttp } from '../_shared/coros/http.ts';
import { PROVIDER } from '../_shared/coros/credentials.ts';
import { bearerToken } from '../_shared/http.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';
import { createCredentialStore } from '../_shared/platform/service-stores.ts';
import { secretKeysFromEnv } from '../_shared/secrets.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('coros', env);
const secretKeys = secretKeysFromEnv(env);
const store = db ? createPlanningStore(db, systemNow) : null;
const credentials = db ? createCredentialStore(db, PROVIDER) : null;
const supabaseUrl = env('SUPABASE_URL');
const callbackUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/coros/callback` : undefined;

Deno.serve((req: Request) => {
  if (!db || !store || !credentials) return misconfigured();
  return handleCorosHttp(req, {
    store,
    credentials,
    fetch: (input, init) => fetch(input, init),
    tokenSecret: env('COROS_TOKEN_SECRET'),
    callbackUrl,
    entryUrl: env('COROS_MCP_URL') || undefined,
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    secretKeys,
    now: systemNow,
    logger,
  });
});
