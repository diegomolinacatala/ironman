import type { DateRange, ISODate, UUID } from '@/domain/types';

import { RepositoryError } from '../../repository';
import type { DemoStore } from '../store';

export interface DemoDeps {
  store: DemoStore;
  /** Delay before simulated friends react (accept quedadas / requests). */
  friendDelayMs: number;
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
