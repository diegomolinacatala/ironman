/**
 * Push dispatcher (verify_jwt = false; `apikey` must be a server secret key).
 * Called by the notifications insert trigger (pg_net) and a pg_cron sweep.
 * Sends through APNs: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (.p8 PEM),
 * optional APNS_TOPIC (bundle id) and APNS_HOST (api.sandbox.push.apple.com
 * for development builds).
 */
import { createPushStore } from '../_shared/platform/service-stores.ts';
import { edgeContext, misconfigured, runInBackground, systemNow } from '../_shared/platform/runtime.ts';
import { createApnsSender, readApnsEnv } from '../_shared/push/apns.ts';
import { NOT_CONFIGURED_ERROR } from '../_shared/push/dispatch.ts';
import { handlePushHttp } from '../_shared/push/http.ts';
import { secretKeysFromEnv } from '../_shared/secrets.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('push-dispatch', env);
const secretKeys = secretKeysFromEnv(env);
const store = db ? createPushStore(db, systemNow) : null;
const apns = readApnsEnv(env);
if (!apns.ok) logger.error(`apns not configured: notifications get push_error ${NOT_CONFIGURED_ERROR}`, { missing: apns.missing });
/** One sender per isolate, so the provider JWT is reused across invocations. */
const sender = apns.ok ? createApnsSender({ config: apns.config, fetch: (input, init) => fetch(input, init), now: systemNow }) : null;

Deno.serve((req: Request) => {
  if (!db || !store) return misconfigured();
  return handlePushHttp(req, {
    store,
    sender,
    secretKeys,
    now: systemNow,
    logger,
    background: (task) => runInBackground(task, logger),
  });
});
