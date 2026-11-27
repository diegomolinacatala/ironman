/**
 * COROS connected directly through the official COROS MCP (OAuth, synced server-side):
 * view-model helpers (pure).
 */
import type { IntegrationStatus } from '@/domain/types';

import type { StatusTone } from './garminModel';

/** Where the `coros` function sends the athlete back after COROS (see supabase/functions/_shared/coros/http.ts). */
export const COROS_RETURN_URL = 'roadtoironman://settings/integrations';

export interface CorosDirectView {
  tone: StatusTone;
  label: string;
  detail: string | null;
  /** Connected or failing: sync + disconnect are offered. */
  isConnected: boolean;
  /** Offer the "Conectar con COROS" button (first time, expired or after an error). */
  canConnect: boolean;
}

export function corosConnection(integrations: readonly IntegrationStatus[] | undefined): IntegrationStatus | undefined {
  return (integrations ?? []).find((i) => i.provider === 'coros_mcp');
}

export function isCorosDirectConnected(integrations: readonly IntegrationStatus[] | undefined): boolean {
  return corosConnection(integrations)?.state === 'connected';
}

export function corosDirectView(status: IntegrationStatus | undefined): CorosDirectView {
  switch (status?.state ?? 'disconnected') {
    case 'connected':
      return { tone: 'success', label: 'Conectado', detail: null, isConnected: true, canConnect: false };
    case 'expired':
      return {
        tone: 'danger',
        label: 'Conexión caducada',
        detail: 'COROS ya no acepta la conexión. Vuelve a conectar para seguir recibiendo tus datos.',
        isConnected: true,
        canConnect: true,
      };
    case 'error':
      return {
        tone: 'warning',
        label: 'Error al sincronizar',
        detail: status?.lastError ?? 'La última sincronización con COROS falló. Lo reintentaremos solos.',
        isConnected: true,
        canConnect: false,
      };
    default:
      return { tone: 'muted', label: 'Sin conectar', detail: null, isConnected: false, canConnect: true };
  }
}

const REASONS: Record<string, string> = {
  access_denied: 'No diste permiso en COROS. Puedes intentarlo de nuevo cuando quieras.',
  expired_state: 'El enlace de COROS caducó. Vuelve a pulsar «Conectar con COROS».',
  token_exchange: 'COROS no completó la conexión. Inténtalo de nuevo en unos minutos.',
  server_misconfigured: 'La conexión con COROS aún no está activada en el servidor.',
};

/** Message for the `?coros=connected|error&reason=…` the athlete comes back with; null if it is not ours. */
export function corosReturnMessage(url: string | null | undefined): { ok: boolean; message: string } | null {
  if (!url) return null;
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const result = params.get('coros');
  if (result === 'connected') return { ok: true, message: 'COROS conectado. Hemos traído tus últimas cuatro semanas.' };
  if (result === 'error') {
    const reason = params.get('reason') ?? '';
    return { ok: false, message: REASONS[reason] ?? 'No se pudo conectar COROS. Inténtalo de nuevo.' };
  }
  return null;
}
