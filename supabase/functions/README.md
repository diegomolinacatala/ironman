# Edge Functions de Road to Ironman

Funciones de Supabase (Deno 2) que dan servicio a la app. Toda la lógica vive en módulos puros de
`_shared/**` (sin globals de Deno, probados con `node --test`); cada `index.ts` solo lee el entorno,
crea el cliente de Supabase y conecta las piezas.

| Función | URL (`https://<ref>.supabase.co/functions/v1/…`) | Autenticación | `verify_jwt` |
|---|---|---|---|
| `coach` | `POST /coach` con un `CoachRequest` | JWT del usuario | `true` |
| `briefing` (v2) | `POST /briefing` con `{ date, refresh? }` | JWT del usuario | `false` (el JWT se verifica en el código) |
| `meal` (v2) | `POST /meal` con `{ date, time, imageBase64?, text? }` | JWT del usuario | `false` (el JWT se verifica en el código) |
| `mcp` | `POST /mcp/u/<secreto>` (conector "Conecta tu Claude") | secreto personal en la ruta (scope `mcp`) | `false` |
| `ics` | `GET /ics/<secreto>.ics` (suscripción `webcal://`) | secreto personal en la ruta (scope `ics`) | `false` |
| `push-dispatch` | `POST /push-dispatch` (trigger `pg_net` + barrido `pg_cron`) | clave secreta del servidor en `apikey` | `false` |
| `garmin` | `POST /garmin` con `{ action }` | JWT del usuario (`connect`, `disconnect`, `sync`) · clave secreta en `apikey` (`sync_all`) | `false` (el JWT se verifica en el código) |
| `apple-revoke` | `POST /apple-revoke` con `{ authorizationCode }` | JWT del usuario | `false` (el JWT se verifica en el código) |

En v2 (docs/V2.md) el coach con IA está encendido en la app (`EXPO_PUBLIC_AI_COACH=0` lo apaga) y
**no cuesta nada**: `coach`, `briefing` y `meal` usan **Cloudflare Workers AI** (plan gratuito, 10.000
neuronas/día) a través de nuestro worker `ironman-ai` (`cloudflare/ai`). Proveedor por orden:
1. Workers AI si están `AI_WORKER_URL` y `AI_WORKER_SECRET` (modelo `AI_MODEL` para coach e informe y
   `AI_VISION_MODEL` para fotos; por defecto `@cf/nvidia/nemotron-3-120b-a12b` para texto y `@cf/meta/llama-4-scout-17b-16e-instruct` para fotos);
2. Claude (`claude-opus-5-5`, de pago) si solo está `ANTHROPIC_API_KEY` (opcional, se conserva como alternativa);
3. ninguno → `503 ai_unavailable` y la app usa el motor de reglas / el informe y la estimación locales
   (`briefing` devuelve igualmente el informe ya guardado).

Cuando se agotan las neuronas del día, el worker responde `503 { error: 'quota' }`: `briefing` y `meal`
contestan `503 ai_unavailable` con el mensaje "La IA gratuita ha llegado a su límite de hoy. Vuelve a
intentarlo mañana." y el trabajo del coach termina en `error` con ese mismo mensaje (la app usa sus
plantillas locales).

`supabase/config.toml` (lo mantiene el agente de base de datos):

```toml
[functions.coach]
verify_jwt = true

[functions.briefing]       # el JWT se verifica en el código (userIdFromJwt)
verify_jwt = false

[functions.meal]           # el JWT se verifica en el código (userIdFromJwt)
verify_jwt = false

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
| `AI_WORKER_URL` | Sí para la IA gratuita de v2 (`coach`, `briefing`, `meal`) | URL del worker `ironman-ai` (`https://ironman-ai.<tu-subdominio>.workers.dev`, la que imprime `wrangler deploy`). |
| `AI_WORKER_SECRET` | Igual que arriba | El mismo valor que el secreto `AI_SHARED_SECRET` del worker, **mínimo 32 caracteres** (p. ej. `openssl rand -hex 32`); más corto se ignora (y el worker responde `500 misconfigured`). |
| `AI_MODEL` | No (por defecto `@cf/nvidia/nemotron-3-120b-a12b`) | Modelo de Workers AI para `coach` y `briefing`. Permitidos por el worker (todos del plan gratuito): `@cf/nvidia/nemotron-3-120b-a12b`, `@cf/meta/llama-4-scout-17b-16e-instruct`, `@cf/google/gemma-4-26b-a4b-it`. |
| `AI_VISION_MODEL` | No (por defecto `@cf/meta/llama-4-scout-17b-16e-instruct`) | Modelo de Workers AI para las fotos de `meal` (debe aceptar imágenes). |
| `ANTHROPIC_API_KEY` | No (opcional, de pago) | Claude `claude-opus-5-5`, solo si no está configurado el worker. Sin worker ni clave las tres funciones responden `503 {error:'ai_unavailable'}` y la app usa el motor de reglas, el informe local y la estimación local de comidas. `briefing` también usa `GARMIN_KEY_SECRET` (si está) para refrescar Garmin antes de preparar el informe. |

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
npx supabase secrets set AI_WORKER_URL=https://ironman-ai.<tu-subdominio>.workers.dev AI_WORKER_SECRET=<mismo valor que AI_SHARED_SECRET>
npx supabase secrets set AI_MODEL=@cf/nvidia/nemotron-3-120b-a12b AI_VISION_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct   # opcional
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...             # opcional (de pago), solo sin worker
npx supabase secrets list
```

## Despliegue (desde Windows, sin Docker)

Worker de IA gratuita (Cloudflare, una vez y tras cambiar `cloudflare/ai`; no necesita `npm install`):

```bash
cd cloudflare/ai
npx wrangler deploy                         # imprime la URL https://ironman-ai.<tu-subdominio>.workers.dev
npx wrangler secret put AI_SHARED_SECRET    # pega el secreto (el mismo que AI_WORKER_SECRET en Supabase)
node --test "src/**/*.test.mts"             # pruebas del worker (desde la raíz: node --test "cloudflare/ai/src/**/*.test.mts")
```

`POST /v1/chat` con `Authorization: Bearer <AI_SHARED_SECRET>` y `{ model, messages, response_format?,
max_completion_tokens?, enable_thinking?, temperature? }` (modelo de la lista permitida, cuerpo ≤ 3 MB, imágenes
solo como `data:image/…;base64`) → `200 { text, finishReason, usage: { inputTokens, outputTokens }, model }`
(`finishReason` `'stop'` o `'max_tokens'`). Errores `{ error, message }`: `401 unauthorized`, `400 bad_request`,
`404`, `405`, `413 too_large`, `429 rate_limited`, `503 quota` (neuronas gratuitas del día agotadas),
`502 model_error`, `500 misconfigured` (falta el secreto, tiene menos de 32 caracteres o falta un limitador: falla
cerrado). Límites nativos: `IP_LIMITER` 60/min por IP (`cf-connecting-ip`) **antes** de comprobar el token, y
`CHAT_LIMITER` 30/min por usuario con la cabecera `x-ai-client` = hex(HMAC-SHA256(`AI_WORKER_SECRET`, id del
usuario)) que envían las funciones (nunca el id en claro; sin cabecera válida, un cubo compartido).

Supabase:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push                       # migraciones (RPC svc_* que usan estas funciones)
npx supabase functions deploy mcp ics push-dispatch garmin apple-revoke --use-api
npx supabase functions deploy coach briefing meal garmin mcp --use-api    # v2 (tras db push de 20261027000100_v2.sql)
```

Cada función tiene su `deno.json` (`nodeModulesDir: "none"`) para que Deno no use el
`package.json`/`node_modules` de la app. Las dependencias van con versión fija en el propio import
(`npm:@supabase/supabase-js@2.118.0`, `npm:@anthropic-ai/sdk@1.3.0`).

## Contratos con la app

Errores: siempre JSON `{ "error": "<código>", "message": "<texto en español>" }`.

- **IA (coach, briefing, meal)** — el puerto `ClaudePort` tiene dos adaptadores: `platform/workers-ai.ts`
  (gratuito; prompt de sistema como mensaje `system`, bloques de imagen como `image_url` con URL `data:`, turnos
  seguidos del mismo rol fusionados, esquema JSON convertido a `json_schema` estricto —nulos como `type: [x,
  'null']`, todas las propiedades obligatorias, sin `format`—, effort `low` → `enable_thinking: false` y `medium`
  → `true`, texto limpiado de ``` y `<think>`) y `platform/anthropic.ts` (Claude). `ai_usage` guarda el nombre del
  modelo de Workers AI. Las salidas de los modelos abiertos se validan igual de estrictas y degradan con cuidado:
  el informe o la comida inválidos → `503` (la app usa su plantilla); el coach sin `reply` → trabajo en `error`,
  y con `reply` pero cambios mal formados → respuesta sin esos cambios (cuentan como descartados).
- **coach** — `POST` `CoachRequest` (v2: `channel?: 'voice' | 'text'`) → `202 { jobId }`. El resultado se escribe en `coach_jobs`
  (`status` `done` con `reply`, `proposal_id`, `engine: 'ai'` y `extras = { memory: string[], lifeEventId: uuid | null }`,
  o `error` con mensaje). v2: la salida de la IA incluye `memory` (0-3 hechos o preferencias duraderas, ≤ 140
  caracteres, que se añaden a `profiles.coach_notes` como líneas `- …`, sin duplicados; nunca se borra ni reescribe
  una línea existente: si no caben en 4000 caracteres, los hechos nuevos se omiten) y `life_event` (imprevisto que
  se inserta en `life_events`; fin = inicio si no se indica, fin ≥ inicio, máximo 120 días, no se repite si ya hay
  uno igual que se solapa). Solo se guardan en modo `chat` con un mensaje del atleta (nunca en `plan_week` ni
  `replan`). Un fallo al guardar la memoria o el imprevisto no hace fallar el trabajo. `channel: 'voice'` marca el mensaje como
  transcripción (el coach corrige errores de reconocimiento y no pregunta: decide). Errores: `401`,
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
- **briefing** (v2) — `POST { date: 'YYYY-MM-DD', refresh?: boolean }` → `200 Briefing` (camelCase de
  `src/domain/types.ts`, `engine: 'ai'`). Si ya hay fila en `briefings` para (usuario, fecha) y no es `refresh`, la
  devuelve tal cual (sin proveedor de IA, sin consentimiento ni cupo). Si no: `503 ai_unavailable` sin
  proveedor de IA (ni worker ni `ANTHROPIC_API_KEY`); `400` si la fecha no es hoy/mañana (±2 días de la fecha UTC); `403 consent_required`;
  `429 rate_limited` (12 generaciones/24 h: `svc_reserve_ai_call` reserva de forma atómica una fila de `ai_usage`
  con `function_name = 'briefing'` ANTES de llamar a la IA —las llamadas fallidas cuentan— y después se completa
  con modelo y tokens; leer el informe guardado no consume cupo). Antes de generar
  sincroniza Garmin si está conectado y `last_sync_at` tiene más de 30 min (máx. 25 s; los fallos se ignoran).
  Contexto: sueño de anoche (fila de `daily_metrics` de esa fecha, campo a campo Garmin → Apple Salud → manual;
  VFC frente a la media de las 7 noches anteriores, con al menos 3), entrenos de hoy y mañana con su estructura,
  sesiones de ayer, carrera y fase, imprevistos activos y ocupaciones de hoy **solo como horas** (nunca títulos).
  IA (Workers AI o Claude) con effort `low`, `max_tokens` 4000 y salida estructurada `{ headline, sleep_verdict, sleep_summary,
  script, focus }` validada (texto plano sin markdown ni emojis, titular ≤ 90, guion de 40-450 palabras, veredicto
  `unknown` sin datos de sueño). Se hace upsert en `briefings` (con `sleep` = el `SleepSnapshot` calculado aquí y
  `model`) y se registra `ai_usage`. Fallos de Claude (rechazo, corte, formato, timeout de 90 s) → `503
  ai_unavailable` (con el mensaje de límite diario si se agotó la IA gratuita); otros → `500 internal`.
- **meal** (v2) — `POST { date, time: 'HH:mm', imageBase64?, text? }` (al menos uno; JPEG en base64 sin o con
  prefijo `data:`; también PNG/WebP) → `200 MealAnalysis` (`engine: 'ai'`). `400` formato, `413 too_large` si la
  foto supera 2 MB en base64, `403 consent_required`, `429 rate_limited` (40/24 h, misma reserva atómica con `function_name = 'meal'`),
  `503 ai_unavailable`. Modelo de visión (Workers AI `AI_VISION_MODEL` o Claude; imagen + texto) con effort `low`; contexto: solo los entrenos de
  ese día (para el consejo). Salida `{ meal, description, items[], kcal, carbs_g, protein_g, fat_g, confidence, tip }`
  normalizada: macros enteras en rangos razonables o `null` (kcal se calcula de las macros si falta), franja por la
  hora si la del modelo no vale, consejo ≤ 140. No guarda nada salvo la fila de `ai_usage`.
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
`log_daily_metrics` acepta también (v2) `sleep_deep_min`, `sleep_light_min`, `sleep_rem_min`, `sleep_awake_min`
(0-1440) y `sleep_start`/`sleep_end` (ISO 8601 con zona; el fin debe ser posterior y como mucho 20 h después).
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
la guarda cifrada en `integration_credentials` y sincroniza los últimos 14 días (28 en la primera sincronización
tras conectar, para tener ya las medias de sueño y VFC): resúmenes diarios, sueño (duración, puntuación, fases
profundo/ligero/REM/despierto en minutos e inicio/fin de la noche → `daily_metrics.sleep_*`), VFC, Body Battery
y actividades → `daily_metrics (source 'garmin', raw.source 'Garmin')` y
entrenos (completa el planificado que encaja o crea uno completado con `external_id 'garmin:<id>'`;
pádel, tenis o fútbol entran como `other`). Si la actividad ya está como entreno completado desde otra
fuente (Garmin Connect → Apple Salud → app: mismo día, deporte compatible, duración ±max(10 min, 15 %)
e inicio ±45 min) se omite para no contarla dos veces; `log_completed_activity` (puente de Claude)
aplica la misma regla y responde `already_logged`. Un `401` marca la integración como `expired`.

## Pruebas y comprobación de tipos

```bash
npm run test:functions        # node --test "supabase/functions/**/*.test.ts" (Node 24, TS nativo)
cd supabase/functions
for fn in mcp ics push-dispatch garmin apple-revoke coach briefing meal; do
  npx --yes deno@2.9.6 check --config "$fn/deno.json" "$fn/index.ts"
done
```

## Estructura

```
_shared/
  schema.ts dates.ts http.ts log.ts crypto.ts secrets.ts types.ts   utilidades puras
  planning/   contexto de planificación, carga, fases, validación de cambios, huecos, export a Garmin
  mcp/        protocolo JSON-RPC dual-era, guardas HTTP y las 8 herramientas
  coach/      prompt del entrenador, salida estructurada, memoria e imprevistos, trabajo en segundo plano, capa HTTP
  ai/         elección de proveedor (Workers AI / Claude), consentimiento + cupo de 24 h (ai_usage), llamada acotada
              a la IA y limpieza de texto (briefing, meal)
  briefing/   informe de la mañana: contexto de sueño y plan, prompt, salida validada, refresco de Garmin, HTTP
  meal/       análisis de fotos de comida: validación de la petición, prompt, normalización de macros, HTTP
  ics/ push/ garmin/   feed iCalendar, envío a APNs, integración Garmin
  apple/      JWT ES256 con la clave .p8, client_secret y revocación de Sign in with Apple
  db/rows.ts  filas de Postgres → tipos (puro)
  platform/   adaptadores supabase-js, SDK de Anthropic (no se cargan en los tests) y Workers AI (fetch inyectado, con pruebas)
  testing/    dobles de prueba en memoria
```
