# 05 — Integración "conecta tu Claude" (MCP remoto) + Supabase como backend

> Investigación técnica a fecha **2026-10-25**. Fuentes de 2025-2026 enlazadas en cada sección y al final.
> Marcas: **[VERIFICAR]** = dato no confirmado en fuente oficial o que cambia rápido; **[POSIBLE OBSOLETO]** = fuente o paquete con riesgo de estar desfasado.

---

## 0. Resumen de decisiones (TL;DR)

| # | Decisión | Elección recomendada | Por qué |
|---|----------|----------------------|---------|
| D1 | Cómo "conecta su Claude" cada usuario | **Custom connector de claude.ai** que apunta a **nuestro servidor MCP remoto** (Claude nos llama a nosotros) | Es el único camino permitido para usar la suscripción Pro/Max del usuario. Un tercero **no puede** usar el login de Claude.ai ni enrutar peticiones por la suscripción del usuario ([política Anthropic](https://code.claude.com/docs/en/legal-and-compliance)). |
| D2 | Dónde corre el MCP | **Supabase Edge Function** `mcp` (Deno 2), `https://<ref>.supabase.co/functions/v1/mcp` | Supabase documenta oficialmente este caso en 2026 ([Deploy MCP servers](https://supabase.com/docs/guides/ai-tools/byo-mcp)); sin servidor propio. |
| D3 | Transporte / protocolo | **Streamable HTTP, sin estado, respuestas `application/json`**. Servidor **dual-era**: acepta `initialize` (2025-03-26 / 2025-06-18 / 2025-11-25) **y** peticiones modernas 2026-07-28 | Claude soporta Streamable HTTP (SSE legado en deprecación). El spec actual es 2026-07-28 (sin handshake), pero el despliegue de 2026-07-28 en Claude está "rolling out" y no confirmado ([blog](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude)). |
| D4 | SDK MCP | **`@modelcontextprotocol/server@^2.4`** con `createMcpHandler` (`responseMode: 'json'`) | v2 es la línea estable, implementa 2026-07-28 y sirve clientes 2025 desde la misma factoría por defecto ([docs v2](https://ts.sdk.modelcontextprotocol.io/v2/serving/http)). |
| D5 | Autenticación del conector | **Objetivo: OAuth 2.1 con Supabase Auth como Authorization Server** (beta) + DCR + página de consentimiento estática. **Plan B / arranque rápido: URL personal secreta** (token en el *path*, conector "Sin inicio de sesión") | OAuth da identidad por usuario y RLS automática. La URL secreta funciona hoy en cualquier plan y en 1 día, pero es un "bearer en la URL". |
| D6 | Auth en Edge Functions | Claves nuevas **`sb_publishable_…` (app)** / **`sb_secret_…` (servidor)**, JWT con **claves de firma asimétricas (ES256)**, wrapper **`withSupabase` de `@supabase/server`** | `anon`/`service_role` se deprecan a finales de 2026 ([API keys](https://supabase.com/docs/guides/api/api-keys)). |
| D7 | `verify_jwt` | `true` en funciones llamadas por la app; **`false`** en `mcp`, `ics`, webhooks y funciones invocadas por `pg_cron` (autenticación en código) | La puerta de enlace devolvería 401 sin `WWW-Authenticate` y rompería el descubrimiento OAuth de Claude. |
| D8 | Tareas programadas | `pg_cron` + `pg_net` + **Vault** (URL + secret key), función con `auth: 'secret'` | Patrón oficial ([Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)). |
| D9 | Re-planificación "dentro de la app" con IA | Opcional y separado: **Claude API con API key del desarrollador** (o BYOK). Patrón **202 + `EdgeRuntime.waitUntil` + escribir en BD + Realtime** | Wall-clock de Edge Free = **150 s**; una llamada larga a Claude no debe bloquear la respuesta HTTP. |
| D10 | Plan Supabase | **Free para el MVP** (2-10 usuarios sobra), asumiendo el riesgo de **pausa tras 7 días de baja actividad**; pasar a Pro (25 $/mes) si se pausa o se necesitan 400 s de wall-clock | Ver tabla de límites §B8. |

---

# PARTE A — Conectar el Claude de cada usuario (MCP remoto / custom connector)

## A1. Qué significa "conectar tu Claude" (y qué NO se puede hacer)

**Dirección del flujo:** el usuario, en claude.ai (web/escritorio) añade nuestro servidor como *custom connector*. A partir de ahí, en cualquier conversación (web, escritorio, **app iOS**) su Claude puede **llamar a nuestras herramientas** (leer su contexto de entrenamiento, registrar imprevistos, guardar el plan semanal). El consumo va contra **su** suscripción.

**Lo que NO está permitido** (página oficial de cumplimiento de Claude Code, válida para cualquier producto de terceros, ver [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)):

- Ofrecer "login con Claude.ai" dentro de nuestra app.
- Enrutar peticiones a través de credenciales Free/Pro/Max en nombre del usuario.
- Recoger o almacenar credenciales/tokens de sesión de Claude.ai.
- Aplicación estricta desde enero-febrero 2026 (cobertura de prensa: [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)).

**Consecuencia de arquitectura:**

| Necesidad | Cómo se resuelve |
|-----------|------------------|
| "Mi Claude me hace el plan semanal con mis datos de Garmin y mi calendario" | El usuario conversa con **su Claude** (que ya tiene su conector de Garmin) y nuestro conector MCP le da el contexto de la app y la capacidad de **escribir** el plan en nuestra BD. |
| "Botón *Replanificar* dentro de la app, sin abrir Claude" | Necesita **Claude API** (API key de consola: la paga el desarrollador, o el usuario introduce su propia API key = BYOK). No usa la suscripción de claude.ai. Ver §B7. |
| Notificar al usuario cuando su Claude cambia el plan | Trigger/Webhook en BD → Edge Function → push (Expo). Ver §B6. |

---

## A2. Requisitos actuales (octubre 2026) de los custom connectors de Claude

Fuente principal: documentación de desarrolladores de conectores en claude.com ([Build an MCP server for Claude](https://claude.com/docs/connectors/building/index.md), [Authentication](https://claude.com/docs/connectors/building/authentication.md), [Add unlisted connector](https://claude.com/docs/connectors/custom/add-unlisted.md)).

| Aspecto | Requisito / comportamiento de Claude |
|---------|--------------------------------------|
| Quién conecta | **Los servidores de Anthropic**, no el dispositivo. Igual en claude.ai, Desktop, Cowork y móvil. El servidor debe ser accesible por Internet pública. |
| Rango IP de salida de Anthropic | `160.79.104.0/21` (para allowlist en WAF) — [IP addresses](https://platform.claude.com/docs/en/api/ip-addresses). |
| DNS | El hostname debe resolver **solo** a IPs públicas; **solo IPv4** (sin registro `A` no conecta). `*.supabase.co` cumple. |
| Redirecciones | No registrar una URL que haga 3xx a otro host: Claude descarta el header `Authorization` al seguirla → error de autorización. |
| Transporte | **Streamable HTTP** (recomendado). HTTP+SSE legado soportado pero en deprecación. Una URL terminada en `/sse` selecciona SSE: **no terminar el path en `/sse`**. |
| Versiones de autorización que sigue Claude | Specs de auth MCP **2025-03-26, 2025-06-18 y 2025-11-25** (documentado). |
| Versión de protocolo que envía Claude en `initialize` | **[VERIFICAR]** No documentado. Anthropic anunció el 2026-07-28 que el soporte de MCP 2026-07-28 "se está desplegando" en sus productos ([blog](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude)). Por eso: servidor **dual-era** y **loguear** `params.protocolVersion`, `MCP-Protocol-Version` y `_meta` de las primeras peticiones. |
| Qué puede exponer | Tools, prompts, resources; resultados de tool en texto e imagen; recursos texto/binario; MCP Apps (UI interactiva, también en iOS). |
| Qué NO soporta | Suscripciones a recursos, **sampling**, capacidades avanzadas/draft. |
| Tamaño máximo de resultado de tool (claude.ai/Desktop) | **~150.000 caracteres** (Claude Code: 25.000 tokens por defecto). |
| Timeout por llamada a tool | **240 s** en claude.ai/Desktop. (Nuestro límite real es el de Supabase: 150 s de inactividad; las tools deben tardar < 5 s.) |
| Latencia OAuth | Discovery, registro y token: **10 s**; refresh: **30 s**. |
| Callback OAuth (web, Desktop, móvil, Cowork) | `https://claude.ai/api/mcp/auth_callback` (exacto). Claude Code usa loopback `http://localhost:<puerto>/callback` y `http://127.0.0.1:<puerto>/callback` (aceptar sin comparar puerto). |
| PKCE | Siempre `S256`. El AS debe anunciar `code_challenge_methods_supported: ["S256"]`. |
| Identificación del cliente en `initialize` | `clientInfo.name` puede ser `claude-ai`, `Anthropic`, `claude-code`… **no** basar lógica ni autorización en ello ([Testing](https://claude.com/docs/connectors/building/testing.md)). |
| Annotations | Cada tool debe llevar `title` y `readOnlyHint: true` (lectura) o `destructiveHint: true` (modifica/borra). Claude las usa para permisos automáticos: las de solo lectura pueden ejecutarse sin confirmación por llamada; las destructivas siempre piden confirmación ([Review criteria](https://claude.com/docs/connectors/building/review-criteria.md)). |
| Nombre de tool | ≤ 64 caracteres (criterio de directorio); el spec recomienda `[A-Za-z0-9_.-]`, 1-128. |

### Planes y superficies

| Plan claude.ai | ¿Puede añadir custom connector por URL? | Notas |
|----------------|------------------------------------------|-------|
| Free | Sí, **máximo 1** custom connector | Si ya usáis un conector custom de Garmin en Free, no cabría el nuestro. **[VERIFICAR]** qué conector de Garmin usáis (directorio vs custom). |
| Pro / Max | Sí, en **Customize > Connectors > Add custom connector** | Caso esperado para vosotros dos. |
| Team / Enterprise | Solo Owner (o rol con permiso) lo añade para la org; los miembros luego hacen "Connect" | — |

- Un conector conectado está disponible en **web, escritorio y app móvil** ("Where connectors work" en [Get started](https://claude.com/docs/connectors/getting-started.md)). La documentación describe el alta desde web/escritorio; **en iOS se usa, no se da de alta** **[VERIFICAR]** si ya permite alta desde móvil.
- En cada chat el conector se activa/desactiva desde **+ > Connectors**. Permisos por tool: *Always allow / Needs approval / Blocked*.
- Se puede **editar nombre o URL** del conector después; **no** se pueden cambiar los ajustes de autenticación (hay que borrar y volver a añadir).

### ¿Se puede meter un secreto en la URL del conector (estilo Zapier)?

**Sí funciona técnicamente, pero está desaconsejado:**

- Con autenticación **"No sign-in"** Claude no envía credenciales y la documentación indica que cualquiera con la URL puede usar el conector → una URL con token secreto actúa como contraseña (Zapier lo plantea así: [Zapier MCP](https://zapier.com/blog/zapier-mcp-anthropic-api)).
- Anthropic, para credenciales fijas, pide **no** aceptarlas en query (`?token=`, `?apiKey=`) porque acaban en logs/proxies, y el spec de auth MCP prohíbe access tokens en query string ([Authentication](https://claude.com/docs/connectors/building/authentication.md)).
- Ejemplo real: BookingSync (julio 2026) marcó su `?token=` como **legado pero aún aceptado** y pasó a OAuth ([changelog](https://developers.bookingsync.com/changelog/2026/07/29/version-4-16-0)).
- La alternativa oficial "Request headers" (API key fija en header) está en **beta solo para algunas organizaciones** y es por organización, no por persona → **no sirve** para usuarios Pro individuales.

**Si se usa (Plan B):** token en el **path** (no query), ≥ 256 bits aleatorios, guardado **hasheado** (SHA-256) en BD, revocable/rotable desde la app (el usuario edita la URL del conector), `last_used_at`, rate-limit, nunca loguear el path completo.

---

## A3. Opciones de autenticación comparadas

| Opción | Cómo lo configura el usuario en Claude | Identidad por usuario | RLS automática | Esfuerzo | Riesgos |
|--------|----------------------------------------|-----------------------|----------------|----------|---------|
| **A. OAuth 2.1 con Supabase Auth (DCR)** — *recomendada como objetivo* | URL `…/functions/v1/mcp` → Authentication "Sign in now" → OAuth client **"Register automatically"** → Connect → login web + consentimiento | Sí (token JWT del usuario) | **Sí** (`withSupabase({auth:'user'})`) | Medio (1-2 días): activar OAuth server, página de consentimiento estática, función MCP | OAuth server de Supabase **en beta**; Supabase no anuncia CIMD → la opción "Use Claude's published identity" **no** funcionaría **[VERIFICAR]**; hay que hostear la página de consentimiento fuera de Edge Functions (no sirven HTML sin dominio propio). |
| A'. OAuth con cliente pre-registrado (sin DCR) | Igual, pero en **Advanced settings / Use your own OAuth client** pega un Client ID que le damos | Sí | Sí | Medio | Mismo que A; evita registros abiertos (DCR) pero añade un paso manual al usuario. |
| **B. URL personal secreta** (authless) — *arranque rápido* | URL `…/functions/v1/mcp/u/<token>` → "No sign-in" | Sí, vía lookup del token | **No**: la función usa cliente admin y filtra por `user_id` a mano (o RPCs `security definer`) | Bajo (½-1 día) | Bearer en URL; si se filtra la URL, acceso total hasta rotar. |
| C. Static headers (API key en header) | "Request headers" | No (por organización) | No | Bajo | Beta limitada; no visible en planes individuales. **Descartada.** |
| D. Authless puro | URL sin secreto | No | No | — | **Descartada** (datos personales/salud). |

**Recomendación:** implementar la capa de tools **independiente de la auth** (función `buildServer(ctx)` que recibe un "contexto de usuario") y montar dos *adaptadores*: B primero (para probar con vuestro Claude esta semana) y A en cuanto la app tenga login web. Cuando A esté estable, desactivar B.

---

## A4. Flujo OAuth con Supabase Auth como Authorization Server (opción A)

Documentación: [OAuth 2.1 Server – Getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [MCP Authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [Token security](https://supabase.com/docs/guides/auth/oauth-server/token-security), [Deploy MCP servers](https://supabase.com/docs/guides/ai-tools/byo-mcp).

### Secuencia

```
Claude (servidores Anthropic)            Edge Function "mcp"                  Supabase Auth (AS)          Página consentimiento (web estática)
 1 POST /functions/v1/mcp (sin token) ─▶ 401 + WWW-Authenticate: Bearer resource_metadata="…/functions/v1/mcp/oauth-protected-resource"
 2 GET resource_metadata ─────────────▶ { resource, authorization_servers:["https://<ref>.supabase.co/auth/v1"] }
 3 GET /.well-known/oauth-authorization-server/auth/v1 (o /auth/v1/.well-known/openid-configuration) ─────▶ metadata (registration_endpoint, S256…)
 4 POST registration_endpoint (DCR, redirect_uri=https://claude.ai/api/mcp/auth_callback) ─────────────────▶ client_id
 5 Navegador del usuario → /auth/v1/oauth/authorize?…&code_challenge=…&resource=… ───▶ redirige a  SITE_URL + /oauth/consent?authorization_id=…
 6                                                                                                  login (OTP email) + getAuthorizationDetails + approveAuthorization → redirect_url
 7 claude.ai/api/mcp/auth_callback?code=… → POST /token (form-urlencoded, PKCE) ───▶ access_token (JWT ES256, aud "authenticated", claim client_id) + refresh_token (rota)
 8 POST /functions/v1/mcp (Bearer JWT) ─▶ withSupabase verifica contra JWKS → cliente con RLS del usuario
```

### Configuración

1. **JWT Signing Keys asimétricas** (ES256 recomendado). `withSupabase` verifica tokens contra el JWKS del proyecto y rechaza HS256 legado. Dashboard → *Settings > JWT Keys*; si el proyecto sigue en "Legacy JWT secret", pulsar *Migrate JWT secret* y rotar a una clave ES256 ([Signing keys](https://supabase.com/docs/guides/auth/signing-keys)).
2. **Activar OAuth Server** (Dashboard → *Authentication > OAuth Server*), con **Authorization Path** `/oauth/consent` y **Dynamic client registration** activado. En local, `supabase/config.toml`:

```toml
[auth]
site_url = "https://<tu-dominio-estatico>"   # origen que sirve /oauth/consent

[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true
```

3. **Página de consentimiento**: Supabase **no** la hospeda. Debe vivir en el *Site URL*. Las Edge Functions **no sirven `text/html`** en `*.supabase.co` (se reescribe a `text/plain`; HTML solo con dominio propio, add-on de pago) ([Limits](https://supabase.com/docs/guides/functions/limits)). Opciones gratuitas: GitHub Pages, Cloudflare Pages, Netlify, o una ruta web de Expo Router desplegada con EAS Hosting **[VERIFICAR cuota]**. La página:
   - Lee `authorization_id` de la query.
   - Si no hay sesión → login (recomendado **email OTP de 6 dígitos**: no requiere configurar Sign in with Apple para web).
   - `supabase.auth.oauth.getAuthorizationDetails(authorization_id)` → muestra cliente, `redirect_uri` (hostname bien visible) y `scope`.
   - Botones → `approveAuthorization(id)` / `denyAuthorization(id)` → `window.location = data.redirect_url`.
   - Supabase Library ofrece un bloque "OAuth Consent" listo para Next.js/React.
4. **Función MCP** con `verify_jwt = false` (si no, la puerta de enlace contesta 401 sin `WWW-Authenticate` y Claude nunca descubre el AS).
5. **Instrucciones al usuario en Claude**: *Customize > Connectors > Add custom connector* → URL exacta `https://<ref>.supabase.co/functions/v1/mcp` (sin `/` final) → *Sign in now* → OAuth client: **Register automatically** (DCR). **No** "Use Claude's published identity" (CIMD), porque Supabase Auth no anuncia `client_id_metadata_document_supported` **[VERIFICAR]**.

### Detalles finos del cliente OAuth de Claude que hay que respetar

- Claude **solo inicia el login con HTTP 401** + `WWW-Authenticate`; ignora `WWW-Authenticate` en un 200. Un `200` con `isError: true` ("inicia sesión") **no** dispara el login.
- El campo `resource` del *protected resource metadata* debe ser **idéntico** a la URL que pega el usuario (incluido path). Claude manda `resource` (RFC 8707) en forma canónica (scheme/host en minúsculas, sin `/` final).
- Claude usa **solo el primer** elemento de `authorization_servers`.
- El `resource_metadata` puede estar en cualquier URL HTTPS (útil en Edge Functions, que no pueden servir `/.well-known/*` en la raíz del dominio). `withOAuthProtectedResource()` lo sirve en `…/functions/v1/mcp/oauth-protected-resource`.
- Claude añade `offline_access` si el AS lo anuncia, y refresca el token reactivamente ante 401 y proactivamente ~5 min antes de expirar. Errores de refresh deben ser `invalid_grant`.
- Si se usa **dominio propio** con Supabase: fijar `withOAuthProtectedResource({ authorizationServer: Deno.env.get('MCP_AUTH_ISSUER') })` para que coincida con el `issuer` real `https://<ref>.supabase.co/auth/v1`.
- Endurecimiento opcional: *Custom Access Token Hook* para poner `aud` = URL del MCP en tokens con `client_id` de Claude; y políticas RLS que distingan `(auth.jwt() ->> 'client_id') is not null` (acceso vía agente) de sesiones directas de la app.
- Gestión de "apps conectadas": Supabase expone endpoints de *grant management* para que el usuario revoque a Claude desde nuestra app.
- Coste: los usuarios que entran vía OAuth cuentan como MAU normales; sin cargo extra.

**Riesgo conocido:** hay reportes de "Unrecognized client_id" entre clientes de Anthropic y servidores OAuth de Supabase (issue de Claude Code, ago-2026, sobre el conector MCP propio de Supabase: [#84609](https://github.com/anthropics/claude-code/issues/84609)) **[VERIFICAR]** si afecta a proyectos propios. Mitigación: opción A' (cliente pre-registrado) o Plan B.

---

## A5. Comportamiento mínimo de un servidor MCP **sin estado** compatible

### A5.1 Era "legacy" (2025-03-26 … 2025-11-25) — lo que casi seguro envía hoy Claude

Fuentes: [Transports 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

| Caso | Respuesta obligatoria / recomendada |
|------|-------------------------------------|
| `POST` con JSON-RPC **request** | `200` con `Content-Type: application/json` (un objeto) **o** `text/event-stream`. El cliente debe aceptar ambos; **responder siempre JSON** simplifica (no hay notificaciones de progreso). |
| `Accept` | El cliente debe enviar `application/json, text/event-stream`. Ser tolerante: no rechazar si falta `text/event-stream` (algunos SDK lo hacen y devuelven 406; Claude lo envía). |
| `POST` con **notification** (p. ej. `notifications/initialized`, `notifications/cancelled`) o **response** | **`202 Accepted` sin cuerpo**. |
| `initialize` | Negociación: si el cliente pide una versión soportada → **devolver la misma**; si no → devolver la **más reciente soportada** (`2025-11-25`). Incluir `capabilities`, `serverInfo` (`name`, `version`, opcional `title`) e `instructions` (opcional). |
| `Mcp-Session-Id` | **Opcional** ("MAY"). Servidor sin estado: **no emitirlo** y tratar todas las peticiones como independientes. |
| `MCP-Protocol-Version` (header) | El cliente lo envía tras `initialize`. Si es inválido/no soportado → **400**. Si falta → asumir `2025-03-26`. |
| `GET` al endpoint | Sin stream servidor→cliente: **`405 Method Not Allowed`** (permitido explícitamente). |
| `DELETE` (cerrar sesión) | `405` (permitido). |
| `ping` | `{"jsonrpc":"2.0","id":X,"result":{}}`. |
| Método desconocido | Error JSON-RPC `-32601`. Tool desconocida → `-32602`. |
| Batches JSON-RPC (array) | Eliminados en 2025-06-18; Claude no los envía. Responder 400 o procesar uno a uno. |
| `Origin` | **Debe** validarse (DNS rebinding). Si viene y es inválido → `403`. Ojo: una validación demasiado estricta rompe las peticiones de Anthropic ([Testing](https://claude.com/docs/connectors/building/testing.md)). Regla práctica: aceptar **ausente**, `https://claude.ai`, `https://claude.com` y orígenes propios; loguear el resto antes de bloquear. |
| CORS | No hace falta para Claude (servidor-a-servidor). Solo para el MCP Inspector en navegador (dev). |

### A5.2 Era "moderna" 2026-07-28 (stateless core) — preparar el servidor para ella

Fuentes: [Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning.md), [Streamable HTTP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.md), [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog.md), [server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover).

Cambios relevantes para nosotros:

- **Sin `initialize` ni sesiones**: cada petición lleva en `params._meta` las claves `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientInfo`, `io.modelcontextprotocol/clientCapabilities`.
- Headers obligatorios en cada POST: `MCP-Protocol-Version`, `Mcp-Method`, y `Mcp-Name` (en `tools/call`, `resources/read`, `prompts/get`). Si no coinciden con el body → **400** + error `-32020` (`HeaderMismatch`).
- Versión no soportada → **400** + `-32022` (`UnsupportedProtocolVersionError`) con `data.supported`.
- Método no implementado → **404** + `-32601`.
- **`server/discover` obligatorio** (versiones soportadas, capacidades, `instructions`).
- Todos los resultados llevan **`resultType: "complete"`**; `tools/list` exige **`ttlMs`** y **`cacheScope`** (`"public"`/`"private"`). Orden de tools **determinista**.
- `ping` y `logging/setLevel` eliminados; GET del endpoint eliminado (→ 405); `Last-Event-ID` ignorado.
- Deprecados: Roots, Sampling, Logging, HTTP+SSE y **DCR** (en favor de CIMD; sigue disponible por compatibilidad).
- Elicitation/sampling pasan a *Multi Round-Trip Requests* (`InputRequiredResult`). No los usamos.

**Detección de era en un servidor dual (recomendado):**

```
si body.method == "initialize"                                   → legacy (responder InitializeResult)
si body.params._meta["io.modelcontextprotocol/protocolVersion"]  → modern (validar headers vs body; responder con resultType/ttlMs)
en otro caso                                                     → legacy sin estado (versión = header MCP-Protocol-Version o 2025-03-26)
```

El SDK `@modelcontextprotocol/server` v2 hace esto por ti con `createMcpHandler` (sirve clientes 2025 "statelessly" por defecto). Si se implementa a mano, la tabla anterior es todo lo necesario.

### A5.3 Ejemplo de intercambio JSON (legacy, el probable hoy)

**1) initialize**

```http
POST /functions/v1/mcp HTTP/1.1
Host: <ref>.supabase.co
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer eyJhbGciOiJFUzI1NiIs...

{"jsonrpc":"2.0","id":0,"method":"initialize","params":{
  "protocolVersion":"2025-11-25",
  "capabilities":{},
  "clientInfo":{"name":"claude-ai","version":"0.1.0"}}}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"jsonrpc":"2.0","id":0,"result":{
  "protocolVersion":"2025-11-25",
  "capabilities":{"tools":{"listChanged":false},"prompts":{"listChanged":false}},
  "serverInfo":{"name":"tri-planner","title":"TriPlanner","version":"0.1.0"},
  "instructions":"Datos de entrenamiento de triatlón del usuario autenticado (plan semanal, carreras objetivo, disponibilidad, imprevistos, sesiones de amigos). Fechas ISO 8601, zona Europe/Madrid, duraciones en minutos. Para planificar: primero get_planning_context; los cambios se guardan como propuesta que el usuario acepta en la app."}}
```

**2) notifications/initialized** → `HTTP/1.1 202 Accepted` (sin cuerpo).

**3) tools/list** (con `MCP-Protocol-Version: 2025-11-25`)

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":1,"result":{"tools":[
  {"name":"get_planning_context",
   "title":"Contexto para planificar la semana",
   "description":"Devuelve en una sola llamada todo lo necesario para planificar o replanificar una semana del usuario: perfil y zonas, carreras objetivo (prioridad A/B/C, fecha, distancia), plan actual de la semana, sesiones completadas recientes (sincronizadas desde Garmin), métricas de bienestar recientes, huecos ocupados por clases/trabajo, imprevistos registrados (partidos, lesiones, sobrecarga, estrés) y sesiones de amigos compatibles. Úsala antes de proponer cambios.",
   "inputSchema":{"type":"object","properties":{
      "week_start":{"type":"string","format":"date","description":"Lunes de la semana (YYYY-MM-DD). Por defecto, la semana actual."},
      "detail":{"type":"string","enum":["concise","detailed"],"default":"concise","description":"concise: resumen; detailed: incluye IDs de sesión y métricas diarias."}},
      "additionalProperties":false},
   "annotations":{"title":"Contexto para planificar la semana","readOnlyHint":true,"openWorldHint":false},
   "outputSchema":{"type":"object","properties":{"week_start":{"type":"string"},"athlete":{"type":"object"},"races":{"type":"array"},"planned_sessions":{"type":"array"},"busy_blocks":{"type":"array"},"life_events":{"type":"array"}},"required":["week_start","planned_sessions"]}}
]}}
```

**4) tools/call** correcto

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_planning_context","arguments":{"week_start":"2026-10-26","detail":"concise"}}}
```

```json
{"jsonrpc":"2.0","id":2,"result":{
  "content":[{"type":"text","text":"{\"week_start\":\"2026-10-26\",\"athlete\":{\"name\":\"Diego\",\"ftp_w\":245,\"run_threshold_pace\":\"4:35/km\"},\"races\":[{\"name\":\"IRONMAN 70.3\",\"date\":\"2027-04-18\",\"priority\":\"A\",\"weeks_to_race\":25}],\"planned_sessions\":[{\"id\":\"s_81\",\"date\":\"2026-10-27\",\"sport\":\"run\",\"title\":\"Rodaje Z2\",\"duration_min\":50}],\"busy_blocks\":[{\"start\":\"2026-10-27T09:00+01:00\",\"end\":\"2026-10-27T14:00+01:00\",\"label\":\"Clases\"}],\"life_events\":[{\"date\":\"2026-10-28\",\"type\":\"other_sport\",\"label\":\"Pádel 90 min intensidad alta\"}]}"}],
  "structuredContent":{"week_start":"2026-10-26","athlete":{"name":"Diego","ftp_w":245,"run_threshold_pace":"4:35/km"},"races":[{"name":"IRONMAN 70.3","date":"2027-04-18","priority":"A","weeks_to_race":25}],"planned_sessions":[{"id":"s_81","date":"2026-10-27","sport":"run","title":"Rodaje Z2","duration_min":50}],"busy_blocks":[{"start":"2026-10-27T09:00+01:00","end":"2026-10-27T14:00+01:00","label":"Clases"}],"life_events":[{"date":"2026-10-28","type":"other_sport","label":"Pádel 90 min intensidad alta"}]},
  "isError":false}}
```

Reglas: si hay `outputSchema`, `structuredContent` **debe** cumplirlo; por compatibilidad, incluir **también** el JSON serializado en un bloque `text`.

**5) Error de ejecución (recuperable por el modelo)** → resultado con `isError: true` y mensaje accionable:

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"La sesión s_999 no existe en la semana 2026-10-26. IDs válidos: s_81, s_82, s_85. Vuelve a llamar a get_planning_context con detail=\"detailed\" para ver todos."}],"isError":true}}
```

**6) Error de protocolo** (tool desconocida): `{"jsonrpc":"2.0","id":4,"error":{"code":-32602,"message":"Unknown tool: foo"}}`

**7) GET** → `HTTP/1.1 405 Method Not Allowed` + `Allow: POST`.

### A5.4 Mismo `tools/call` en era moderna (2026-07-28)

```http
POST /functions/v1/mcp HTTP/1.1
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_planning_context
Authorization: Bearer eyJ...

{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{
  "name":"get_planning_context","arguments":{"week_start":"2026-10-26"},
  "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
           "io.modelcontextprotocol/clientInfo":{"name":"claude-ai","version":"1.0.0"},
           "io.modelcontextprotocol/clientCapabilities":{}}}}
```

```json
{"jsonrpc":"2.0","id":7,"result":{"resultType":"complete",
  "content":[{"type":"text","text":"{...}"}],"structuredContent":{"week_start":"2026-10-26","planned_sessions":[]},
  "_meta":{"io.modelcontextprotocol/serverInfo":{"name":"tri-planner","version":"0.1.0"}}}}
```

`tools/list` moderno: añade `"resultType":"complete","ttlMs":300000,"cacheScope":"private"`.
`server/discover`: `{"resultType":"complete","supportedVersions":["2026-07-28","2025-11-25","2025-06-18","2025-03-26"],"capabilities":{"tools":{},"prompts":{}},"instructions":"…","_meta":{"io.modelcontextprotocol/serverInfo":{…}},"ttlMs":3600000,"cacheScope":"public"}`.

---

## A6. Implementación recomendada en Supabase Edge Functions

### A6.1 Estructura

```
supabase/
├── config.toml
└── functions/
    ├── _shared/
    │   ├── mcp-tools.ts         # definición de tools (independiente de la auth)
    │   ├── domain.ts            # consultas a BD (planes, carreras, eventos)
    │   └── origin.ts            # validación de Origin
    ├── mcp/                     # opción A (OAuth Supabase)
    │   ├── index.ts
    │   └── deno.json
    ├── mcp-token/               # opción B (URL secreta) — temporal
    │   ├── index.ts
    │   └── deno.json
    ├── ics/                     # feed iCal público con token (webcal://)
    ├── on-plan-change/          # webhook BD → push
    └── weekly-reminder/         # invocada por pg_cron
```

```toml
# supabase/config.toml (extracto)
[functions.mcp]
verify_jwt = false
[functions.mcp-token]
verify_jwt = false
[functions.ics]
verify_jwt = false
[functions.on-plan-change]
verify_jwt = false
[functions.weekly-reminder]
verify_jwt = false
# Las funciones llamadas por la app (p. ej. replan) quedan con verify_jwt = true (por defecto)
```

```json
// supabase/functions/mcp/deno.json
{
  "imports": {
    "@modelcontextprotocol/server": "npm:@modelcontextprotocol/server@^2.4.0",
    "@supabase/server": "npm:@supabase/server@^1.9.2",
    "@supabase/middleware": "npm:@supabase/middleware@^1.0.0",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2.118.0",
    "zod": "npm:zod@^4.6.0"
  }
}
```

Versiones npm a 2026-10-25: `@modelcontextprotocol/server` 2.4.0 (23-oct-2026), `@modelcontextprotocol/sdk` (v1) 1.32.2, `@supabase/server` 1.9.2, `@supabase/middleware` 1.0.0, `@supabase/supabase-js` 2.118.0, `@hono/mcp` 0.3.2 (ago-2026), `mcp-lite` 0.10.0 (**nov-2025, [POSIBLE OBSOLETO]** respecto a 2026-07-28), `@anthropic-ai/sdk` 1.3.0, `zod` 4.6.7.

### A6.2 Opción A: MCP con OAuth (esqueleto)

Adaptado de la guía oficial de Supabase (requiere `@supabase/server` ≥ 1.6.0 y Supabase CLI ≥ 2.117.0):

```ts
// supabase/functions/mcp/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { pipeline } from '@supabase/middleware'
import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
import { buildTriPlannerServer } from '../_shared/mcp-tools.ts'
import { rejectBadOrigin } from '../_shared/origin.ts'

const app = pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
  async (req, { supabase, userClaims }) => {
    if (req.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    }
    const bad = rejectBadOrigin(req)
    if (bad) return bad
    // Servidor nuevo por petición: Edge Functions no guardan estado
    const handler = createMcpHandler(
      () => buildTriPlannerServer({ db: supabase, userId: userClaims!.id }),
      { responseMode: 'json' },
    )
    return handler.fetch(req)
  },
)

Deno.serve(app)
```

> Nota: `withOAuthProtectedResource()` debe ir **antes** de la puerta de auth para servir el documento de metadatos y añadir `WWW-Authenticate` a los 401. Comprobar que el `GET …/mcp/oauth-protected-resource` siga funcionando si se añade el corte de `GET → 405` (colocar el 405 dentro del handler, como arriba, después del middleware) **[VERIFICAR]** en local con `curl`.

```ts
// supabase/functions/_shared/origin.ts
const ALLOWED = new Set(['https://claude.ai', 'https://claude.com'])
export function rejectBadOrigin(req: Request): Response | null {
  const origin = req.headers.get('origin')
  if (!origin || ALLOWED.has(origin)) return null
  console.warn('MCP origin no permitido', origin) // loguear antes de endurecer
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Forbidden origin' } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } })
}
```

```ts
// supabase/functions/_shared/mcp-tools.ts (forma; firmas de la guía de Supabase con SDK v2)
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

export function buildTriPlannerServer(ctx: { db: any; userId: string }) {
  const server = new McpServer(
    { name: 'tri-planner', version: '0.1.0' },
    // instructions: comprobar en la referencia del SDK v2 dónde se pasan [VERIFICAR]
  )

  server.registerTool(
    'get_planning_context',
    {
      title: 'Contexto para planificar la semana',
      description: 'Devuelve en una sola llamada … (ver catálogo §A7)',
      inputSchema: z.object({
        week_start: z.string().date().optional(),
        detail: z.enum(['concise', 'detailed']).default('concise'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ week_start, detail }) => {
      const data = await loadPlanningContext(ctx.db, week_start, detail) // RLS aplica
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
    },
  )
  // … resto de tools (§A7)
  return server
}
```

### A6.3 Opción B: URL personal secreta (esqueleto)

```sql
create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,          -- hex(sha256(token))
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.mcp_tokens enable row level security;
revoke all on table public.mcp_tokens from anon, authenticated;
grant select, delete on table public.mcp_tokens to authenticated;  -- el usuario ve/revoca los suyos
create policy "mis tokens" on public.mcp_tokens for select to authenticated using ((select auth.uid()) = user_id);
create policy "revocar mis tokens" on public.mcp_tokens for delete to authenticated using ((select auth.uid()) = user_id);
-- La creación la hace una Edge Function (genera 32 bytes aleatorios, guarda el hash, devuelve la URL una sola vez)
```

```ts
// supabase/functions/mcp-token/index.ts  (URL: /functions/v1/mcp-token/u/<token>)
import { withSupabase } from '@supabase/server'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { buildTriPlannerServer } from '../_shared/mcp-tools.ts'

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, { supabaseAdmin }) => {
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    const token = new URL(req.url).pathname.split('/u/')[1] ?? ''
    if (token.length < 40) return new Response('Not found', { status: 404 })
    const { data: row } = await supabaseAdmin.from('mcp_tokens')
      .select('id,user_id').eq('token_hash', await sha256Hex(token)).is('revoked_at', null).maybeSingle()
    if (!row) return new Response('Not found', { status: 404 })
    EdgeRuntime.waitUntil(supabaseAdmin.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id))
    // OJO: supabaseAdmin salta RLS → TODAS las consultas de dominio deben filtrar por userId
    const handler = createMcpHandler(() => buildTriPlannerServer({ db: supabaseAdmin, userId: row.user_id }), { responseMode: 'json' })
    return handler.fetch(req)
  }),
}
```

Para que la capa de dominio sea segura en ambos modos, escribirla **siempre** con `.eq('user_id', ctx.userId)` explícito (aunque en modo A también lo haga RLS): mejora además el plan de consulta (ver §B4).

### A6.4 Alternativas de framework

| Opción | Pros | Contras |
|--------|------|---------|
| `@modelcontextprotocol/server` v2 + `createMcpHandler` | Oficial, estable, spec 2026-07-28 + clientes 2025, ejemplo oficial en Supabase | No valida Host/Origin (hay que añadirlo); la autenticación la pones tú (o `@supabase/server`). |
| `@modelcontextprotocol/sdk` v1 (`StreamableHTTPServerTransport`, `sessionIdGenerator: undefined`, `enableJsonResponse: true`) | Muy probado con Claude en 2025 | Línea anterior; `createMcpExpressApp()` trae protección DNS-rebinding que da `403 Invalid Host` con túneles (pasar `allowedHosts`). |
| `mcp-lite` 0.10 + Hono (ejemplo oficial Supabase) | Cero dependencias, ligero | Última versión nov-2025 → probablemente solo era legacy **[POSIBLE OBSOLETO]**; patrón "dos apps Hono" por el prefijo `/<función>/*`. |
| `@hono/mcp` 0.3.2 | Integración Hono | Verificar soporte dual-era **[VERIFICAR]**. |
| A mano (~150 líneas) | Control total; trivial con 5 tools y respuestas JSON | Hay que mantener tú la negociación de versión y el formato moderno. Tablas §A5 suficientes. |

---

## A7. Diseño de tools para que Claude planifique bien

Principios (Anthropic, [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), sep-2025, + criterios de [review](https://claude.com/docs/connectors/building/review-criteria.md)):

1. **Pocas tools gruesas orientadas a tareas**, no un espejo del API REST (ej.: una `get_planning_context` en vez de `list_races` + `list_sessions` + `list_events` + `get_profile`).
2. **Separar lectura y escritura** (requisito de review: nada de `api_request` con `method`). Idealmente separar escrituras por tipo (crear / modificar / cancelar).
3. **Descripciones como para un compañero nuevo**: qué hace, cuándo usarla, formatos (ISO 8601, `Europe/Madrid`, minutos, zonas 1-5, RPE 1-10). Parámetros sin ambigüedad (`week_start`, `session_id`, no `week`, `id`).
4. **Describir, no ordenar**: las descripciones no deben dar órdenes de comportamiento ni pedir llamar a otras herramientas no solicitadas (patrón de *prompt injection* rechazado en review). Lo contextual va en `instructions` del servidor, de forma descriptiva.
5. **Respuestas con señal**: nombres legibles además de IDs; parámetro `detail: concise|detailed`; paginar/truncar y decir cómo acotar. Objetivo < ~10k tokens por respuesta (límite duro ~150k caracteres).
6. **Errores accionables** (`isError: true` con qué falló y cómo corregirlo, ver ejemplo §A5.3). Nunca "Internal Server Error" a secas.
7. **Annotations correctas**: lectura → `readOnlyHint: true` (Claude puede ejecutarla sin pedir permiso cada vez); modificar/cancelar → `destructiveHint: true` (siempre pide confirmación). Recordatorio de valores por defecto del spec: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=false`, `openWorldHint=true` → declararlos explícitamente.
8. **Escrituras idempotentes y reversibles**: las tools escriben **propuestas versionadas** (`plan_versions`, `status='proposed'`), la app muestra el *diff* y el usuario acepta → notificación push. Evita que un error de Claude destruya el plan.
9. **Orden determinista** en `tools/list` (mejora caché del cliente y prompt caching).
10. **`outputSchema` + `structuredContent`** en las de lectura; texto con el mismo JSON.

### Catálogo propuesto (5 tools + 1 prompt)

| Tool | Tipo | Annotations | Entrada (resumen) | Salida |
|------|------|-------------|-------------------|--------|
| `get_planning_context` | Lectura | `readOnlyHint: true`, `openWorldHint: false` | `week_start?`, `detail?` | Perfil (deportes, umbrales FTP/CSS/ritmo, zonas), carreras (A/B/C, semanas a carrera), plan de la semana, sesiones completadas últimos 14 días (de Garmin), bienestar (HRV, sueño, body battery, readiness si se sincroniza), `busy_blocks` (clases/trabajo), imprevistos, sesiones de amigos compatibles, notas de nutrición. |
| `find_joint_sessions` | Lectura | `readOnlyHint: true` | `date_from`, `date_to`, `sport?`, `friend_ids?` | Huecos/sesiones compatibles con amigos (respetando su nivel de compartición: "ocupado" vs "detalle"). |
| `log_life_event` | Escritura aditiva | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true` (con `client_ref`) | `type` (`other_sport`/`injury`/`overload`/`illness`/`work`/`stress`/`travel`/`sleep`), `start`, `end?`, `intensity_rpe?`, `body_area?`, `notes`, `client_ref?` | Evento creado + impacto sugerido (sesiones afectadas). |
| `propose_week_plan` | Escritura (nueva versión) | `destructiveHint: false` (crea versión `proposed`, no pisa) | `week_start`, `rationale`, `sessions[]` (fecha, hora opcional, `sport`, `title`, `duration_min`, `intensity` zona/RPE, `structure` texto/estructurado, `with_friends?`) | `plan_version_id`, diff vs plan vigente, enlace profundo a la app para aceptar. |
| `modify_sessions` | Escritura | `destructiveHint: true` | `changes[]` con `op` ∈ `move`/`edit`/`cancel` + `session_id` + campos; `reason` | Resumen de cambios aplicados o propuestos. (Si se quiere "solo propuestas", que también cree versión.) |

**Prompt MCP** `replanificar_semana` (argumentos: `motivo`): plantilla que el usuario puede elegir en Claude para arrancar el flujo ("tengo pádel el miércoles y molestia en el gemelo…"). Los prompts aparecen en el menú del conector en claude.ai **[VERIFICAR presentación exacta]**.

**`instructions` del servidor** (corto y descriptivo): qué datos hay, convenciones de unidades/zona horaria, que los planes se guardan como propuesta pendiente de aceptación, y que los datos de Garmin en nuestra BD pueden ir con retraso respecto al conector de Garmin del usuario (si lo tiene).

**Enumeraciones** (`sport`): `swim`, `bike`, `run`, `brick`, `strength`, `mobility`, `rest`, `other`. Zonas: 1-5 + RPE 1-10 para que Claude no invente escalas.

---

## A8. Pruebas y diagnóstico

1. **Local** (requiere Docker para `supabase functions serve`): `supabase start && supabase functions serve mcp`; `curl` de `initialize` sin token debe dar `401` + `www-authenticate: Bearer resource_metadata="…/mcp/oauth-protected-resource"`.
2. **MCP Inspector**: `npx -y @modelcontextprotocol/inspector` (UI) o `npx @modelcontextprotocol/inspector --cli <url> --transport http --method tools/list`.
3. **Claude Code** contra local: `claude mcp add --transport http tri http://127.0.0.1:54321/functions/v1/mcp` y `/mcp` para autenticar.
4. **claude.ai**: no llega a `localhost` → probar contra el proyecto remoto (lo más simple en Windows sin Docker) o un túnel (`cloudflared tunnel --url …`).
5. Errores típicos y causa:
   - *"Couldn't reach the MCP server"*: DNS privado/IPv6-only, WAF, discovery 404 (falta `resource_metadata` en el 401), o `verify_jwt = true` en la función.
   - *"Authorization with the MCP server failed"*: `issuer` que no coincide, `resource`/`aud` mal, token endpoint lento (>10 s), redirección a otro host.
   - *"Unexpected error while invoking tool"*: la tool devolvió error; comparar con Inspector y logs.
   - Copiar el `ofid_…` de la URL de error y reportar en [anthropics/claude-ai-mcp](https://github.com/anthropics/claude-ai-mcp/issues).
6. El discovery OAuth de Claude se cachea ~5 min por URL: tras cambiar `scopes_supported` u otros metadatos, esperar.

---

# PARTE B — Supabase como backend (2026)

## B1. Edge Functions (Deno 2): estructura, dependencias, CORS

- Runtime Deno 2 (`[edge_runtime] deno_version = 2`). Punto de entrada `index.ts` con `Deno.serve(handler)` o `export default { fetch }` (la doc 2026 usa ambos).
- **Dependencias**: `npm:` (recomendado), `jsr:`, `node:` built-ins. **Un `deno.json` por función** (recomendado para despliegue; el global en `supabase/functions/` solo para dev). `import_map.json` = legado; si coexisten gana `deno.json` ([Managing dependencies](https://supabase.com/docs/guides/functions/dependencies)).
- Subpaths npm en import map: mapear con barra final, p. ej. `"@anthropic-ai/sdk/": "npm:/@anthropic-ai/sdk@1.3.0/"`, o importar directamente `npm:@anthropic-ai/sdk@1.3.0/helpers/zod`.
- Código compartido en `supabase/functions/_shared/` (las carpetas con `_` no se despliegan como función).
- Enrutado: todas las peticiones llegan a `/<nombre-función>/*` → con Hono hay que montar la app bajo `/<nombre>`.
- **CORS** (solo para llamadas desde navegador; la app RN nativa no lo necesita): `withSupabase` gestiona `OPTIONS` y cabeceras; sin él, importar `corsHeaders` de `npm:@supabase/supabase-js@^2/cors` (≥ 2.95.0) y responder al preflight ([CORS](https://supabase.com/docs/guides/functions/cors)).
- **Tareas en segundo plano**: `EdgeRuntime.waitUntil(promise)`; evento `beforeunload` para guardar progreso. Límite = wall-clock/CPU/memoria. En local, `[edge_runtime] policy = "per_worker"` para que no maten el worker al responder ([Background tasks](https://supabase.com/docs/guides/functions/background-tasks)).
- **No** se puede servir HTML en `*.supabase.co` (se reescribe a `text/plain`). `text/calendar` (ICS) y JSON sí.

## B2. Autenticación: claves nuevas, JWT asimétricos y `verify_jwt`

### Claves de API ([API keys](https://supabase.com/docs/guides/api/api-keys))

| Clave | Formato | Dónde | Notas |
|-------|---------|-------|-------|
| Publishable | `sb_publishable_…` | App Expo, web de consentimiento | Pública; acceso limitado por RLS. |
| Secret | `sb_secret_…` | Edge Functions, cron, scripts | Salta RLS. Supabase la **bloquea en navegadores** (401 por `User-Agent`). Pueden existir varias con nombre (`default`, `automations`…). |
| `anon` / `service_role` (legado, JWT) | `eyJ…` | — | **Deprecadas para finales de 2026**. No usar en código nuevo; en el runtime siguen existiendo `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, pero llevan las claves legado. |

- Las claves nuevas **no son JWT**: enviarlas en el header **`apikey`**, nunca como `Authorization: Bearer`. `Authorization` se reserva para el JWT del usuario.
- Variables inyectadas en Edge Functions: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` y `SUPABASE_SECRET_KEYS` (JSON con claves por nombre), `SUPABASE_JWKS`. Nombres propios de secretos **no** pueden empezar por `SUPABASE_`.

### JWT signing keys ([Signing keys](https://supabase.com/docs/guides/auth/signing-keys), [JWTs](https://supabase.com/docs/guides/auth/jwts))

- Recomendado **ES256** (P-256). JWKS público en `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` (vacío si el proyecto sigue con secreto HS256).
- Migración sin downtime: *Migrate JWT secret* → crear clave standby ES256 → rotar → esperar expiración de tokens (≥ 1 h 15 min con expiración de 1 h) → revocar el secreto legado (exige desactivar antes `anon`/`service_role`).
- **`supabase.auth.getClaims(jwt)`**: verifica la firma localmente contra el JWKS (rápido, sin red tras cachear) cuando la clave es asimétrica; con HS256 recurre al servidor de Auth. **`supabase.auth.getUser(jwt)`** siempre consulta Auth (detecta sesiones cerradas/usuarios borrados). Usar `getClaims` en el camino caliente y `getUser` cuando la revocación inmediata importe.

### `verify_jwt` y `@supabase/server` ([Securing Edge Functions](https://supabase.com/docs/guides/functions/auth), [Authorization headers](https://supabase.com/docs/guides/functions/auth-headers))

- `verify_jwt` (por defecto `true`) es un chequeo de la **plataforma** antes de tu código: valida JWT HS256 legado **y** asimétricos. Por compatibilidad también deja pasar claves `sb_*` en cualquier header → **no autentica por sí solo** a quien manda solo una API key.
- `withSupabase({ auth })` (de `npm:@supabase/server@1`) da `ctx.supabase` (con RLS del usuario), `ctx.supabaseAdmin` (salta RLS), `ctx.userClaims`, `ctx.jwtClaims`, `ctx.authMode`. Modos:

| Modo | Acepta | Uso en nuestro proyecto | `verify_jwt` |
|------|--------|-------------------------|--------------|
| `'user'` | JWT de usuario válido en `Authorization` | Funciones llamadas desde la app con `supabase.functions.invoke` (p. ej. `replan`, `create-mcp-token`) | `true` |
| `'secret'` / `'secret:<nombre>'` / `'secret:*'` | Secret key en `apikey` | Llamadas desde `pg_cron`/`pg_net`/Database Webhooks | `false` |
| `'publishable'` | Publishable key en `apikey` | Poco útil (es pública) | — |
| `'none'` | Cualquiera | MCP con token en URL, ICS con token, webhooks externos con firma propia | `false` |
| `['user','secret']` | El primero que encaje | Función usable por app y por cron | `false` |

- Para 401 personalizados: `createSupabaseContext(req, { auth: 'user' })` devuelve `{ data, error }`.
- **Peligro clásico**: consultar con `ctx.supabaseAdmin` sin filtrar por el ID del llamante devuelve filas de todos.

## B3. Despliegue desde Windows sin Docker y secretos

```bash
npm i -D supabase            # o scoop; usar con npx supabase …   (CLI ≥ 2.117.0 para la guía MCP)
npx supabase login
npx supabase link --project-ref <ref>
npx supabase config push      # sube [auth], [auth.oauth_server], etc. del config.toml
npx supabase db push          # migraciones
npx supabase functions deploy mcp --use-api      # bundling en servidor, sin Docker
npx supabase functions deploy --use-api          # todas
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... EXPO_ACCESS_TOKEN=...
npx supabase secrets set --env-file ./supabase/.env.production
npx supabase secrets list
```

- `--use-api` existe desde CLI 2.13.3 (feb-2025); la CLI cae a API si no hay Docker ([changelog](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory)). Límite de función: 20 MB con bundling local / **5 MB con bundling en servidor**; con `--use-api` **no** se pueden desplegar ficheros estáticos.
- `supabase functions serve` (local) **sí necesita Docker**. Alternativa en Windows: un segundo proyecto Free como "staging" y probar en remoto.
- Secretos: disponibles al instante sin redeploy; máx. 100 por proyecto, 48 KiB cada uno. Local: `supabase/functions/.env` (en `.gitignore`).
- CI: `supabase/setup-cli@v1` + `supabase functions deploy --project-ref $PROJECT_ID` con `SUPABASE_ACCESS_TOKEN`.

## B4. Postgres: RLS (buenas prácticas y rendimiento)

Fuentes: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security-performance).

Checklist por tabla del esquema expuesto (`public`):

1. `alter table … enable row level security;`
2. `revoke all on table … from anon, authenticated;` y luego `grant` solo lo necesario (en proyectos que aún conceden por defecto, las políticas **no** quitan esos grants).
3. Una política por operación, siempre con `to authenticated` (evita evaluar para `anon`).
4. Envolver funciones en subselect: `(select auth.uid())` → Postgres lo evalúa una vez por sentencia (*initPlan*) en vez de por fila.
5. **Índice** en cada columna que filtra la política (columna líder de un btree; una PK compuesta `(team_id, user_id)` no indexa `user_id`).
6. **Evitar joins con la tabla origen** dentro de la política: traer el conjunto (`col in (select …)`) o usar una función `security definer`.
7. Funciones `security definer` en un esquema **no expuesto** (`private`), con **`set search_path = ''`** y nombres totalmente cualificados.
8. Vistas: `with (security_invoker = true)` (PG ≥ 15) o fuera del esquema expuesto.
9. Filtrar también en la query del cliente (`.eq('user_id', uid)`) aunque lo haga la política: mejor plan.
10. Tests de políticas con pgTAP: `supabase test new x_rls.test` + `supabase test db`.

Ejemplo de nuestro dominio (calendario compartido con amigos):

```sql
create schema if not exists private;
grant usage on schema private to authenticated;

create table public.friendships (
  user_id    uuid not null references auth.users(id) on delete cascade,  -- quien comparte
  friend_id  uuid not null references auth.users(id) on delete cascade,  -- quien puede ver
  status     text not null check (status in ('pending','accepted')),
  share_level text not null default 'busy' check (share_level in ('busy','details')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);
create index friendships_friend_id_idx on public.friendships (friend_id);

create table public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  starts_on date not null,
  start_time time,
  sport text not null,
  title text not null,
  duration_min int not null check (duration_min between 0 and 900),
  intensity jsonb,
  status text not null default 'planned' check (status in ('planned','proposed','done','cancelled')),
  plan_version_id uuid,
  updated_at timestamptz not null default now()
);
create index planned_sessions_user_date_idx on public.planned_sessions (user_id, starts_on);

-- Conjunto de usuarios cuyo calendario puede ver el llamante (se evalúa una vez por sentencia)
create or replace function private.visible_owner_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid())
  union
  select f.user_id from public.friendships f
  where f.friend_id = (select auth.uid()) and f.status = 'accepted'
$$;
revoke all on function private.visible_owner_ids() from public;
grant execute on function private.visible_owner_ids() to authenticated;

alter table public.planned_sessions enable row level security;
revoke all on table public.planned_sessions from anon, authenticated;
grant select, insert, update, delete on table public.planned_sessions to authenticated;

create policy "leer propias y de amigos" on public.planned_sessions
  for select to authenticated
  using ( user_id in (select private.visible_owner_ids()) );

create policy "insertar propias" on public.planned_sessions
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "editar propias" on public.planned_sessions
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "borrar propias" on public.planned_sessions
  for delete to authenticated
  using ( (select auth.uid()) = user_id );
```

Nivel "solo ocupado" (`share_level = 'busy'`): exponer a amigos una **vista** `security_invoker` o una RPC que devuelva solo `starts_on/start_time/duration_min/sport`, en vez de la tabla completa.

Datos de salud (HRV, sueño, lesiones) en tablas aparte **sin** política de amigos.

## B5. Realtime `postgres_changes` con RLS

Fuente: [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), [Realtime limits](https://supabase.com/docs/guides/realtime/limits).

```sql
alter publication supabase_realtime add table public.planned_sessions, public.plan_versions;
-- Solo si se necesita el registro anterior en UPDATE/DELETE:
-- alter table public.planned_sessions replica identity full;
```

```ts
// App (supabase-js v2): el JWT del usuario se adjunta solo al canal
supabase.channel('mi-semana')
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'planned_sessions', filter: `user_id=eq.${uid}` },
      (payload) => queryClient.invalidateQueries({ queryKey: ['week'] }))
  .subscribe()
// Amigos: filter: `user_id=in.(${friendIds.join(',')})`  (operadores: eq, neq, lt, lte, gt, gte, in, like, ilike, is, …)
```

- RLS se aplica **por evento y por suscriptor** (100 suscriptores = 100 comprobaciones); el procesado es **mono-hilo**. Con 2-10 usuarios es irrelevante, pero mantener políticas baratas e indexadas.
- **Los DELETE no pasan RLS** (Postgres no puede comprobar acceso a una fila borrada) y solo se filtran con `replica identity full` → **usar borrado lógico** (`status='cancelled'`) y no escuchar DELETE.
- `select` de columnas concretas reduce payload (requiere `schema` + `table` explícitos).
- Para escalar más adelante: *Broadcast from Database* en canales privados.
- Free: 200 conexiones concurrentes, 100 msg/s, 2 M mensajes/mes.

## B6. `pg_cron` + `pg_net` + Vault, y Database Webhooks

Fuentes: [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Database Webhooks](https://supabase.com/docs/guides/database/webhooks), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).

**Una vez por proyecto (fuera de migraciones, en SQL Editor):**

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('sb_secret_XXXXXXXX', 'secret_key');
```

**Cron (domingo 17:00 UTC ≈ 18:00/19:00 en Madrid según horario de verano; pg_cron va en UTC):**

```sql
select cron.schedule(
  'weekly-plan-reminder',
  '0 17 * * 0',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/weekly-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
    ),
    body := jsonb_build_object('job', 'weekly-plan-reminder', 'at', now()),
    timeout_milliseconds := 5000
  ) as request_id;
  $$
);
-- Gestión: select * from cron.job;  select * from cron.job_run_details order by start_time desc limit 20;
-- select cron.unschedule('weekly-plan-reminder');
```

**Trigger tipo "Database Webhook" (cambio de plan → push), en migración, leyendo secretos de Vault:**

```sql
create or replace function public.notify_plan_change()
returns trigger
language plpgsql
security definer          -- los roles que insertan (authenticated) no pueden leer Vault
set search_path = ''
as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/on-plan-change',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
    ),
    body := jsonb_build_object(
      'type', tg_op, 'table', tg_table_name, 'schema', tg_table_schema,
      'record', to_jsonb(new), 'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end
    )
  );
  return new;
end;
$$;

create trigger plan_versions_notify
after insert or update of status on public.plan_versions
for each row execute function public.notify_plan_change();
```

La función receptora: `verify_jwt = false` + `withSupabase({ auth: 'secret' })`.

Avisos:

- `pg_net` es **asíncrono**; `timeout_milliseconds` por defecto **2000 ms**; respuestas en `net._http_response` durante **6 h**; pensado para ≤ **200 req/s**. Si el timeout corta, la Edge Function debería responder rápido y seguir con `EdgeRuntime.waitUntil` **[VERIFICAR]** si la función continúa tras cerrar el cliente.
- Mientras la petición está en cola, la secret key descifrada queda en `net.http_request_queue` y la puede leer cualquier rol con login a la BD.
- Alternativa desde Dashboard (*Integrations > Database Webhooks* → tipo *Supabase Edge Functions* → *Add secret key*): más cómodo, pero la clave queda en la definición del trigger (aparece en dumps).
- Payload estándar: `{ type, table, schema, record, old_record }`.

## B7. Anthropic API desde Deno (Edge Functions)

Para la función opcional "Replanificar en la app" (API key del desarrollador o BYOK). **No** sirve para usar la suscripción claude.ai del usuario (§A1).

- SDK: `npm:@anthropic-ai/sdk@^1.3.0` (línea 1.x, oct-2026; `zod` 3.25+/4 como peer para los helpers). Funciona en Deno vía `npm:`.
- Modelos y precios (USD por millón de tokens, entrada/salida, caché a 2026-10): **`claude-opus-5-5` 4/20 (modelo por defecto)**, `claude-sonnet-5-5` 2/10, `claude-haiku-5-5` 0,10/0,50. Elegir modelo es decisión de producto; medir calidad vs latencia con el límite de 150 s.
- Particularidades de `claude-opus-5-5`: el *thinking* es adaptativo y **no se puede desactivar**; la profundidad se controla con `output_config.effort` (`low`…`max`, **por defecto `medium`**). **`tool_choice` forzado (`any`/`tool`) devuelve 400** → para obtener JSON usar **structured outputs** (`output_config.format`). Sin *prefill* de assistant. Parámetros `temperature/top_p/top_k` rechazados.
- **Límites Edge**: wall-clock **150 s Free / 400 s de pago**; **idle timeout 150 s** (si no se envía respuesta → 504); CPU 2 s (no cuenta la espera de red); 256 MB.
- Patrón recomendado (no bloquear la petición HTTP):
  1. App → `POST /functions/v1/replan` (JWT usuario) → inserta `plan_jobs(status='running')` → responde **202** con `job_id`.
  2. `EdgeRuntime.waitUntil(runClaude(job))` con **streaming** + `finalMessage()`, timeout del SDK ~120 s y `maxRetries: 0`–`1` para no pasar del wall-clock.
  3. Guarda el resultado como `plan_versions(status='proposed')` → Realtime/push avisan a la app.
- Prompt caching (`cache_control` top-level) para el bloque estable (perfil del atleta, reglas de periodización).
- *Fallbacks* por rechazo de seguridad: en `claude-opus-5-5` se puede activar `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) vía `client.beta.messages`; comprobar siempre `stop_reason === 'refusal'`.
- Alternativa barata y asíncrona para la generación del plan del domingo: **Message Batches** (50 % de coste, resultados en minutos-horas) disparado por `pg_cron` y recogido por otro cron.
- El "MCP connector" de la Messages API (`mcp_servers` + `mcp_toolset`, beta `mcp-client-2025-11-20`) no hace falta: el backend lee la BD directamente.

```ts
// supabase/functions/replan/index.ts (esqueleto; verify_jwt = true)
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.3.0/helpers/zod'
import { z } from 'npm:zod@^4.6.0'
import { withSupabase } from 'npm:@supabase/server@^1.9.2'

const WeekPlan = z.object({
  week_start: z.string(),
  rationale: z.string(),
  sessions: z.array(z.object({
    date: z.string(), sport: z.enum(['swim','bike','run','brick','strength','mobility','rest','other']),
    title: z.string(), duration_min: z.number().int(), intensity_zone: z.number().int().min(1).max(5).nullable(),
    structure: z.string(), with_friend_ids: z.array(z.string()),
  })),
})

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), timeout: 120_000, maxRetries: 0 })

async function runClaude(jobId: string, context: unknown, admin: any) {
  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      cache_control: { type: 'ephemeral' },
      system: 'Eres un entrenador de triatlón… (reglas de periodización, seguridad ante lesiones)…',
      output_config: { effort: 'medium', format: zodOutputFormat(WeekPlan) },
      messages: [{ role: 'user', content: `Contexto JSON:\n${JSON.stringify(context)}\nReplanifica la semana.` }],
    })
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') throw new Error('refusal')
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    const plan = WeekPlan.parse(JSON.parse(text))
    await admin.from('plan_jobs').update({ status: 'done', result: plan }).eq('id', jobId)
  } catch (e) {
    await admin.from('plan_jobs').update({ status: 'error', error: String(e) }).eq('id', jobId)
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, { supabase, supabaseAdmin, userClaims }) => {
    const { week_start } = await req.json()
    const context = await loadPlanningContext(supabase, week_start)          // RLS
    const { data: job } = await supabase.from('plan_jobs')
      .insert({ user_id: userClaims!.id, week_start, status: 'running' }).select('id').single()
    EdgeRuntime.waitUntil(runClaude(job!.id, context, supabaseAdmin))
    return Response.json({ job_id: job!.id }, { status: 202 })
  }),
}
```

(`loadPlanningContext` es la misma función de dominio que usa la tool MCP `get_planning_context`: un único "contexto" para ambos caminos.)

## B8. Límites del plan Free relevantes (2-10 usuarios)

Fuentes: [Billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Edge limits](https://supabase.com/docs/guides/functions/limits), [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

| Recurso | Free | Pro (25 $/mes por org + cómputo) | ¿Nos afecta? |
|---------|------|----------------------------------|--------------|
| Proyectos activos | 2 gratis | Sin pausa | Usar uno como prod y otro como staging. |
| **Pausa por inactividad** | Si no hay actividad de BD suficiente durante **7 días** (aviso por email antes; restaurable hasta 1 año) | No se pausa | **Sí, principal riesgo** en semanas sin uso (vacaciones, lesión). Mitigar: uso real diario de la app + ping diario externo (p. ej. GitHub Actions que haga una consulta REST con escritura) **[VERIFICAR qué cuenta como actividad]**. |
| Tamaño BD | 500 MB | 8 GB | No (series de Garmin agregadas por día ocupan poco; evitar guardar FIT crudos en BD). |
| Storage | 1 GB | 100 GB | Bajo. |
| Egress | 5 GB | 250 GB | No. |
| MAU Auth | 50.000 | 100.000 | No. Los logins OAuth de Claude cuentan como MAU del mismo usuario. |
| Edge Function invocaciones | 500.000/mes | 2 M | No (MCP: ~10-50 llamadas por conversación de planificación). |
| Edge wall-clock / idle / CPU / RAM | **150 s** / 150 s / 2 s / 256 MB | **400 s** / 150 s / 2 s / 256 MB | Solo para llamadas largas a Claude API (§B7). |
| Nº funciones | 100 | 1000 | No. |
| Realtime | 200 conexiones, 100 msg/s, 2 M msg/mes | 500 conexiones, 500 msg/s, 5 M | No. |
| `pg_net` | ≤ 200 req/s recomendado | igual | No. |
| OAuth 2.1 Server | Beta, todos los planes, sin coste | igual | Sí (beta). |
| Dominio propio / HTML en Edge | No | Add-on de pago | Página de consentimiento fuera de Supabase. |

---

## B9. Riesgos abiertos y cosas a verificar antes de codificar

1. **Versión MCP que habla hoy claude.ai** (legacy vs 2026-07-28): servidor dual-era y log de las primeras peticiones.
2. **OAuth Server de Supabase en beta** + DCR con Claude: probar el flujo completo con vuestra cuenta Pro el primer día; si falla, A' (cliente pre-registrado en *Advanced settings*) o Plan B.
3. **CIMD no soportado por Supabase Auth** (no documentado): instruir "Register automatically".
4. **`withOAuthProtectedResource` + corte de `GET`**: confirmar en local que el documento de metadatos se sigue sirviendo.
5. **Origin**: loguear qué `Origin` (si alguno) envía Claude antes de bloquear.
6. **Pausa del proyecto Free**: decidir si se acepta el riesgo o se paga Pro desde el lanzamiento en TestFlight.
7. **Plan claude.ai Free**: solo 1 custom connector; confirmar que ambos tenéis Pro/Max o que el de Garmin no es custom.
8. **Alta del conector desde iOS**: la doc solo describe web/escritorio; documentar en onboarding "añádelo una vez desde claude.ai en el navegador".
9. **Sign in with Apple**: si la app ofrece login social de terceros, App Store exige también Sign in with Apple; con solo email OTP no. La página de consentimiento web debe soportar el mismo método de login que la app.
10. `mcp-lite` y guías de 2025 pueden estar obsoletas frente a 2026-07-28.

---

## Fuentes

**Claude / Anthropic**
- [Build an MCP server for Claude](https://claude.com/docs/connectors/building/index.md) — transportes, límites (150k caracteres, 240 s), features no soportadas.
- [Authentication for connectors](https://claude.com/docs/connectors/building/authentication.md) — tipos de auth, DCR/CIMD, callback, PKCE, refresh, latencias, IP `160.79.104.0/21`.
- [Lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication.md) — forma del 401, metadatos RFC 9728/8414, CIMD, step-up 403, caché de discovery.
- [Troubleshoot your connector](https://claude.com/docs/connectors/building/troubleshooting.md) · [Test your connector](https://claude.com/docs/connectors/building/testing.md) · [Pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria.md)
- [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted.md) · [Get started with connectors](https://claude.com/docs/connectors/getting-started.md)
- [Bringing MCP 2026-07-28 to Claude](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude) (2026-07-28)
- [Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (2025-09-11)
- [Claude Code – Legal and compliance (auth y credenciales)](https://code.claude.com/docs/en/legal-and-compliance) · [WinBuzzer, feb-2026](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Anthropic IP addresses](https://platform.claude.com/docs/en/api/ip-addresses) · [Issues claude-ai-mcp](https://github.com/anthropics/claude-ai-mcp/issues) · [claude-code #84609](https://github.com/anthropics/claude-code/issues/84609)

**MCP spec**
- [Versioning (actual: 2026-07-28)](https://modelcontextprotocol.io/docs/learn/versioning) · [Versioning & backward compatibility 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning.md)
- [Streamable HTTP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.md) · [Changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog.md) · [server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [Transports 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) · [Lifecycle 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) · [Tools 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [TypeScript SDK v2 – Serving over HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http) · [npm @modelcontextprotocol/server](https://www.npmjs.com/package/@modelcontextprotocol/server)
- [blog.mcpservers.org – resumen 2026-07-28](https://blog.mcpservers.org/posts/mcp-spec-2026-07-28) (secundaria)

**Supabase**
- [Deploy MCP servers (BYO MCP)](https://supabase.com/docs/guides/ai-tools/byo-mcp) · [MCP server con mcp-lite](https://supabase.com/docs/guides/functions/examples/mcp-server-mcp-lite)
- [OAuth 2.1 Server – Getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started) · [MCP Authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) · [Token security & RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth) · [Authorization headers / verify_jwt](https://supabase.com/docs/guides/functions/auth-headers) · [Function configuration](https://supabase.com/docs/guides/functions/function-configuration)
- [Managing dependencies](https://supabase.com/docs/guides/functions/dependencies) · [CORS](https://supabase.com/docs/guides/functions/cors) · [Deploy](https://supabase.com/docs/guides/functions/deploy) · [Secrets](https://supabase.com/docs/guides/functions/secrets) · [Limits](https://supabase.com/docs/guides/functions/limits) · [Background tasks](https://supabase.com/docs/guides/functions/background-tasks)
- [CLI functions deploy](https://supabase.com/docs/reference/cli/supabase-functions-deploy) · [Changelog deploy sin Docker](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory)
- [API keys](https://supabase.com/docs/guides/api/api-keys) · [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys) · [JWTs](https://supabase.com/docs/guides/auth/jwts)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) · [RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security-performance)
- [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) · [Database Webhooks](https://supabase.com/docs/guides/database/webhooks) · [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Billing / quotas](https://supabase.com/docs/guides/platform/billing-on-supabase) · [Edge Function invocations](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations) · [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)

**Otros**
- [Zapier MCP + Anthropic API (URL como secreto)](https://zapier.com/blog/zapier-mcp-anthropic-api) · [BookingSync 4.16.0 (`?token=` legado)](https://developers.bookingsync.com/changelog/2026/07/29/version-4-16-0)
- Registro npm consultado el 2026-10-25 para versiones de paquetes.
