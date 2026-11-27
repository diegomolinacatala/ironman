/**
 * OAuth 2.1 + PKCE against the COROS MCP authorization server, as verified by the athlete's
 * local COROS client: protected-resource metadata on the entry URL points to a regional
 * resource (e.g. https://mcpeu.coros.com/mcp) whose authorization server supports dynamic
 * client registration (/connect/register), authorization_code + PKCE S256, refresh_token
 * and the `offline_access` scope. Tokens are bound to the resource (RFC 8707).
 *
 * No COROS developer secret is needed: each connection registers its own client, and the
 * client credentials travel with the encrypted token bundle.
 */
import { base64UrlEncode, decryptSecret, encryptSecret } from '../crypto.ts';
import type { UUID } from '../types.ts';
import { CorosApiError } from './mcp.ts';
import type { FetchLike } from './mcp.ts';

export const COROS_MCP_ENTRY_URL = 'https://mcp.coros.com/mcp';
export const COROS_SCOPES = 'openid mcp.tools offline_access';
export const STATE_TTL_MS = 15 * 60_000;
const STATE_CONTEXT = 'coros_mcp:oauth_state';

export interface CorosEndpoints {
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
}

export interface CorosClient {
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
}

/** What is stored (encrypted) per user in integration_credentials.secret_ciphertext. */
export interface CorosTokenBundle {
  endpoints: CorosEndpoints;
  client: CorosClient;
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
}

/** Carried in the OAuth `state` (encrypted): no table needed for the handshake. */
export interface CorosOAuthState {
  userId: UUID;
  verifier: string;
  endpoints: CorosEndpoints;
  client: CorosClient;
  /** Epoch ms after which the state is refused. */
  expiresAt: number;
}

async function getJson(fetchFn: FetchLike, url: string): Promise<Record<string, unknown>> {
  const res = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new CorosApiError(res.status, `COROS respondió ${res.status} al descubrir la autorización.`);
  return (await res.json()) as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function discoverEndpoints(fetchFn: FetchLike, entryUrl = COROS_MCP_ENTRY_URL): Promise<CorosEndpoints> {
  const entry = new URL(entryUrl);
  const prm = await getJson(fetchFn, `${entry.origin}/.well-known/oauth-protected-resource${entry.pathname}`);
  const servers = Array.isArray(prm.authorization_servers) ? prm.authorization_servers : [];
  const issuer = str(servers[0]);
  const resource = str(prm.resource);
  if (!issuer || !resource) throw new CorosApiError(502, 'COROS no ha publicado su servidor de autorización.');
  const as = await getJson(fetchFn, `${new URL(issuer).origin}/.well-known/oauth-authorization-server`);
  const authorizationEndpoint = str(as.authorization_endpoint);
  const tokenEndpoint = str(as.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) throw new CorosApiError(502, 'La autorización de COROS no está completa.');
  return { resource, issuer: str(as.issuer) ?? issuer, authorizationEndpoint, tokenEndpoint, registrationEndpoint: str(as.registration_endpoint) };
}

export async function registerClient(fetchFn: FetchLike, endpoints: CorosEndpoints, redirectUri: string): Promise<CorosClient> {
  if (!endpoints.registrationEndpoint) throw new CorosApiError(502, 'COROS no permite registrar la app automáticamente.');
  const res = await fetchFn(endpoints.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Road to Ironman',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      scope: COROS_SCOPES,
    }),
  });
  if (!res.ok) throw new CorosApiError(res.status, `COROS no ha aceptado registrar la app (${res.status}).`);
  const body = (await res.json()) as Record<string, unknown>;
  const clientId = str(body.client_id);
  if (!clientId) throw new CorosApiError(502, 'COROS no devolvió un identificador de cliente.');
  return { clientId, clientSecret: str(body.client_secret), redirectUri };
}

export function randomVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function encodeState(state: CorosOAuthState, secret: string): Promise<string> {
  return encryptSecret(JSON.stringify(state), secret, STATE_CONTEXT);
}

/** Null when the state is not ours, was tampered with or expired. */
export async function decodeState(value: string, secret: string, nowMs: number): Promise<CorosOAuthState | null> {
  try {
    const state = JSON.parse(await decryptSecret(value, secret, STATE_CONTEXT)) as CorosOAuthState;
    if (!state || typeof state.userId !== 'string' || typeof state.verifier !== 'string' || !state.client || !state.endpoints) return null;
    return state.expiresAt >= nowMs ? state : null;
  } catch {
    return null;
  }
}

export async function authorizeUrl(state: CorosOAuthState, encodedState: string): Promise<string> {
  const url = new URL(state.endpoints.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: state.client.clientId,
    redirect_uri: state.client.redirectUri,
    scope: COROS_SCOPES,
    state: encodedState,
    code_challenge: await pkceChallenge(state.verifier),
    code_challenge_method: 'S256',
    resource: state.endpoints.resource,
  }).toString();
  return url.toString();
}

async function postToken(fetchFn: FetchLike, endpoint: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  if (res.status === 400 || res.status === 401) throw new CorosApiError(401, 'COROS ha rechazado la autorización (caducada o revocada).');
  if (!res.ok) throw new CorosApiError(res.status, `COROS respondió ${res.status} al pedir el token.`);
  return (await res.json()) as Record<string, unknown>;
}

function bundleFrom(tokens: Record<string, unknown>, endpoints: CorosEndpoints, client: CorosClient, nowMs: number, previousRefresh: string | null): CorosTokenBundle {
  const accessToken = str(tokens.access_token);
  if (!accessToken) throw new CorosApiError(502, 'COROS no devolvió un token de acceso.');
  const expiresIn = typeof tokens.expires_in === 'number' && tokens.expires_in > 0 ? tokens.expires_in : 3600;
  return {
    endpoints,
    client,
    accessToken,
    // Rotating refresh tokens: keep the new one, else the previous one.
    refreshToken: str(tokens.refresh_token) ?? previousRefresh,
    expiresAt: nowMs + expiresIn * 1000,
  };
}

function clientAuth(client: CorosClient): Record<string, string> {
  return { client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) };
}

export async function exchangeCode(fetchFn: FetchLike, state: CorosOAuthState, code: string, nowMs: number): Promise<CorosTokenBundle> {
  const tokens = await postToken(fetchFn, state.endpoints.tokenEndpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: state.client.redirectUri,
    code_verifier: state.verifier,
    resource: state.endpoints.resource,
    ...clientAuth(state.client),
  });
  return bundleFrom(tokens, state.endpoints, state.client, nowMs, null);
}

/** Returns the same bundle while the access token has more than a minute left, else a refreshed one. */
export async function freshBundle(fetchFn: FetchLike, bundle: CorosTokenBundle, nowMs: number): Promise<{ bundle: CorosTokenBundle; refreshed: boolean }> {
  if (bundle.expiresAt - nowMs > 60_000) return { bundle, refreshed: false };
  if (!bundle.refreshToken) throw new CorosApiError(401, 'La autorización de COROS caducó y no se puede renovar.');
  const tokens = await postToken(fetchFn, bundle.endpoints.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: bundle.refreshToken,
    resource: bundle.endpoints.resource,
    ...clientAuth(bundle.client),
  });
  return { bundle: bundleFrom(tokens, bundle.endpoints, bundle.client, nowMs, bundle.refreshToken), refreshed: true };
}

export const bundleContext = (userId: UUID): string => `coros_mcp:${userId}`;

export function encryptBundle(bundle: CorosTokenBundle, secret: string, userId: UUID): Promise<string> {
  return encryptSecret(JSON.stringify(bundle), secret, bundleContext(userId));
}

export async function decryptBundle(ciphertext: string, secret: string, userId: UUID): Promise<CorosTokenBundle> {
  return JSON.parse(await decryptSecret(ciphertext, secret, bundleContext(userId))) as CorosTokenBundle;
}
