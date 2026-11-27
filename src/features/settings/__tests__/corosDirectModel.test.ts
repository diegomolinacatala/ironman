import type { IntegrationStatus } from '@/domain/types';
import { watchState } from '@/features/briefing/briefingModel';
import { isCorosSource } from '@/integrations/health/importer';

import { corosConnection, corosDirectView, corosReturnMessage, isCorosDirectConnected } from '../corosDirectModel';

const status = (over: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
  provider: 'coros_mcp',
  state: 'connected',
  expiresAt: null,
  lastSyncAt: '2026-11-26T06:35:00.000Z',
  lastError: null,
  ...over,
});
const garmin = status({ provider: 'garmin_personal' });

describe('COROS direct connection view', () => {
  it('picks the COROS row, never the Garmin one', () => {
    expect(corosConnection([garmin])).toBeUndefined();
    expect(corosConnection([garmin, status()])?.provider).toBe('coros_mcp');
    expect(isCorosDirectConnected([garmin])).toBe(false);
    expect(isCorosDirectConnected([status()])).toBe(true);
    expect(isCorosDirectConnected([status({ state: 'expired' })])).toBe(false);
  });

  it('maps each state to what the card offers', () => {
    expect(corosDirectView(undefined)).toMatchObject({ label: 'Sin conectar', isConnected: false, canConnect: true });
    expect(corosDirectView(status())).toMatchObject({ tone: 'success', isConnected: true, canConnect: false });
    expect(corosDirectView(status({ state: 'expired' }))).toMatchObject({ tone: 'danger', isConnected: true, canConnect: true });
    expect(corosDirectView(status({ state: 'error', lastError: 'COROS caído' }))).toMatchObject({ detail: 'COROS caído', canConnect: false });
  });

  it('reads the result COROS sends the athlete back with', () => {
    expect(corosReturnMessage('roadtoironman://settings/integrations?coros=connected')).toMatchObject({ ok: true });
    expect(corosReturnMessage('roadtoironman://settings/integrations?coros=error&reason=access_denied')).toEqual({
      ok: false,
      message: 'No diste permiso en COROS. Puedes intentarlo de nuevo cuando quieras.',
    });
    expect(corosReturnMessage('?coros=error&reason=weird')?.message).toBe('No se pudo conectar COROS. Inténtalo de nuevo.');
    expect(corosReturnMessage('roadtoironman://settings/integrations')).toBeNull();
    expect(corosReturnMessage(null)).toBeNull();
  });

  it('counts COROS as a connected watch with the direct connection or Apple Salud', () => {
    expect(watchState('coros', [status()], false)).toBe('connected');
    expect(watchState('coros', [], true)).toBe('connected');
    expect(watchState('coros', [garmin], false)).toBe('missing');
    expect(watchState('garmin', [status()], true)).toBe('missing');
  });

  it('recognises COROS copies in Apple Salud by their source name', () => {
    expect(isCorosSource('COROS')).toBe(true);
    expect(isCorosSource('Coros App')).toBe(true);
    expect(isCorosSource('Connect')).toBe(false);
    expect(isCorosSource(null)).toBe(false);
  });
});
