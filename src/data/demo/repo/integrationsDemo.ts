import type { CreatedToken, DailyMetrics, IntegrationStatus, PersonalToken, SyncResult, TokenScope, UUID } from '@/domain/types';
import { functionsBaseUrl } from '@/lib/env';

import { RepositoryError, type Repository } from '../../repository';
import { tokenUrl } from '../../supabase/mappersRpc';
import type { DemoDb, DemoIntegration, DemoToken } from '../db';
import { requireMe, type DemoDeps } from './common';

type IntegrationMethods = Pick<
  Repository,
  'listIntegrations' | 'connectGarmin' | 'disconnectGarmin' | 'syncGarmin' | 'listTokens' | 'createToken' | 'revokeToken'
>;

const MAX_ACTIVE_TOKENS = 5;
/** Placeholder base URL shown in demo mode (the real one needs the backend). */
export const DEMO_FUNCTIONS_BASE_URL = 'https://TU-PROYECTO.supabase.co/functions/v1';
/** Shown by the UI next to tokens created in demo mode (`repo.mode === 'demo'`). */
export const DEMO_TOKEN_NOTE =
  'Modo demo: este enlace es de ejemplo y no funcionará. Configura el backend (Supabase) para conectar tu Claude o tu calendario de verdad.';
export const DEMO_SYNC_MESSAGE = 'Modo demo: datos de Garmin simulados. Conecta el backend para sincronizar tu reloj de verdad.';

function randomHex(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function strip(i: DemoIntegration): IntegrationStatus {
  return { provider: i.provider, state: i.state, expiresAt: i.expiresAt, lastSyncAt: i.lastSyncAt, lastError: i.lastError };
}

function stripToken(t: DemoToken): PersonalToken {
  return { id: t.id, scope: t.scope, label: t.label, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, revokedAt: t.revokedAt };
}

/** Today's simulated Garmin snapshot, derived from the latest stored day. */
function simulatedMetrics(db: DemoDb, me: UUID, today: string): DailyMetrics {
  const latest = [...db.metrics].filter((m) => m.userId === me).sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    userId: me,
    date: today,
    source: 'garmin',
    hrvMs: latest?.hrvMs ?? 66,
    restingHr: latest?.restingHr ?? 50,
    sleepHours: latest?.sleepHours ?? 7.2,
    sleepScore: latest?.sleepScore ?? 78,
    bodyBattery: latest?.bodyBattery ?? 74,
    trainingReadiness: latest?.trainingReadiness ?? 70,
    vo2max: latest?.vo2max ?? 54,
    steps: latest?.steps ?? 9000,
    stressAvg: latest?.stressAvg ?? 28,
    trainingStatus: latest?.trainingStatus ?? 'Productivo',
  };
}

function withSync(db: DemoDb, me: UUID, now: string, today: string): DemoDb {
  const metrics = simulatedMetrics(db, me, today);
  return {
    ...db,
    metrics: [...db.metrics.filter((m) => !(m.userId === me && m.date === today && m.source === 'garmin')), metrics],
    integrations: db.integrations.map((i) => (i.userId === me ? { ...i, lastSyncAt: now, lastError: null, state: 'connected' } : i)),
  };
}

function garminMethods({ store }: DemoDeps): Pick<Repository, 'listIntegrations' | 'connectGarmin' | 'disconnectGarmin' | 'syncGarmin'> {
  return {
    async listIntegrations() {
      const me = await requireMe(store);
      return (await store.read()).integrations.filter((i) => i.userId === me).map(strip);
    },
    async connectGarmin(apiKey: string, expiresAt: string | null) {
      if (apiKey.trim().length < 16) throw new RepositoryError('validation', 'Pega la clave completa de la Personal API de Garmin.');
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const integration: DemoIntegration = { userId: me, provider: 'garmin_personal', state: 'connected', expiresAt, lastSyncAt: null, lastError: null };
        const next = withSync({ ...db, integrations: [...db.integrations.filter((i) => i.userId !== me), integration] }, me, clock.now, clock.today);
        const stored = next.integrations.find((i) => i.userId === me) ?? integration;
        return { db: next, result: strip(stored) };
      });
    },
    async disconnectGarmin() {
      const me = await requireMe(store);
      await store.update((db) => ({ db: { ...db, integrations: db.integrations.filter((i) => i.userId !== me) }, result: undefined }));
    },
    async syncGarmin(): Promise<SyncResult> {
      const me = await requireMe(store);
      return store.update((db, clock) => {
        if (!db.integrations.some((i) => i.userId === me && i.state === 'connected')) {
          throw new RepositoryError('validation', 'Conecta Garmin antes de sincronizar.');
        }
        return {
          db: withSync(db, me, clock.now, clock.today),
          result: { metricsDays: 1, activitiesImported: 0, workoutsCompleted: 0, message: DEMO_SYNC_MESSAGE },
        };
      });
    },
  };
}

function tokenMethods({ store }: DemoDeps): Pick<Repository, 'listTokens' | 'createToken' | 'revokeToken'> {
  return {
    async listTokens() {
      const me = await requireMe(store);
      return (await store.read()).tokens
        .filter((t) => t.userId === me)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(stripToken);
    },
    async createToken(scope: TokenScope, label: string): Promise<CreatedToken> {
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const active = db.tokens.filter((t) => t.userId === me && t.scope === scope && t.revokedAt === null);
        if (active.length >= MAX_ACTIVE_TOKENS) {
          throw new RepositoryError('conflict', 'Ya tienes 5 enlaces activos de este tipo. Revoca uno antes de crear otro.');
        }
        const secret = `rb_${randomHex(64)}`;
        const token: DemoToken = { id: clock.newId(), userId: me, scope, label: label.trim().slice(0, 60), prefix: secret.slice(0, 10), createdAt: clock.now, lastUsedAt: null, revokedAt: null };
        const url = tokenUrl(scope, secret, functionsBaseUrl || DEMO_FUNCTIONS_BASE_URL);
        return { db: { ...db, tokens: [...db.tokens, token] }, result: { token: stripToken(token), secret, url } };
      });
    },
    async revokeToken(id: UUID) {
      const me = await requireMe(store);
      await store.update((db, clock) => ({
        db: { ...db, tokens: db.tokens.map((t) => (t.id === id && t.userId === me && !t.revokedAt ? { ...t, revokedAt: clock.now } : t)) },
        result: undefined,
      }));
    },
  };
}

export function integrationsDemo(deps: DemoDeps): IntegrationMethods {
  return { ...garminMethods(deps), ...tokenMethods(deps) };
}
