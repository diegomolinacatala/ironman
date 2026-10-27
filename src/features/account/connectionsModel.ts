/**
 * Tú › Conexiones: one calm line per connection with its live status and the
 * one-tap fix (pure view models).
 */
import type { ISODate, IntegrationStatus, PersonalToken, Race } from '@/domain/types';

import { alarmLabel } from '../onboarding/calendarModel';
import { latestUsedClaudeToken } from '../onboarding/connectModel';
import { nextRace } from '../onboarding/goalModel';
import { daysUntil, formatRelativeTime } from '../settings/format';
import { garminStatusView, type StatusTone } from '../settings/garminModel';

export type ConnectionAction = { kind: 'sync' | 'open'; label: string } | null;

export interface ConnectionView {
  tone: StatusTone;
  status: string;
  detail: string | null;
  action: ConnectionAction;
}

const OPEN = (label: string): ConnectionAction => ({ kind: 'open', label });

function syncedLine(lastSyncAt: string | null, now: Date): string {
  return lastSyncAt ? `Sincronizado ${formatRelativeTime(lastSyncAt, now)}` : 'Aún sin sincronizar';
}

export function garminConnectionView(status: IntegrationStatus | undefined, today: ISODate, now: Date = new Date()): ConnectionView {
  const view = garminStatusView(status, today);
  switch (status?.state) {
    case 'connected':
      return view.expiresSoon
        ? { tone: 'warning', status: 'Caduca pronto', detail: view.detail, action: OPEN('Renovar') }
        : { tone: 'success', status: 'Conectado', detail: syncedLine(status.lastSyncAt, now), action: { kind: 'sync', label: 'Sincronizar' } };
    case 'expired':
      return { tone: 'danger', status: 'Clave caducada', detail: 'Crea una nueva: es un minuto.', action: OPEN('Renovar') };
    case 'error':
      return { tone: 'danger', status: 'Con errores', detail: status.lastError ?? 'Garmin rechazó la última sincronización.', action: OPEN('Arreglar') };
    default:
      return { tone: 'muted', status: 'Sin conectar', detail: 'Tu sueño, tu VFC y tus entrenos, solos.', action: OPEN('Conectar') };
  }
}

export function claudeConnectionView(tokens: readonly PersonalToken[] | undefined, now: Date = new Date()): ConnectionView {
  const used = latestUsedClaudeToken(tokens ?? []);
  if (used?.lastUsedAt) {
    return { tone: 'success', status: 'Conectado', detail: `Último uso ${formatRelativeTime(used.lastUsedAt, now)}`, action: null };
  }
  return { tone: 'muted', status: 'Sin conectar', detail: 'Habla con Claude de tu plan y lo cambia por ti.', action: OPEN('Conectar') };
}

export interface TrainingCalendarLike {
  available: boolean;
  enabled: boolean;
  permission: 'granted' | 'denied' | 'undetermined';
  alarmMinutes: number;
}

export function calendarConnectionView(calendar: TrainingCalendarLike): ConnectionView {
  if (!calendar.available) return { tone: 'muted', status: 'Solo en iPhone', detail: 'Tus entrenos en el calendario del iPhone.', action: null };
  if (calendar.enabled) {
    return { tone: 'success', status: 'Activado', detail: `Tus entrenos en tu calendario · ${alarmLabel(calendar.alarmMinutes)}`, action: null };
  }
  if (calendar.permission === 'denied') {
    return { tone: 'warning', status: 'Sin permiso', detail: 'Dale acceso en Ajustes del iPhone.', action: OPEN('Arreglar') };
  }
  return { tone: 'muted', status: 'Desactivado', detail: 'Apunta tus entrenos con aviso antes de cada uno.', action: OPEN('Activar') };
}

export interface RaceCountdown {
  days: number;
  /** "128 días" / "1 día" / "Hoy". */
  value: string;
  name: string;
}

/** Countdown to the next race (A first, then the earliest), or null. */
export function raceCountdown(races: readonly Race[] | undefined, today: ISODate): RaceCountdown | null {
  const next = nextRace(races ?? [], today);
  if (!next) return null;
  const days = daysUntil(next.date, today);
  const value = days === 0 ? 'Hoy' : days === 1 ? '1 día' : `${days} días`;
  return { days, value, name: next.name };
}
