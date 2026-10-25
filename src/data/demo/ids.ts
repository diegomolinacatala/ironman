/**
 * Ids and small time helpers for the demo backend (not security-sensitive).
 */
import type { ISODate, ISODateTime, ISOTime, UUID } from '@/domain/types';

/** Fixed ids of the seeded demo athletes. */
export const DEMO_USERS = {
  diego: '0d1e6000-0000-4000-8000-000000000001',
  alex: '0a1e7000-0000-4000-8000-000000000002',
  lucia: '01c1a000-0000-4000-8000-000000000003',
  marcos: '0a4c0000-0000-4000-8000-000000000004',
} as const;

function hex(n: number): string {
  return Math.floor(n).toString(16).padStart(1, '0');
}

/** RFC 4122 v4-shaped id; uses crypto.randomUUID when the runtime has it. */
export function newId(): UUID {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoLike && typeof cryptoLike.randomUUID === 'function') return cryptoLike.randomUUID();
  const chars = Array.from({ length: 32 }, () => hex(Math.random() * 16));
  const variant = hex(8 + Math.random() * 4);
  const s = chars.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${variant}${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/** Deterministic PRNG (mulberry32) so the seed looks random but is stable. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local wall-clock date + time → absolute ISO timestamp (device timezone). */
export function localIso(date: ISODate, time: ISOTime): ISODateTime {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0).toISOString();
}
