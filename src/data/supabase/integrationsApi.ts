import type { CreatedToken, IntegrationStatus, PersonalToken, SyncResult, TokenScope, UUID } from '@/domain/types';
import { functionsBaseUrl } from '@/lib/env';

import { RepositoryError, type Repository } from '../repository';
import { run, runVoid, type SupabaseCtx } from './base';
import { toFunctionError } from './errors';
import { parseCreatedToken, parseSyncResult, rowToIntegration, rowToToken } from './mappersRpc';
import type { IntegrationRpcRow, TokenRpcRow } from './rows';

type IntegrationMethods = Pick<
  Repository,
  'listIntegrations' | 'connectGarmin' | 'disconnectGarmin' | 'syncGarmin' | 'listTokens' | 'createToken' | 'revokeToken'
>;

type GarminAction = 'connect' | 'disconnect' | 'sync';

const GARMIN_FALLBACK: Record<GarminAction, string> = {
  connect: 'No hemos podido conectar Garmin. Revisa la clave e inténtalo de nuevo.',
  disconnect: 'No hemos podido desconectar Garmin.',
  sync: 'No hemos podido sincronizar con Garmin.',
};

export function integrationsApi(ctx: SupabaseCtx): IntegrationMethods {
  const { client } = ctx;

  async function invokeGarmin(action: GarminAction, extra: Record<string, unknown> = {}): Promise<unknown> {
    let response: { data: unknown; error: unknown };
    try {
      response = await client.functions.invoke('garmin', { body: { action, ...extra } });
    } catch (error) {
      throw await toFunctionError(error, GARMIN_FALLBACK[action]);
    }
    if (response.error) throw await toFunctionError(response.error, GARMIN_FALLBACK[action]);
    return response.data;
  }

  async function listIntegrations(): Promise<IntegrationStatus[]> {
    const rows = await run<IntegrationRpcRow[] | null>('listIntegrations', client.rpc('integration_status'));
    return (rows ?? []).map(rowToIntegration);
  }

  async function connectGarmin(apiKey: string, expiresAt: string | null): Promise<IntegrationStatus> {
    const key = apiKey.trim();
    if (key.length < 16) throw new RepositoryError('validation', 'Pega la clave completa de la Personal API de Garmin.');
    await invokeGarmin('connect', { apiKey: key, expiresAt });
    const statuses = await listIntegrations();
    return (
      statuses.find((s) => s.provider === 'garmin_personal') ?? {
        provider: 'garmin_personal',
        state: 'connected',
        expiresAt,
        lastSyncAt: null,
        lastError: null,
      }
    );
  }

  async function disconnectGarmin(): Promise<void> {
    await invokeGarmin('disconnect');
  }

  async function syncGarmin(): Promise<SyncResult> {
    return parseSyncResult(await invokeGarmin('sync'));
  }

  async function listTokens(): Promise<PersonalToken[]> {
    const rows = await run<TokenRpcRow[] | null>('listTokens', client.rpc('list_personal_tokens'));
    return (rows ?? []).map(rowToToken);
  }

  async function createToken(scope: TokenScope, label: string): Promise<CreatedToken> {
    const cleanLabel = label.trim().slice(0, 60);
    const data = await run<unknown>(
      'createToken',
      client.rpc('create_personal_token', { p_scope: scope, p_label: cleanLabel }),
      'No se ha podido crear el enlace.',
    );
    const created = parseCreatedToken(data, { scope, label: cleanLabel, now: ctx.now(), functionsBaseUrl });
    if (!created) throw new RepositoryError('unknown', 'El servidor no devolvió el enlace. Inténtalo de nuevo.');
    return created;
  }

  async function revokeToken(id: UUID): Promise<void> {
    await runVoid('revokeToken', client.rpc('revoke_personal_token', { p_id: id }));
  }

  return { listIntegrations, connectGarmin, disconnectGarmin, syncGarmin, listTokens, createToken, revokeToken };
}
