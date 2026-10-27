import type { DateRange, ISODate, UUID } from '@/domain/types';

import { RepositoryError } from '../../repository';
import type { DemoStore } from '../store';

/** Simulated latencies of the demo backend (0 in tests). */
export interface DemoDelays {
  /** Briefing generation and meal analysis ("Claude is thinking"). */
  aiMs: number;
  /** Garmin key validation + first sync. */
  garminMs: number;
  /** Time until claude.ai "uses" a new MCP token (onboarding live verification). */
  connectorMs: number;
}

export const DEFAULT_DEMO_DELAYS: DemoDelays = { aiMs: 1500, garminMs: 1200, connectorMs: 6000 };

export interface DemoDeps {
  store: DemoStore;
  /** Delay before simulated friends react (accept quedadas / requests). */
  friendDelayMs: number;
  delays: DemoDelays;
}

export function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function requireMe(store: DemoStore): Promise<UUID> {
  const session = await store.getSession();
  if (!session) throw new RepositoryError('not_authenticated', 'Inicia sesión para continuar.');
  return session.userId;
}

export function inRange(date: ISODate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

export function byDateThenTime<T extends { date: ISODate; startTime: string | null }>(a: T, b: T): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');
}

export function notFound(message: string): RepositoryError {
  return new RepositoryError('not_found', message);
}
