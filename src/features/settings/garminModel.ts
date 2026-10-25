/**
 * Garmin Personal API connection: view-model helpers (pure).
 * The key is created by the user at Garmin Connect and lasts 30 days – 1 year.
 */
import type { ISODate, IntegrationStatus } from '@/domain/types';

import { addDaysISO, daysUntil, formatDateShort } from './format';

export const GARMIN_KEY_URL = 'https://connect.garmin.com/app/settings/personalApiToken';

export interface ExpiryOption {
  days: number;
  label: string;
}

export const GARMIN_EXPIRY_OPTIONS: readonly ExpiryOption[] = [
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 180, label: '180 días' },
  { days: 365, label: '1 año' },
];

/** Warn the user this many days before the key expires. */
export const EXPIRY_WARNING_DAYS = 10;

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted';

export interface GarminStatusView {
  tone: StatusTone;
  label: string;
  detail: string | null;
  /** Show the "paste your key" form. */
  needsKey: boolean;
  /** Connected (sync + disconnect available). */
  isConnected: boolean;
  expiresSoon: boolean;
}

export function expiryDateFor(days: number, today: ISODate): ISODate {
  return addDaysISO(today, days);
}

/** Minimal client-side check; the server validates the key against Garmin. */
export function garminKeyError(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return 'Pega la clave que te dio Garmin';
  if (/\s/.test(trimmed)) return 'La clave no puede tener espacios';
  if (trimmed.length < 16) return 'La clave parece incompleta';
  return null;
}

function expiryDetail(expiresAt: ISODate | null, today: ISODate): { text: string | null; soon: boolean } {
  if (!expiresAt) return { text: null, soon: false };
  const left = daysUntil(expiresAt, today);
  if (left < 0) return { text: `La clave caducó el ${formatDateShort(expiresAt)}`, soon: true };
  if (left === 0) return { text: 'La clave caduca hoy', soon: true };
  const text = left === 1 ? 'La clave caduca mañana' : `La clave caduca en ${left} días (${formatDateShort(expiresAt)})`;
  return { text, soon: left <= EXPIRY_WARNING_DAYS };
}

export function garminStatusView(status: IntegrationStatus | undefined, today: ISODate): GarminStatusView {
  const state = status?.state ?? 'disconnected';
  const expiry = expiryDetail(status?.expiresAt ?? null, today);
  switch (state) {
    case 'connected':
      return {
        tone: expiry.soon ? 'warning' : 'success',
        label: 'Conectado',
        detail: expiry.text,
        needsKey: false,
        isConnected: true,
        expiresSoon: expiry.soon,
      };
    case 'expired':
      return {
        tone: 'danger',
        label: 'Clave caducada',
        detail: 'Crea una clave nueva en Garmin Connect y pégala aquí.',
        needsKey: true,
        isConnected: true,
        expiresSoon: true,
      };
    case 'error':
      return {
        tone: 'danger',
        label: 'Error de conexión',
        detail: status?.lastError ?? 'Garmin rechazó la última sincronización.',
        needsKey: true,
        isConnected: true,
        expiresSoon: expiry.soon,
      };
    default:
      return { tone: 'muted', label: 'Sin conectar', detail: null, needsKey: true, isConnected: false, expiresSoon: false };
  }
}
