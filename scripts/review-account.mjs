#!/usr/bin/env node
/**
 * Creates (or resets) the App Store review account, prints its 6-digit code and stores it as the
 * GitHub secret ASC_REVIEW_CODE (read by .github/workflows/app-store.yml).
 *
 * The app never emails a code to APP_REVIEW_EMAIL: the 6 digits typed on the code screen are this
 * account's password (src/data/supabase/auth.ts). Run again to rotate the code (and re-run the
 * App Store workflow so App Review gets the new one).
 *
 *   node scripts/review-account.mjs
 *
 * Uses the linked project (supabase/.temp/project-ref) and takes the secret key from the logged-in
 * Supabase CLI; SUPABASE_URL / SUPABASE_SECRET_KEY override both. The key is never written anywhere.
 */
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const APP_REVIEW_EMAIL = 'revision@roadtoironman.app';
// Must match APP_REVIEW_PASSWORD_PREFIX in src/data/supabase/auth.ts (Supabase wants ≥ 8 characters).
const APP_REVIEW_PASSWORD_PREFIX = 'rti-review-';
const PAGE_SIZE = 1000;

/** Runs a fixed command line (all arguments are ours: no user input reaches the shell). */
function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function linkedRef() {
  const file = new URL('../supabase/.temp/project-ref', import.meta.url);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

/** sb_secret_… of the linked project, through the logged-in Supabase CLI. */
function secretKeyFromCli() {
  const out = run('npx --yes supabase@latest projects api-keys --reveal --output-format json');
  const match = out.match(/sb_secret_[A-Za-z0-9_-]+/);
  return match ? match[0] : '';
}

function config() {
  const ref = linkedRef();
  const fallbackUrl = ref ? `https://${ref}.supabase.co` : '';
  const url = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? fallbackUrl).replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY ?? secretKeyFromCli();
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
  const attrs = { password: `${APP_REVIEW_PASSWORD_PREFIX}${code}`, email_confirm: true, user_metadata: { full_name: 'Revisión App Store' } };

  const existing = await findUserId(cfg);
  const res = existing
    ? await admin(cfg, 'PUT', `/users/${existing}`, attrs)
    : await admin(cfg, 'POST', '/users', { email: APP_REVIEW_EMAIL, ...attrs });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${JSON.stringify(res.data)}`);

  console.log(existing ? 'Cuenta de revisión actualizada.' : 'Cuenta de revisión creada.');
  console.log(`  Email:  ${APP_REVIEW_EMAIL}`);
  console.log(`  Código: ${code}`);
  try {
    run(`gh secret set ASC_REVIEW_CODE --body ${code}`);
    console.log('Guardado en el secreto ASC_REVIEW_CODE de GitHub (lo usa el workflow App Store).');
  } catch {
    console.log('No he podido guardar el secreto: ejecuta  gh secret set ASC_REVIEW_CODE  y pega el código.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
