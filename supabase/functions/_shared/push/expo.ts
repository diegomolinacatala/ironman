/** Expo Push API client (send + getReceipts on https://exp.host/--/api/v2/push/…), fetch injected. */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const EXPO_CHUNK_SIZE = 100;
export const EXPO_RECEIPTS_CHUNK_SIZE = 1000;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
}

export interface ExpoError {
  status: 'error';
  message: string;
  details?: { error?: string };
}

export type ExpoTicket = { status: 'ok'; id: string } | ExpoError;

/** Delivery receipt of a ticket (`DeviceNotRegistered` here means the token is dead). */
export type ExpoReceipt = { status: 'ok' } | ExpoError;

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export class ExpoTransportError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ExpoTransportError';
    this.retryable = retryable;
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
}

export function isExpoPushToken(token: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

function parseError(v: Record<string, unknown>): ExpoError {
  const details = v.details && typeof v.details === 'object' ? (v.details as { error?: unknown }) : undefined;
  return {
    status: 'error',
    message: typeof v.message === 'string' ? v.message : 'Error de Expo',
    ...(details && typeof details.error === 'string' ? { details: { error: details.error } } : {}),
  };
}

function parseTicket(value: unknown): ExpoTicket {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.status === 'ok' && typeof v.id === 'string') return { status: 'ok', id: v.id };
    return parseError(v);
  }
  return { status: 'error', message: 'Respuesta de Expo no reconocida' };
}

async function postExpo(fetchFn: FetchFn, url: string, body: unknown, accessToken?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new ExpoTransportError(`Expo no responde: ${error instanceof Error ? error.message : String(error)}`, true);
  }
  if (!res.ok) throw new ExpoTransportError(`Expo HTTP ${res.status}`, res.status >= 500 || res.status === 429);
  const payload = (await res.json().catch(() => null)) as { data?: unknown } | null;
  return payload?.data;
}

/** Sends ≤100 messages; returns one ticket per message, in order. */
export async function sendExpoChunk(fetchFn: FetchFn, messages: readonly ExpoMessage[], accessToken?: string): Promise<ExpoTicket[]> {
  const data = await postExpo(fetchFn, EXPO_PUSH_URL, messages, accessToken);
  const list = Array.isArray(data) ? data : [];
  return messages.map((_, i) => parseTicket(list[i]));
}

/** Receipts of ≤1000 ticket ids. Ids without a receipt yet are absent from the map. */
export async function fetchExpoReceipts(fetchFn: FetchFn, ids: readonly string[], accessToken?: string): Promise<Map<string, ExpoReceipt>> {
  const data = await postExpo(fetchFn, EXPO_RECEIPTS_URL, { ids }, accessToken);
  const receipts = new Map<string, ExpoReceipt>();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return receipts;
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    receipts.set(id, v.status === 'ok' ? { status: 'ok' } : parseError(v));
  }
  return receipts;
}
