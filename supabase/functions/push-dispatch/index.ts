/**
 * Push dispatcher (verify_jwt = false; `apikey` must be a server secret key).
 * Called by the notifications insert trigger (pg_net) and a pg_cron sweep.
 */
import { createPushStore } from '../_shared/platform/service-stores.ts';
import { edgeContext, misconfigured, runInBackground, systemNow } from '../_shared/platform/runtime.ts';
import { handlePushHttp } from '../_shared/push/http.ts';
import { createReceiptTracker } from '../_shared/push/receipts.ts';
import { secretKeysFromEnv } from '../_shared/secrets.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('push-dispatch', env);
const secretKeys = secretKeysFromEnv(env);
const expoAccessToken = env('EXPO_ACCESS_TOKEN') || undefined;
const store = db ? createPushStore(db, systemNow) : null;
/** Ticket ids awaiting their Expo receipt (lives as long as this isolate). */
const receipts = createReceiptTracker();

Deno.serve((req: Request) => {
  if (!db || !store) return misconfigured();
  return handlePushHttp(req, {
    store,
    fetch: (input, init) => fetch(input, init),
    expoAccessToken,
    secretKeys,
    now: systemNow,
    logger,
    receipts,
    background: (task) => runInBackground(task, logger),
  });
});
