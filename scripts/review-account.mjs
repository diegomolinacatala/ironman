#!/usr/bin/env node
/**
 * Creates (or resets) the App Store review account and prints its 6-digit code.
 *
 * The app never emails a code to APP_REVIEW_EMAIL: the 6 digits typed on the code screen are this
 * account's password (src/data/supabase/auth.ts). Paste email + code in App Store Connect →
 * App Review Information. Run again to rotate the code.
 *
 *   SUPABASE_URL=https://XXXX.supabase.co SUPABASE_SECRET_KEY=sb_secret_… node scripts/review-account.mjs
 *
 * The secret key is in Supabase → Project Settings → API Keys. It is only read from the
 * environment and never written anywhere.
 */
import { randomInt } from 'node:crypto';

const APP_REVIEW_EMAIL = 'revision@roadtoironman.app';
const PAGE_SIZE = 1000;

function config() {
  const url = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY ?? '';
  if (!/^https:\/\/.+/.test(url) || !key) {
    console.error('Faltan SUPABASE_URL (https://XXXX.supabase.co) y SUPABASE_SECRET_KEY (sb_secret_…).');
    process.exit(1);
  }
  return { url, key };
}

async function admin({ url, key }, method, path, body) {
  const res = await fetch(`${url}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data };
}

async function findUserId(cfg) {
  for (let page = 1; ; page += 1) {
    const res = await admin(cfg, 'GET', `/users?page=${page}&per_page=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`No se pudo listar usuarios (${res.status}): ${JSON.stringify(res.data)}`);
    const users = res.data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === APP_REVIEW_EMAIL);
    if (found) return found.id;
    if (users.length < PAGE_SIZE) return null;
  }
}

async function main() {
  const cfg = config();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const attrs = { password: code, email_confirm: true, user_metadata: { full_name: 'Revisión App Store' } };

  const existing = await findUserId(cfg);
  const res = existing
    ? await admin(cfg, 'PUT', `/users/${existing}`, attrs)
    : await admin(cfg, 'POST', '/users', { email: APP_REVIEW_EMAIL, ...attrs });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${JSON.stringify(res.data)}`);

  console.log(existing ? 'Cuenta de revisión actualizada.' : 'Cuenta de revisión creada.');
  console.log(`  Email:  ${APP_REVIEW_EMAIL}`);
  console.log(`  Código: ${code}`);
  console.log('Pégalos en App Store Connect → Información para la revisión (y en TestFlight → Información de prueba).');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
