# Edge Functions de Rebufo

Funciones de Supabase (Deno 2) que dan servicio a la app. Toda la lógica vive en módulos puros de
`_shared/**` (sin globals de Deno, probados con `node --test`); cada `index.ts` solo lee el entorno,
crea el cliente de Supabase y conecta las piezas.

| Función | URL (`https://<ref>.supabase.co/functions/v1/…`) | Autenticación | `verify_jwt` |
|---|---|---|---|
| `coach` | `POST /coach` con un `CoachRequest` | JWT del usuario | `true` |
| `mcp` | `POST /mcp/u/<secreto>` (conector "Conecta tu Claude") | secreto personal en la ruta (scope `mcp`) | `false` |
| `ics` | `GET /ics/<secreto>.ics` (suscripción `webcal://`) | secreto personal en la ruta (scope `ics`) | `false` |
| `push-dispatch` | `POST /push-dispatch` (trigger `pg_net` + barrido `pg_cron`) | clave secreta del servidor en `apikey` | `false` |
| `garmin` | `POST /garmin` con `{ action }` | JWT del usuario (`connect`, `disconnect`, `sync`) · clave secreta en `apikey` (`sync_all`) | `false` (el JWT se verifica en el código) |
| `apple-revoke` | `POST /apple-revoke` con `{ authorizationCode }` | JWT del usuario | `false` (el JWT se verifica en el código) |

`supabase/config.toml` (lo mantiene el agente de base de datos):

```toml
[functions.coach]
verify_jwt = true

[functions.mcp]
verify_jwt = false

[functions.ics]
verify_jwt = false

[functions.push-dispatch]
verify_jwt = false

[functions.garmin]
verify_jwt = false

[functions.apple-revoke]
verify_jwt = false
```

## Secretos

Los inyecta Supabase automáticamente: `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` (o el heredado
`SUPABASE_SERVICE_ROLE_KEY`). Hay que añadir:

| Secreto | Obligatorio | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | No (sin él `coach` responde `503 {error:'ai_unavailable'}` y la app usa el motor de reglas) | Coach con IA (Claude `claude-opus-5-5`). |
| `GARMIN_KEY_SECRET` | Sí para Garmin (≥ 16 caracteres; mejor 48 bytes aleatorios) | Cifrar con AES-GCM-256 (clave derivada con HKDF-SHA-256) la Personal API Key de cada usuario. **No lo cambies**: las claves guardadas dejarían de descifrarse y habría que reconectar Garmin. |
| `EXPO_ACCESS_TOKEN` | No | Solo si activas "Enhanced Security for Push" en Expo. |
| `GARMIN_PERSONAL_API_BASE_URL` | No | Sustituir `https://personal.connectapi.garmin.com` (pruebas). |
| `APPLE_TEAM_ID` | Sí para revocar Apple al borrar la cuenta (sin los cuatro `APPLE_*`, `apple-revoke` responde `503 apple_not_configured` y la app borra la cuenta igualmente) | Team ID de Apple Developer (10 caracteres). |
| `APPLE_KEY_ID` | Igual que arriba | Key ID de la clave de Sign in with Apple (*Certificates, IDs & Profiles › Keys*, con "Sign in with Apple" activado para el App ID). |
| `APPLE_PRIVATE_KEY` | Igual que arriba | Contenido del `.p8` (PEM `-----BEGIN PRIVATE KEY-----…`). Se aceptan saltos de línea reales o escritos como `\n`. |
| `APPLE_CLIENT_ID` | Igual que arriba | Bundle id de la app de producción (p. ej. `com.diegomolinacatala.rebufo`). Si pones una lista separada por comas se usa la primera. |

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase secrets set GARMIN_KEY_SECRET="$(openssl rand -base64 48)"
npx supabase secrets set EXPO_ACCESS_TOKEN=...        # opcional
npx supabase secrets set APPLE_TEAM_ID=ABCDE12345 APPLE_KEY_ID=XYZ987WVU1 APPLE_CLIENT_ID=com.diegomolinacatala.rebufo
npx supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_XYZ987WVU1.p8)"
npx supabase secrets list
```

## Despliegue (desde Windows, sin Docker)

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push                       # migraciones (RPC svc_* que usan estas funciones)
npx supabase functions deploy --use-api    # todas las funciones
npx supabase functions deploy mcp --use-api   # o una concreta
```

Cada función tiene su `deno.json` (`nodeModulesDir: "none"`) para que Deno no use el
`package.json`/`node_modules` de la app. Las dependencias van con versión fija en el propio import
(`npm:@supabase/supabase-js@2.118.0`, `npm:@anthropic-ai/sdk@1.3.0`).

## Contratos con la app

Errores: siempre JSON `{ "error": "<código>", "message": "<texto en español>" }`.

- **coach** — `POST` `CoachRequest` → `202 { jobId }`. El resultado se escribe en `coach_jobs`
  (`status` `done` con `reply`, `proposal_id`, `engine: 'ai'`, o `error` con mensaje). Errores: `401`,
  `400`, `403 consent_required` (el usuario no ha aceptado enviar sus datos a Anthropic:
  `profiles.ai_consent_at` es null), `429` (30 trabajos/24 h, reservados de forma atómica con
  `svc_reserve_coach_job`), `503 ai_unavailable`. Ninguno de estos errores crea un trabajo.
  Cada trabajo tiene un límite total de 110 s (`COACH_DEADLINE_MS`, muy por debajo de los 150 s del
  runtime): al superarlo se aborta el stream de Claude y el trabajo queda en `error`, así que la app
  debe dejar de sondear algo después (≈ 130 s) y usar el motor de reglas. `finishJob`/`failJob` solo
  actualizan trabajos aún `running`. El uso (`ai_usage`) suma todos los intentos de
  `usage.iterations` (incluido el intento rechazado antes de un fallback del servidor).
  El contexto que se envía a Claude nunca incluye los títulos de las ocupaciones del calendario
  (solo inicio y fin). Las propuestas se guardan en `plan_proposals` con `source: 'ai_coach'` y
  `changes` en camelCase (`PlanChange` de `src/domain/types.ts`), ya validadas contra la semana real.
- **apple-revoke** — `POST { authorizationCode }` (un código nuevo de `AppleAuthentication.signInAsync`)
  con el JWT del usuario → `200 { revoked: boolean }`. Firma un `client_secret` ES256 (5 min) con la
  clave `.p8`, canjea el código en `https://appleid.apple.com/auth/token` y revoca el refresh token en
  `/auth/revoke`. `revoked: false` si Apple lo rechaza (la app borra la cuenta igualmente); `401`,
  `400`, `429` (5/min por usuario), `503 apple_not_configured`. Nunca registra códigos ni tokens.
- **garmin**
  - `{ action: 'connect', apiKey, expiresAt? }` → `IntegrationStatus` + `sync` (`SyncResult` o `null`).
    `400 invalid_key` si Garmin rechaza la clave, `502 garmin_unavailable` si no responde.
  - `{ action: 'sync' }` → `SyncResult`. `404 not_connected`, `409 garmin_expired` (clave caducada o
    revocada; estado `expired`), `502 garmin_unavailable`.
  - `{ action: 'disconnect' }` → `{ provider, state: 'disconnected', …, ok: true }` (borra la clave).
  - `{ action: 'sync_all' }` (solo con `apikey` secreta, para `pg_cron`) → resumen `{ users, ok, expired, failed, skipped }`.
- **ics** — `text/calendar` con `VTIMEZONE` Europe/Madrid, entrenos de −14 a +56 días (los saltados no
  salen) y quedadas confirmadas sin entreno enlazado. UID estable por entreno (`workout-<id>@rebufo.app`).
- **push-dispatch** — reclama las notificaciones sin enviar de las últimas 24 h (`pushed_at`), envía a
  Expo en lotes de 100, respeta `notification_prefs.social` (tipos `friend_request`, `friend_accepted`,
  `friend_completed`, `kudos`), guarda `push_error` y borra tokens `DeviceNotRegistered`. Ante fallos
  temporales de Expo devuelve las notificaciones a la cola para el siguiente barrido. Recibos (sin
  tablas nuevas, en la memoria del isolate): tras responder consulta `getReceipts` de los tickets
  enviados (y de los pendientes de llamadas anteriores) y borra los tokens con `DeviceNotRegistered`;
  los demás errores van a `push_error`. En el barrido de `pg_cron` (`{"action":"sweep"}`) borra
  además los tokens que no se han visto en 90 días (`last_seen_at`).

## "Conecta tu Claude" (MCP)

1. En la app: *Yo › Conecta tu Claude* genera la URL `…/functions/v1/mcp/u/rb_<64 hex>` (se muestra una vez).
2. En claude.ai (web o escritorio): *Customize › Connectors › Add custom connector*, pega la URL y elige
   **sin inicio de sesión**. Una vez añadido, también está disponible en la app de Claude del iPhone.
3. Para revocar: borra el token en la app y genera otro (actualiza la URL del conector).

Servidor MCP propio, sin estado y "dual-era": acepta `initialize` (2025-03-26, 2025-06-18,
2025-11-25) y peticiones 2026-07-28 con `_meta` + cabeceras `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name`
(`server/discover`, `resultType`, `ttlMs`, `cacheScope`). Notificaciones → `202`; `GET`/`DELETE` → `405`.
Valida `Origin` (permite ausente, claude.ai y claude.com) y nunca registra la ruta. Límite de peticiones
(igual en `ics`): por token; los tokens desconocidos o revocados se recuerdan 60 s sin consultar la base
de datos, cada IP tiene un cupo de tokens fallidos, y el tope global del isolate solo cuenta peticiones
con un token válido (el tráfico sin autenticar no puede dejar sin servicio a los usuarios reales).
`get_planning_context` devuelve las ocupaciones del calendario solo como franjas (sin títulos).

Herramientas: `get_planning_context`, `get_friends_availability`, `propose_plan_changes`,
`log_life_event`, `log_daily_metrics`, `log_completed_activity`, `get_plan_for_device`, `manage_race`.
Los cambios del plan se guardan como propuesta (`plan_proposals.source = 'claude'`) que el usuario
acepta en la app; `apply_now: true` los aplica con `svc_apply_plan_changes`.

Probar en remoto:

```bash
npx @modelcontextprotocol/inspector --cli "https://<ref>.supabase.co/functions/v1/mcp/u/<secreto>" --transport http --method tools/list
curl -s -X POST "https://<ref>.supabase.co/functions/v1/mcp/u/<secreto>" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

## Garmin Personal API

Cada usuario crea su clave en `connect.garmin.com/app/settings/personalApiToken` (30 días a 1 año) y la
pega en *Ajustes › Integraciones*. La función la valida canjeándola por un JWT
(`POST /personalapitoken-service/personal-api/personal-api-key/token`, `Authorization: ApiKey …`),
la guarda cifrada en `integration_credentials` y sincroniza los últimos 14 días: resúmenes diarios,
sueño, VFC, Body Battery y actividades → `daily_metrics (source 'garmin', raw.source 'Garmin')` y
entrenos (completa el planificado que encaja o crea uno completado con `external_id 'garmin:<id>'`;
pádel, tenis o fútbol entran como `other`). Si la actividad ya está como entreno completado desde otra
fuente (Garmin Connect → Apple Salud → app: mismo día, deporte compatible, duración ±max(10 min, 15 %)
e inicio ±45 min) se omite para no contarla dos veces; `log_completed_activity` (puente de Claude)
aplica la misma regla y responde `already_logged`. Un `401` marca la integración como `expired`.

## Pruebas y comprobación de tipos

```bash
npm run test:functions        # node --test "supabase/functions/**/*.test.ts" (Node 24, TS nativo)
cd supabase/functions
npx --yes deno@2.9.6 check --config coach/deno.json coach/index.ts   # igual para mcp, ics, push-dispatch, garmin, apple-revoke
```

## Estructura

```
_shared/
  schema.ts dates.ts http.ts log.ts crypto.ts secrets.ts types.ts   utilidades puras
  planning/   contexto de planificación, carga, fases, validación de cambios, huecos, export a Garmin
  mcp/        protocolo JSON-RPC dual-era, guardas HTTP y las 8 herramientas
  coach/      prompt del entrenador, salida estructurada, trabajo en segundo plano, capa HTTP
  ics/ push/ garmin/   feed iCalendar, envío Expo y recibos, integración Garmin
  apple/      client_secret ES256 y revocación de Sign in with Apple
  db/rows.ts  filas de Postgres → tipos (puro)
  platform/   adaptadores supabase-js y SDK de Anthropic (no se cargan en los tests)
  testing/    dobles de prueba en memoria
```
