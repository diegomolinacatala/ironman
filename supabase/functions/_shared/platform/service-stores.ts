/** Coach, push and Garmin-credential stores over supabase-js (service role, user-scoped). */
import type { CoachStore } from '../coach/ports.ts';
import { asRow } from '../db/rows.ts';
import type { CredentialStore, GarminCredential } from '../garmin/credentials.ts';
import { PROVIDER } from '../garmin/credentials.ts';
import type { PendingNotification, PushStore } from '../push/dispatch.ts';
import type { UUID } from '../types.ts';
import { rowsOf, unwrap } from './db.ts';
import type { Db } from './db.ts';
import { createPlanningStore } from './planning-store.ts';

export function createCoachStore(db: Db): CoachStore {
  const planning = createPlanningStore(db);
  /** Updates the job only while it is still running (a late writer never overwrites the outcome). */
  const closeJob = async (userId: UUID, jobId: UUID, patch: Record<string, unknown>, context: string): Promise<boolean> => {
    const rows = rowsOf(
      await db.from('coach_jobs').update(patch).eq('id', jobId).eq('user_id', userId).eq('status', 'running').select('id'),
      context,
    );
    return rows.length > 0;
  };
  return {
    async getAiConsentAt(userId) {
      const data = unwrap(await db.from('profiles').select('ai_consent_at').eq('id', userId).maybeSingle(), 'ai consent');
      const value = asRow(data).ai_consent_at;
      return typeof value === 'string' && value.length > 0 ? value : null;
    },
    async reserveJob(userId, request, limit) {
      const data = unwrap(await db.rpc('svc_reserve_coach_job', { p_user: userId, p_request: request, p_limit: limit }), 'svc_reserve_coach_job');
      return typeof data === 'string' && data.length > 0 ? data : null;
    },
    finishJob: (userId, jobId, result) =>
      closeJob(userId, jobId, { status: 'done', reply: result.reply, proposal_id: result.proposalId, engine: 'ai', error: null }, 'finish coach job'),
    failJob: (userId, jobId, message) => closeJob(userId, jobId, { status: 'error', error: message.slice(0, 1000) }, 'fail coach job'),
    async recordUsage(userId, usage) {
      unwrap(
        await db.from('ai_usage').insert({
          user_id: userId,
          function_name: usage.functionName,
          model: usage.model,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
        }),
        'ai usage',
      );
    },
    insertProposal: planning.insertProposal,
  };
}

export function createPushStore(db: Db, now: () => Date = () => new Date()): PushStore {
  return {
    async listUnsent(sinceIso, limit) {
      const rows = rowsOf(
        await db.from('notifications').select('id,user_id,type,title,body,data').is('pushed_at', null).gte('created_at', sinceIso).order('created_at').limit(limit),
        'unsent notifications',
      );
      return rows.map(asRow).map(
        (r): PendingNotification => ({
          id: String(r.id),
          userId: String(r.user_id),
          type: String(r.type),
          title: String(r.title ?? ''),
          body: String(r.body ?? ''),
          data: { ...asRow(r.data) },
        }),
      );
    },
    async claim(ids) {
      const rows = rowsOf(
        await db.from('notifications').update({ pushed_at: now().toISOString() }).in('id', ids).is('pushed_at', null).select('id'),
        'claim notifications',
      );
      return rows.map((r) => String(asRow(r).id));
    },
    async release(ids) {
      unwrap(await db.from('notifications').update({ pushed_at: null }).in('id', ids), 'release notifications');
    },
    async listTokens(userIds) {
      const rows = rowsOf(await db.from('push_tokens').select('token,user_id').in('user_id', userIds).eq('platform', 'ios'), 'push tokens');
      return rows.map(asRow).map((r) => ({ token: String(r.token), userId: String(r.user_id) }));
    },
    async socialPrefs(userIds) {
      const rows = rowsOf(await db.from('profiles').select('id,notification_prefs').in('id', userIds), 'notification prefs');
      return new Map(rows.map(asRow).map((r) => [String(r.id), asRow(r.notification_prefs).social !== false] as [UUID, boolean]));
    },
    async recordOutcomes(outcomes) {
      const ok = outcomes.filter((o) => o.error === null).map((o) => o.id);
      if (ok.length) unwrap(await db.from('notifications').update({ push_error: null }).in('id', ok), 'push ok');
      for (const o of outcomes.filter((x) => x.error !== null)) {
        unwrap(await db.from('notifications').update({ push_error: o.error }).eq('id', o.id), 'push error');
      }
    },
    async deleteTokens(tokens) {
      unwrap(await db.from('push_tokens').delete().in('token', tokens), 'delete push tokens');
    },
    async pruneStaleTokens(beforeIso) {
      return rowsOf(await db.from('push_tokens').delete().lt('last_seen_at', beforeIso).select('token'), 'prune push tokens').length;
    },
  };
}

const CRED_COLS = 'user_id,secret_ciphertext,key_expires_at,state,last_sync_at,last_error';

function mapCredential(raw: unknown): GarminCredential {
  const r = asRow(raw);
  const state = ['connected', 'error', 'expired', 'disconnected'].includes(String(r.state)) ? (r.state as GarminCredential['state']) : 'error';
  return {
    userId: String(r.user_id),
    ciphertext: String(r.secret_ciphertext ?? ''),
    keyExpiresAt: typeof r.key_expires_at === 'string' ? r.key_expires_at.slice(0, 10) : null,
    state,
    lastSyncAt: typeof r.last_sync_at === 'string' ? r.last_sync_at : null,
    lastError: typeof r.last_error === 'string' ? r.last_error : null,
  };
}

export function createCredentialStore(db: Db): CredentialStore {
  return {
    async getCredential(userId) {
      const data = unwrap(
        await db.from('integration_credentials').select(CRED_COLS).eq('user_id', userId).eq('provider', PROVIDER).maybeSingle(),
        'get credential',
      );
      return data ? mapCredential(data) : null;
    },
    async saveCredential(userId, value) {
      unwrap(
        await db.from('integration_credentials').upsert(
          {
            user_id: userId,
            provider: PROVIDER,
            secret_ciphertext: value.ciphertext,
            key_expires_at: value.keyExpiresAt,
            state: 'connected',
            last_error: null,
          },
          { onConflict: 'user_id,provider' },
        ),
        'save credential',
      );
    },
    async updateCredentialState(userId, value) {
      unwrap(
        await db
          .from('integration_credentials')
          .update({ state: value.state, last_error: value.lastError, ...(value.lastSyncAt ? { last_sync_at: value.lastSyncAt } : {}) })
          .eq('user_id', userId)
          .eq('provider', PROVIDER),
        'update credential',
      );
    },
    async deleteCredential(userId) {
      unwrap(await db.from('integration_credentials').delete().eq('user_id', userId).eq('provider', PROVIDER), 'delete credential');
    },
    async listSyncable() {
      const rows = rowsOf(
        await db.from('integration_credentials').select(CRED_COLS).eq('provider', PROVIDER).in('state', ['connected', 'error']).limit(200),
        'syncable credentials',
      );
      return rows.map(mapCredential);
    },
    async getTimezone(userId) {
      const data = unwrap(await db.from('profiles').select('timezone').eq('id', userId).maybeSingle(), 'timezone');
      const tz = asRow(data).timezone;
      return typeof tz === 'string' && tz ? tz : null;
    },
  };
}
