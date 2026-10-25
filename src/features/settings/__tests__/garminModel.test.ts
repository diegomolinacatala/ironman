import { describe, expect, test } from '@jest/globals';

import type { IntegrationStatus } from '@/domain/types';

import { expiryDateFor, garminKeyError, garminStatusView } from '../garminModel';

const TODAY = '2026-10-25';

function status(patch: Partial<IntegrationStatus>): IntegrationStatus {
  return { provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null, ...patch };
}

describe('garminModel', () => {
  test('expiryDateFor adds days to today', () => {
    expect(expiryDateFor(30, TODAY)).toBe('2026-11-24');
    expect(expiryDateFor(365, TODAY)).toBe('2027-10-25');
  });

  test('garminKeyError validates shape', () => {
    expect(garminKeyError('')).toMatch(/Pega/);
    expect(garminKeyError('abc def ghi jkl mno')).toMatch(/espacios/);
    expect(garminKeyError('short')).toMatch(/incompleta/);
    expect(garminKeyError('a1b2c3d4e5f6g7h8i9')).toBeNull();
  });

  test('disconnected when there is no status', () => {
    const view = garminStatusView(undefined, TODAY);
    expect(view).toMatchObject({ label: 'Sin conectar', needsKey: true, isConnected: false, tone: 'muted' });
  });

  test('connected with a far expiry is success', () => {
    const view = garminStatusView(status({ expiresAt: '2027-01-30' }), TODAY);
    expect(view).toMatchObject({ tone: 'success', isConnected: true, needsKey: false, expiresSoon: false });
    expect(view.detail).toMatch(/97 días/);
  });

  test('connected with near expiry warns', () => {
    const view = garminStatusView(status({ expiresAt: '2026-10-30' }), TODAY);
    expect(view.tone).toBe('warning');
    expect(view.expiresSoon).toBe(true);
    expect(garminStatusView(status({ expiresAt: '2026-10-26' }), TODAY).detail).toBe('La clave caduca mañana');
    expect(garminStatusView(status({ expiresAt: TODAY }), TODAY).detail).toBe('La clave caduca hoy');
  });

  test('expired and error states ask for a new key', () => {
    expect(garminStatusView(status({ state: 'expired' }), TODAY)).toMatchObject({ tone: 'danger', needsKey: true });
    const error = garminStatusView(status({ state: 'error', lastError: 'Clave inválida' }), TODAY);
    expect(error).toMatchObject({ tone: 'danger', needsKey: true, detail: 'Clave inválida' });
  });
});
