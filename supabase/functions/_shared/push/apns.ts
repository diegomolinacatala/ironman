/**
 * Apple Push Notification service (APNs) provider API, token-based auth:
 * `POST https://<host>/3/device/<token>` (HTTP/2; Deno's fetch negotiates it
 * with ALPN) with `authorization: bearer <provider JWT>`. The provider JWT is
 * ES256 ({alg, kid} + {iss: team id, iat}) signed with the .p8 APNs key and
 * cached for PROVIDER_TOKEN_TTL_MS: Apple rejects tokens older than one hour
 * and throttles refreshes more frequent than every 20 minutes. Pure module:
 * fetch and the clock are injected, no Deno globals.
 */
import { es256Header, importP8PrivateKey, signEs256Jwt } from '../apple/jwt.ts';
import type { EnvReader } from '../secrets.ts';

export const APNS_PRODUCTION_HOST = 'api.push.apple.com';
export const APNS_SANDBOX_HOST = 'api.sandbox.push.apple.com';
export const DEFAULT_APNS_TOPIC = 'io.github.diegomolinacatala.ironman';
export const PROVIDER_TOKEN_TTL_MS = 40 * 60_000;
export const APNS_TIMEOUT_MS = 10_000;
/** Keeps the payload far below the 4 KB APNs limit. */
const ALERT_TITLE_MAX = 120;
const ALERT_BODY_MAX = 600;
/** 400 reasons that mean the token itself is unusable (as 410 does). */
const DEAD_TOKEN_REASONS: ReadonlySet<string> = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered']);

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** PKCS#8 PEM of the .p8 key (real or escaped `\n`). */
  privateKey: string;
  /** Bundle id of the app (`apns-topic`). */
  topic: string;
  /** api.push.apple.com (production) or api.sandbox.push.apple.com (development builds). */
  host: string;
}

export type ApnsEnv = { ok: true; config: ApnsConfig } | { ok: false; missing: string[] };

/** `api.sandbox.push.apple.com`, `https://api.sandbox.push.apple.com/` or `host:port` → bare host; null when invalid. */
export function normalizeApnsHost(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().replace(/^https:\/\//i, '').replace(/\/+$/, '');
  if (!value) return APNS_PRODUCTION_HOST;
  return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(value) ? value.toLowerCase() : null;
}

/** Reads APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (required), APNS_TOPIC and APNS_HOST (optional). */
export function readApnsEnv(env: EnvReader): ApnsEnv {
  const keyId = env('APNS_KEY_ID')?.trim() ?? '';
  const teamId = env('APNS_TEAM_ID')?.trim() ?? '';
  const privateKey = env('APNS_PRIVATE_KEY')?.trim() ?? '';
  const topic = env('APNS_TOPIC')?.trim() || DEFAULT_APNS_TOPIC;
  const host = normalizeApnsHost(env('APNS_HOST'));
  const missing = [
    ...(keyId ? [] : ['APNS_KEY_ID']),
    ...(teamId ? [] : ['APNS_TEAM_ID']),
    ...(privateKey ? [] : ['APNS_PRIVATE_KEY']),
    ...(host ? [] : ['APNS_HOST']),
  ];
  if (missing.length > 0 || !host) return { ok: false, missing };
  return { ok: true, config: { keyId, teamId, privateKey, topic, host } };
}

/** Raw APNs device token from `getDevicePushTokenAsync()`: hex, 32 bytes today (Apple allows longer). */
export function isApnsDeviceToken(token: string): boolean {
  return /^[0-9a-f]{64,200}$/i.test(token) && token.length % 2 === 0;
}

export interface ProviderTokenClaims {
  iss: string;
  iat: number;
}

export function providerTokenClaims(teamId: string, nowSec: number): ProviderTokenClaims {
  return { iss: teamId, iat: Math.floor(nowSec) };
}

export interface ProviderTokenSource {
  /** The cached provider JWT, signed again once it is PROVIDER_TOKEN_TTL_MS old. Rejects when the key is unusable. */
  get(): Promise<string>;
  /** Drops `token` if it is still the cached one (APNs answered 403). */
  invalidate(token: string): void;
}

interface CachedToken {
  issuedAtMs: number;
  promise: Promise<string>;
  value: string | null;
}

/** One per isolate: concurrent sends share the same JWT (and the same in-flight signature). */
export function createProviderTokenSource(
  config: Pick<ApnsConfig, 'keyId' | 'teamId' | 'privateKey'>,
  now: () => Date,
  ttlMs = PROVIDER_TOKEN_TTL_MS,
): ProviderTokenSource {
  let key: Promise<CryptoKey> | null = null;
  let cached: CachedToken | null = null;
  const sign = async (nowMs: number): Promise<string> => {
    key ??= importP8PrivateKey(config.privateKey);
    return signEs256Jwt(await key, es256Header(config.keyId), { ...providerTokenClaims(config.teamId, nowMs / 1000) });
  };
  return {
    get() {
      const nowMs = now().getTime();
      const age = cached ? nowMs - cached.issuedAtMs : Infinity;
      if (cached && age >= 0 && age < ttlMs) return cached.promise;
      const entry: CachedToken = { issuedAtMs: nowMs, promise: sign(nowMs), value: null };
      entry.promise.then(
        (value) => {
          entry.value = value;
        },
        () => {
          // Unusable key: forget it so a fixed secret is picked up by the next call.
          if (cached === entry) cached = null;
          key = null;
        },
      );
      cached = entry;
      return entry.promise;
    },
    invalidate(token) {
      if (cached && cached.value === token) cached = null;
    },
  };
}

export interface ApnsMessage {
  /** Hex device token. */
  deviceToken: string;
  title: string;
  body: string;
  /** Groups the notifications in Notification Center (`aps.thread-id`). */
  threadId: string;
  /** `apns-collapse-id` (≤ 64 bytes): a resend replaces the notification instead of duplicating it. */
  collapseId?: string;
  /** Custom keys (deep-link `url`, ids) sent next to `aps`. */
  data: Record<string, unknown>;
}

const truncate = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/**
 * `{ aps, ...data, body: data }`. The custom keys also go under `body`
 * because expo-notifications exposes `userInfo.body` as
 * `request.content.data` for remote notifications on iOS.
 */
export function apnsPayload(message: ApnsMessage): Record<string, unknown> {
  const data = { ...message.data };
  return {
    ...data,
    body: data,
    aps: {
      alert: { title: truncate(message.title, ALERT_TITLE_MAX), body: truncate(message.body, ALERT_BODY_MAX) },
      sound: 'default',
      'thread-id': message.threadId,
    },
  };
}

export function apnsUrl(host: string, deviceToken: string): string {
  return `https://${host}/3/device/${encodeURIComponent(deviceToken)}`;
}

export function apnsHeaders(topic: string, providerToken: string, collapseId?: string): Record<string, string> {
  return {
    authorization: `bearer ${providerToken}`,
    'apns-topic': topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type': 'application/json',
    ...(collapseId ? { 'apns-collapse-id': collapseId.slice(0, 64) } : {}),
  };
}

export type ApnsFailureKind = 'unregistered' | 'auth' | 'retry' | 'rejected';

/**
 * - `unregistered`: 410, or 400 BadDeviceToken / DeviceTokenNotForTopic / Unregistered → delete the token.
 * - `auth`: 403 (InvalidProviderToken, ExpiredProviderToken…) or an unusable key (status 0).
 * - `retry`: 429, 5xx, network errors and timeouts (status 0) → try again in the next sweep.
 * - `rejected`: any other 4xx (BadTopic, PayloadTooLarge…) → permanent for this message.
 */
export type ApnsResult = { kind: 'sent' } | { kind: ApnsFailureKind; status: number; reason: string };

export type ApnsFailure = Extract<ApnsResult, { kind: ApnsFailureKind }>;

export function classifyApnsResponse(status: number, reason: string): ApnsResult {
  if (status === 200) return { kind: 'sent' };
  if (status === 410 || (status === 400 && DEAD_TOKEN_REASONS.has(reason))) return { kind: 'unregistered', status, reason };
  if (status === 403) return { kind: 'auth', status, reason };
  if (status === 429 || status >= 500) return { kind: 'retry', status, reason };
  return { kind: 'rejected', status, reason };
}

/** Short text for `notifications.push_error`, e.g. `APNs 410 Unregistered`. */
export function apnsErrorText(failure: ApnsFailure): string {
  return ['APNs', failure.status ? String(failure.status) : '', failure.reason].filter(Boolean).join(' ').slice(0, 300);
}

async function readReason(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as unknown;
    const reason = parsed && typeof parsed === 'object' ? (parsed as { reason?: unknown }).reason : undefined;
    return typeof reason === 'string' ? reason.slice(0, 100) : '';
  } catch {
    return '';
  }
}

const isTimeout = (error: unknown): boolean => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

export interface ApnsSender {
  /** Never throws: every failure is classified. */
  send(message: ApnsMessage): Promise<ApnsResult>;
}

export interface ApnsSenderDeps {
  config: ApnsConfig;
  fetch: FetchFn;
  now: () => Date;
  /** Provider-token cache; created from `config` when omitted. */
  tokens?: ProviderTokenSource;
  timeoutMs?: number;
}

export function createApnsSender(deps: ApnsSenderDeps): ApnsSender {
  const tokens = deps.tokens ?? createProviderTokenSource(deps.config, deps.now);
  const timeoutMs = deps.timeoutMs ?? APNS_TIMEOUT_MS;
  return {
    async send(message) {
      let providerToken: string;
      try {
        providerToken = await tokens.get();
      } catch {
        return { kind: 'auth', status: 0, reason: 'InvalidPrivateKey' };
      }
      let res: Response;
      try {
        res = await deps.fetch(apnsUrl(deps.config.host, message.deviceToken), {
          method: 'POST',
          headers: apnsHeaders(deps.config.topic, providerToken, message.collapseId),
          body: JSON.stringify(apnsPayload(message)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return { kind: 'retry', status: 0, reason: isTimeout(error) ? 'Timeout' : 'NetworkError' };
      }
      const result = classifyApnsResponse(res.status, await readReason(res));
      if (result.kind === 'auth') tokens.invalidate(providerToken);
      return result;
    },
  };
}
