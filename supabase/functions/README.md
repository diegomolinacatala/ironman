# Edge Functions de Road to Ironman

Funciones de Supabase (Deno 2) que dan servicio a la app. Toda la lógica vive en módulos puros de
`_shared/**` (sin globals de Deno, probados con `node --test`); cada `index.ts` solo lee el entorno,
crea el cliente de Supabase y conecta las piezas.

| Función | URL (`https://<ref>.supabase.co/functions/v1/…`) | Autenticación | `verify_jwt` |
|---|---|---|---|
| `coach` (opcional, **desactivada por defecto**) | `POST /coach` con un `CoachRequest` | JWT del usuario | `true` |
| `mcp` | `POST /mcp/u/<secreto>` (conector "Conecta tu Claude") | secreto personal en la ruta (scope `mcp`) | `false` |
| `ics` | `GET /ics/<secreto>.ics` (suscripción `webcal://`) | secreto personal en la ruta (scope `ics`) | `false` |
| `push-dispatch` | `POST /push-dispatch` (trigger `pg_net` + barrido `pg_cron`) | clave secreta del servidor en `apikey` | `false` |
| `garmin` | `POST /garmin` con `{ action }` | JWT del usuario (`connect`, `disconnect`, `sync`) · clave secreta en `apikey` (`sync_all`) | `false` (el JWT se verifica en el código) |
| `apple-revoke` | `POST /apple-revoke` con `{ authorizationCode }` | JWT del usuario | `false` (el JWT se verifica en el código) |

El coach con IA dentro de la app está apagado por defecto: la función `coach` sigue en el repositorio
(dormida) pero no se despliega ni necesita `ANTHROPIC_API_KEY` hasta que se active.

`supabase/config.toml` (lo mantiene el agente de base de datos):

```toml
[functions.coach]          # solo si se activa el coach con IA
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
| `APNS_KEY_ID` | Sí para las notificaciones push (sin los tres `APNS_*` obligatorios no se envía nada: cada notificación queda con `push_error = 'apns_not_configured'` y la función lo avisa una vez en los logs) | Key ID de la clave `.p8` con "Apple Push Notifications service (APNs)" activado. |
| `APNS_TEAM_ID` | Igual que arriba | Team ID de Apple Developer (10 caracteres). |
| `APNS_PRIVATE_KEY` | Igual que arriba | Contenido del `.p8` (PEM `-----BEGIN PRIVATE KEY-----…`). Se aceptan saltos de línea reales o escritos como `\n`. |
| `APNS_TOPIC` | No (por defecto `io.github.diegomolinacatala.ironman`) | Bundle id de la app (cabecera `apns-topic`). |
| `APNS_HOST` | No (por defecto `api.push.apple.com`) | Pon `api.sandbox.push.apple.com` para probar con builds de desarrollo (Xcode/dev client): sus tokens son de sandbox. Los tokens del otro entorno reciben `400 BadDeviceToken` y se borran. |
| `GARMIN_KEY_SECRET` | Sí para Garmin (≥ 16 caracteres; mejor 48 bytes aleatorios) | Cifrar con AES-GCM-256 (clave derivada con HKDF-SHA-256) la Personal API Key de cada usuario. **No lo cambies**: las claves guardadas dejarían de descifrarse y habría que reconectar Garmin. |
| `GARMIN_PERSONAL_API_BASE_URL` | No | Sustituir `https://personal.connectapi.garmin.com` (pruebas). |
| `APPLE_TEAM_ID` | Sí para revocar Apple al borrar la cuenta (sin los cuatro `APPLE_*`, `apple-revoke` responde `503 apple_not_configured` y la app borra la cuenta igualmente) | Team ID de Apple Developer (el mismo que `APNS_TEAM_ID`). |
| `APPLE_KEY_ID` | Igual que arriba | Key ID de la clave con "Sign in with Apple" activado para el App ID. |
| `APPLE_PRIVATE_KEY` | Igual que arriba | Contenido del `.p8` (mismo formato que `APNS_PRIVATE_KEY`). |
| `APPLE_CLIENT_ID` | Igual que arriba | Bundle id de la app: `io.github.diegomolinacatala.ironman`. Si pones una lista separada por comas se usa la primera. |
| `ANTHROPIC_API_KEY` | No (opcional; **solo** si se activa el coach con IA y se despliega `coach`) | Coach con IA (Claude `claude-opus-5-5`). Sin él `coach` responde `503 {error:'ai_unavailable'}` y la app usa el motor de reglas. |

**Una sola clave de Apple para push y Sign in with Apple.** En *Certificates, Identifiers & Profiles ›
Keys › +* crea una clave y marca a la vez **Apple Push Notifications service (APNs)** (entorno
*Sandbox & Production*; restricción *Team Scoped* o el topic `io.github.diegomolinacatala.ironman`) y
**Sign in with Apple** (App ID principal `io.github.diegomolinacatala.ironman`). Descarga el `.p8`
(solo se puede una vez) y usa el mismo contenido y el mismo Key ID en `APNS_PRIVATE_KEY`/`APNS_KEY_ID`
y en `APPLE_PRIVATE_KEY`/`APPLE_KEY_ID`. Si prefieres claves separadas, cada par de variables acepta la
suya. El App ID necesita además las capacidades *Push Notifications* y *Sign in with Apple*.

```bash
npx supabase secrets set APNS_KEY_ID=XYZ987WVU1 APNS_TEAM_ID=ABCDE12345
npx supabase secrets set APNS_PRIVATE_KEY="$(cat AuthKey_XYZ987WVU1.p8)"
npx supabase secrets set APNS_HOST=api.sandbox.push.apple.com      # opcional, solo para builds de desarrollo
npx supabase secrets set GARMIN_KEY_SECRET="$(openssl rand -base64 48)"
npx supabase secrets set APPLE_TEAM_ID=ABCDE12345 APPLE_KEY_ID=XYZ987WVU1 APPLE_CLIENT_ID=io.github.diegomolinacatala.ironman
npx supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_XYZ987WVU1.p8)"
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...             # opcional, solo con el coach con IA
npx supabase secrets list
```

## Despliegue (desde Windows, sin Docker)

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push                       # migraciones (RPC svc_* que usan estas funciones)
npx supabase functions deploy mcp ics push-dispatch garmin apple-revoke --use-api
npx supabase functions deploy coach --use-api    # solo si se activa el coach con IA
```

Cada función tiene su `deno.json` (`nodeModulesDir: "none"`) para que Deno no use el
`package.json`/`node_modules` de la app. Las dependencias van con versión fija en el propio import
(`npm:@supabase/supabase-js@2.118.0`, `npm:@anthropic-ai/sdk@1.3.0`).

## Contratos con la app

Errores: siempre JSON `{ "error": "<código>", "message": "<texto en español>" }`.

- **coach** (desactivada por defecto) — `POST` `CoachRequest` → `202 { jobId }`. El resultado se escribe en `coach_jobs`
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
  salen) y quedadas confirmadas sin entreno enlazado. UID estable por entreno (`workout-<id>@roadtoironman.app`).
- **push-dispatch** — reclama las notificaciones sin enviar de las últimas 24 h (`pushed_at`) y las
  envía directamente a Apple (APNs, HTTP/2): `POST https://api.push.apple.com/3/device/<token>` por
  cada dispositivo iOS del usuario (`push_tokens.platform = 'ios'`, token APNs en hexadecimal de
  `getDevicePushTokenAsync`), con 8 peticiones en paralelo como máximo. Cabeceras:
  `authorization: bearer <JWT ES256 {alg, kid} + {iss: team id, iat}>` (se reutiliza 40 min),
  `apns-topic`, `apns-push-type: alert`, `apns-priority: 10` y `apns-collapse-id: <id de la
  notificación>`. Cuerpo: `{ aps: { alert: { title, body }, sound: 'default', 'thread-id': <tipo> },
  url, notificationId, type, …, body: { los mismos datos } }` (expo-notifications expone `body` como
  `content.data` en iOS). Respeta `notification_prefs.social` (tipos `friend_request`,
  `friend_accepted`, `friend_completed`, `kudos`). Respuestas de APNs:
  - `200` en algún dispositivo → enviada (`push_error` null);
  - `410`, o `400` `BadDeviceToken` / `DeviceTokenNotForTopic` / `Unregistered` → se borra ese token;
  - `403` (`InvalidProviderToken`, `ExpiredProviderToken`…) → `push_error`, se descarta el JWT en caché
    y el resto del lote vuelve a la cola para el siguiente barrido;
  - `429`, `5xx`, error de red o timeout → vuelve a la cola (`pushed_at` null) para el siguiente barrido;
  - otros `4xx` → `push_error` (`APNs <estado> <motivo>`);
  - sin `APNS_*` → `push_error = 'apns_not_configured'` (no lanza error).

  En el barrido de `pg_cron` (`{"action":"sweep"}`) borra además los tokens que no se han visto en
  90 días (`last_seen_at`).

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
for fn in mcp ics push-dispatch garmin apple-revoke coach; do
  npx --yes deno@2.9.6 check --config "$fn/deno.json" "$fn/index.ts"
done
```

## Estructura

```
_shared/
  schema.ts dates.ts http.ts log.ts crypto.ts secrets.ts types.ts   utilidades puras
  planning/   contexto de planificación, carga, fases, validación de cambios, huecos, export a Garmin
  mcp/        protocolo JSON-RPC dual-era, guardas HTTP y las 8 herramientas
  coach/      prompt del entrenador, salida estructurada, trabajo en segundo plano, capa HTTP
  ics/ push/ garmin/   feed iCalendar, envío a APNs, integración Garmin
  apple/      JWT ES256 con la clave .p8, client_secret y revocación de Sign in with Apple
  db/rows.ts  filas de Postgres → tipos (puro)
  platform/   adaptadores supabase-js y SDK de Anthropic (no se cargan en los tests)
  testing/    dobles de prueba en memoria
```
