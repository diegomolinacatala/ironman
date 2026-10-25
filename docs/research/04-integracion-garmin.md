# 04 · Integración con Garmin (y alternativas)

> **Fecha de la investigación:** 25-oct-2026
> **Alcance:** cómo obtener datos de Garmin (salud, recuperación, actividades) en una app iOS (Expo/React Native + Supabase) para 2 usuarios aficionados (más algunos amigos después) y, si es posible, **enviar entrenamientos planificados al reloj**.
> **Aviso de vigencia:** el ecosistema Garmin ha cambiado **cuatro días antes** de esta investigación (reapertura del programa de desarrolladores el 21-oct-2026). Todo lo marcado con ⚠️ debe re-verificarse antes de implementar.

---

## 0. TL;DR: decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Solicitar YA el tier "Starter" del Garmin Connect Developer Program** (gratis, ≤1.000 usuarios, incluye **Training API** para empujar entrenos al reloj). | Es la vía oficial, gratuita y pensada para "individual developers, startups". Es la única forma oficial y estable de escribir entrenos en el calendario de Garmin Connect. Reabierto el 21-oct-2026. |
| D2 | **Día 1 (sin aprobaciones): "Claude como puente" + Garmin Personal API + HealthKit.** | Ninguna requiere aprobación. El Claude de cada usuario ya lee Garmin (Training Readiness, HRV, Body Battery…) y puede volcar un *snapshot* en nuestra app vía **nuestro propio servidor MCP**. La Personal API (oficial, clave por usuario) da datos diarios automáticos. HealthKit da actividades/sueño en el dispositivo. |
| D3 | **Empuje de entrenos al reloj antes de tener Starter:** vía **el propio Claude del usuario** (conector Garmin comunitario con `upload_workout`/`schedule_workout`) o vía **intervals.icu** (escribimos en su calendario; intervals.icu sube a Garmin los próximos ~7 días). | La Personal API es **solo lectura**. La escritura oficial requiere Starter. |
| D4 | **NO usar Strava** como fuente. | Desde el 1-jun-2026 su política prohíbe usar datos de la API en **cualquier** aplicación de IA (incluido meterlos en el contexto de un LLM) y mostrar datos de un usuario a otros. Choca con las dos ideas centrales de la app. |
| D5 | **NO usar agregadores** (Terra, ROOK, Spike, Thryve, Junction) en el MVP. | Mínimos de ~300–500 USD/mes; además Garmin está endureciendo el reenvío de datos a terceros ("downstream"). |
| D6 | **NO ejecutar librerías no oficiales (python-garminconnect/garth) en nuestro backend** ni pedir credenciales de Garmin a los usuarios. | Cloudflare bloquea clientes no-navegador e IPs de datacenter, bloqueos 429/427 a nivel de cuenta, ToS de Garmin prohíbe acceso automatizado, y como licenciatarios (Starter) la cláusula 15.8 prohíbe pedir credenciales de Garmin. |
| D7 | **Diseñar capa de adaptadores agnóstica de proveedor** (`DailyMetrics`, `Activity`, `PlannedWorkout`) con prioridad por campo y trazabilidad de fuente. | Las fuentes van a cambiar (hoy puente Claude/Personal API → mañana Starter OAuth). El modelo de dominio no debe depender de Garmin. |
| D8 | **Calcular una "readiness propia" (HRV/FC reposo/sueño/Body Battery vs. línea base)** además de guardar la Training Readiness de Garmin cuando llegue. | La Training Readiness / Training Status / carga aguda **no están** en las APIs oficiales (Health API ni Personal API). Solo llegan por vías no oficiales (el conector del Claude del usuario). |

**Arquitectura objetivo (post-aprobación Starter):** OAuth 2.0 PKCE (Garmin) → webhooks *push* a una Edge Function de Supabase → tablas normalizadas → planificador (Claude API) → `PlannedWorkout` → Training API → calendario de Garmin Connect → reloj.

---

## 1. Qué datos necesita la app (requisitos)

| Necesidad | Para qué | Métricas Garmin relevantes |
|---|---|---|
| Recuperación diaria | Ajustar intensidad del día / replanificar ante sobrecarga, estrés, mala noche | HRV nocturna + estado HRV, Body Battery, sueño (duración, fases, score), FC en reposo, estrés, **Training Readiness** |
| Carga y forma | Planificación semanal, tapering para carreras | Actividades (duración, distancia, FC, potencia, TSS/Training Load, Training Effect), **Training Status**, carga aguda/crónica, VO2max, umbral de lactato, FTP |
| Actividades no planificadas | Pádel, fútbol… cuentan como carga | Actividades de "otros deportes" con FC y carga |
| Entrenos al reloj | Que el plan llegue al Forerunner/Fenix sin teclear | Training API (workouts + schedule) |
| Social | Ver cuándo entrena el amigo para coincidir | **No** necesita datos de salud: basta con el plan (calendario) y opcionalmente un resumen de la sesión hecha |

> Implicación de diseño: **lo social se apoya en el plan (datos nuestros), no en métricas de Garmin.** Así evitamos casi todas las restricciones de "mostrar datos a otros usuarios" (Strava las prohíbe; Garmin exige atribución).

---

## 2. Línea temporal relevante (2024 → oct-2026)

| Fecha | Evento | Impacto |
|---|---|---|
| 11-nov-2024 | Strava cambia su API Agreement: datos solo visibles para el propio usuario; prohibido usar datos en modelos de IA. | Strava deja de ser opción para apps sociales/IA. ([DC Rainmaker](https://dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html), [the5krunner](https://the5krunner.com/2024/11/20/strava-issues-clarification/)) |
| 11-jun-2025 | Garmin publica especificación OAuth 2.0 PKCE para el Developer Program. | OAuth1 pasa a "legacy". ([PDF Garmin](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf)) |
| 30-jun-2025 | Garmin publica **API Brand Guidelines** (atribución "Garmin [modelo]"); exigibles desde 1-nov-2025. | Toda UI con datos Garmin debe atribuirlos. ([PDF](https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf), [ROOK](https://tryrook.io/blog/garmin-connect-api-access/)) |
| 30-sep-2025 | Strava demanda a Garmin (patentes de segmentos/heatmaps); según the5krunner la retiró ~3 semanas después. | Contexto de tensión entre plataformas. ([DC Rainmaker](https://www.dcrainmaker.com/2025/10/strava-sues-garmin-demands-stop-selling-devices.html), [the5krunner](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/)) |
| mar-2026 | Garmin cambia su flujo de login → **garth deprecado** (v0.8.0, 28-mar-2026). Garmin añade fingerprinting TLS de Cloudflare. | Las librerías no oficiales se rompen; python-garminconnect se reescribe (0.3.x). ([garth](https://github.com/matin/garth), [foro Garmin](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/433892/tls-fingerprinting-blocks-third-party-clients/2023526)) |
| mar–may-2026 | Garmin **cierra nuevas solicitudes** al Developer Program ("rediseño y modernización"). | Ninguna app nueva obtiene acceso durante ~7 meses. ([the5krunner](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/), [Terra](https://tryterra.co/blog/garmin-connect-developer-program-pause)) |
| 1-jun-2026 | Strava: nuevo programa (suscripción de desarrollador, 1→10 atletas, prohibición total de IA salvo su MCP). | Strava descartado definitivamente. ([Sahha](https://sahha.ai/blog/strava-api-changes-2026/), [appsforstrava](https://appsforstrava.com/blog/strava-developer-program-changes-2026)) |
| 22-jul-2026 | Garmin compra TrainingPeaks y TrainHeroic. | Garmin integra verticalmente la planificación. ([Garmin newsroom](https://www.garmin.com/en-US/newsroom/press-release/corporate/garmin-acquires-trainingpeaks-and-trainheroic-leading-endurance-and-strength-training-platforms-for-athletes-and-coaches/)) |
| fin-sep-2026 | Garmin vuelve a filtrar campos no documentados en los FIT que envía a terceros (Runalyze pierde VO2max, recovery…). | Los FIT vía API no son idénticos al export manual. ([garmin-intervals-bridge](https://github.com/futureweb/garmin-intervals-bridge), [idevice](https://idevice.com/garmin-reopens-its-connect-api-with-free-personal-keys-and-a-fee-for-big-apps.md)) |
| 9-oct-2026 | intervals.icu avisa: por nuevos términos de Garmin "probablemente" bloqueará el acceso a datos Garmin vía su API. | La vía "leer Garmin a través de intervals.icu" queda en riesgo. ([foro intervals.icu](https://forum.intervals.icu/t/api-access-to-intervals-icu/609?page=38)) |
| 12-oct-2026 | Cierra **Intervals Pro** (app de coaching IA que leía Garmin vía intervals.icu). | Precedente directo de nuestro caso de uso. ([the5krunner](https://the5krunner.com/2026/10/14/garmin-api-intervals-third-party-apps/), [Gadgets & Wearables](https://gadgetsandwearables.com/2026/10/14/garmin-api-intervals-pro-shutdown/)) |
| **21-oct-2026** | **Garmin reabre el programa con 3 tiers: Personal (gratis, tus datos, solo lectura), Starter (gratis ≤1.000 usuarios, incluye Training API) y Enterprise (de pago).** Publica cliente Python oficial de la Personal API. | Cambia por completo el análisis: **hay vía oficial gratuita para nosotros.** ([DC Rainmaker](https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html), [Garmin overview](https://developer.garmin.com/gc-developer-program/overview/), [garmin/connect-personal-api-python](https://github.com/garmin/connect-personal-api-python)) |
| 23-oct-2026 | python-garminconnect 0.3.20: arreglos de login (429 en login móvil desde abril; HTTP 427 para intentos bloqueados). | Lo no oficial sigue vivo pero es una carrera armamentística. ([releases](https://github.com/cyberjunky/python-garminconnect/releases)) |
| 2-nov-2026 | Se apaga la Fitbit Web API legacy (no nos afecta, pero confirma la tendencia de cierres). | — ([PR open-health-sync](https://github.com/soma-intelligence/open-health-sync/pull/214)) |

---

## 3. Garmin Connect Developer Program (vía oficial)

### 3.1 Los tres tiers (desde el 21-oct-2026)

Fuente principal: [página oficial del programa](https://developer.garmin.com/gc-developer-program/overview/), [DC Rainmaker](https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html), [Garmin Rumors](https://garminrumors.com/garmin-connect-developer-program-personal-starter-enterprise/).

| | **Personal** | **Starter** (Business) | **Enterprise** (Business) |
|---|---|---|---|
| Para quién (texto Garmin) | "Individuals who want to explore, analyze, and build with their own Garmin Connect data" | "Individual developers, startups, and organizations building apps" | Empresas a escala |
| Cómo se obtiene | Autoservicio en Garmin Connect web (Settings → Personal API Key). Sin solicitud. | **Formulario de solicitud** → aprobación → acceso al Developer Portal → crear app | Solicitud desde el Developer Portal (upgrade desde Starter) |
| APIs | Activity (JSON + .FIT), Health (JSON), Women's Health (JSON) | Activity (JSON + .FIT), **Courses**, Health, **Training**, Women's Health | Todo lo anterior + Golf API |
| Entrega de datos | **Pull** (tú consultas) | **Push only** (Garmin te hace POST al webhook) | Push o Ping/Pull |
| Histórico al conectar | Lectura por rangos de fechas (con límites por llamada) | **No incluido** (solo datos desde la conexión) | 1 mes+ (backfill) |
| Usuarios | Solo tú | "Limited" — DC Rainmaker: **≤1.000** | Ilimitado |
| Escritura (entrenos/rutas) | ❌ **No** (solo lectura) | ✅ Training API + Courses API | ✅ |
| Soporte técnico | — | No | Sí |
| Coste | Gratis | **Gratis** (según DC Rainmaker; Garmin no publica precio) | 1.000 USD de entrada (descontables) + cuota por usuario activo/mes negociada; cobro desde 1-abr-2027 (reportado, no publicado por Garmin) |

⚠️ Garmin no publica precios ni el límite exacto de Starter en su web; las cifras (1.000 usuarios, gratuidad, 1.000 USD) vienen de DC Rainmaker/idevice/Garmin Rumors.

**Por qué cerraron y reabrieron:** avalancha de solicitudes de apps "hechas con IA" (de un puñado por semana a decenas diarias) y menos de la mitad de las aprobadas llegaban a usar el acceso ([DC Rainmaker](https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html)).

### 3.2 Personal API (tier Personal): detalles técnicos

Fuente: código del cliente oficial [garmin/connect-personal-api-python](https://github.com/garmin/connect-personal-api-python) (Apache-2.0, v1.0.0, commits del 20–21-oct-2026), guía de [Shape Calendar](https://shapecalendar.com/guides/garmin-personal-api) y [Garmin Rumors](https://garminrumors.com/garmin-connect-developer-program-personal-starter-enterprise/).

**Obtención de la clave**
- URL: `https://connect.garmin.com/app/settings/personalApiToken` → *Create Key*.
- Caducidad elegible: **30, 90, 180 días o 1 año**. Garmin avisa por email ~1 semana antes. **No se puede renovar por código** → la app debe recordar al usuario que la rote.
- La clave se muestra **una sola vez**. Para reemplazarla se borra la actual (la vieja deja de funcionar).

**Autenticación (extraído de `constants.py` / `auth.py`)**
```text
Base URL:       https://personal.connectapi.garmin.com
Token exchange: POST /personalapitoken-service/personal-api/personal-api-key/token
                Header: Authorization: ApiKey <PERSONAL_API_KEY>
                Respuesta: el cuerpo es directamente un JWT (texto plano); expiración en el claim `exp`
Llamadas:       GET <path>   Header: Authorization: Bearer <JWT>
```
- El token de acceso dura **24 h** o hasta que caduque la clave (lo que ocurra antes). Sin refresh token: se vuelve a canjear la clave ([Garmin Rumors](https://garminrumors.com/garmin-connect-developer-program-personal-starter-enterprise/)).
- El cliente oficial reutiliza el token si le queda >1 h; un 401 no se reintenta (hay que pedir token nuevo).

**Endpoints disponibles (métodos del cliente oficial)**

| Dominio | Endpoint (GET) |
|---|---|
| Perfil | `/userprofile-service/userprofile/settings` |
| Actividades (lista) | `/activitylist-service/activities/search/activities?start=&limit=&startDate=&endDate=&activityType=` |
| Actividad | `/activity-service/activity/{id}` |
| Workout asociado a actividad | `/activity-service/activity/{id}/workouts` |
| Descarga FIT (ZIP) | `/download-service/files/activity/{id}` |
| Resúmenes diarios | `/usersummary-service/v2/dailysummaries?startDate=&endDate=` |
| Pasos / estrés / hidratación diarios | `/usersummary-service/stats/{steps\|stress\|hydration}/daily/{start}/{end}` |
| Actividad de bienestar | `/wellnessactivity-service/activity/summary/range/{start}/{end}` |
| Sueño (día) | `/sleep-service/sleep/dailySleep?date=` |
| Sueño (rango) | `/sleep-service/sleep/dailySleepSummariesByDate?startDate=&endDate=` |
| HRV (día / rango) | `/hrv-service/hrv/{date}` · `/hrv-service/hrv/daily/{start}/{end}` |
| Body Battery | `/wellness-service/wellness/bodyBattery/reports/daily?startDate=&endDate=` |
| FC diaria / zonas FC | `/wellness-service/wellness/dailyHeartRate?date=` · `/biometric-service/heartRateZones/v2` |
| SpO2 | `/wellness-service/wellness/daily/spo2acclimation/{date}` |
| Peso | `/weight-service/weight/range/{start}/{end}?includeAll=true` |
| Nutrición (food log) | `/nutrition-service/food/logs/{date}` |
| Ciclo menstrual | `/periodichealth-service/menstrualcycle/...` |
| Edad fitness | `/fitnessage-service/fitnessage/v2/{date}` |

**Límites conocidos** ([Shape Calendar](https://shapecalendar.com/guides/garmin-personal-api)):
- Ventana máxima por llamada: resúmenes diarios y HRV **180 días**; sueño y Body Battery **28 días**; estrés y pasos **7 días**. Rangos mayores → 400 vacío.
- Algunas listas devuelven como máximo 60 elementos; listas de actividades paginadas.
- Rate limits **no publicados**. Los endpoints reflejan los de Garmin Connect web y pueden cambiar.
- **No incluye** (según comentarios en DC Rainmaker y la lista de endpoints): **Training Readiness, Training Status, carga aguda/crónica, VO2max** ("not found"). DC Rainmaker dice estar trabajando con Garmin en campos que faltan. ⚠️

**Términos/uso:** Garmin dice que el Personal "not intended for commercial apps that serve other people". Usar la clave **de cada usuario, para sus propios datos**, en una app no comercial de 2 personas es una **zona gris de bajo riesgo**; no es la vía para la App Store pública con amigos → para eso, Starter.

**Ya existe un MCP sobre la Personal API:** [`garmin-personal-mcp`](https://github.com/Shape-Calendar/garmin-personal-mcp) (npm 0.1.1, 21-oct-2026, solo lectura, `npx -y garmin-personal-mcp`, modo HTTP con bearer). Es una alternativa **oficial** al conector Garmin no oficial que usan hoy en Claude para lecturas (pero sin Training Readiness ni escritura).

### 3.3 Starter: elegibilidad y solicitud

Según [Garmin Rumors](https://garminrumors.com/garmin-connect-developer-program-personal-starter-enterprise/) y la [página del programa](https://developer.garmin.com/gc-developer-program/overview/):

- Se envía el **"Starter access request form"**; solo tras aprobación se accede al Developer Portal y se crea la app.
- Solo puede solicitar **la organización/persona que posee, opera o distribuye la app** → Diego (titular de la cuenta Apple Developer) encaja.
- El formulario pide:
  - Datos de empresa/desarrollador, **URL de política de privacidad**, contacto.
  - Modelo de negocio e industria.
  - Descripción de la app y uso de las APIs.
  - **Servicios de terceros de analítica, ML o IA que toquen datos de Garmin** → declarar **Anthropic (Claude API)** y Supabase.
  - APIs solicitadas: Activity, Courses, Health, Training, Women's Health → pedir **Health + Activity + Training** (Courses opcional).
  - Usuarios esperados en 12 meses → honesto: "<20".
- Tiempo de aprobación: desconocido. DC Rainmaker espera que sea "virtually instant" para Starter; antes del cierre Garmin decía "2 business days". ⚠️
- Históricamente: primero una **clave de evaluación** (rate-limited, solo para pruebas) y luego **Partner Verification** (`https://apis.garmin.com/tools/partnerVerification`) para producción; "Evaluation apps used for production may be disabled without notice" ([Open Wearables](https://openwearables.io/docs/providers/garmin-api-integration.md)). ⚠️ No está claro si Starter mantiene este paso.
- Herramientas del portal: `apis.garmin.com/tools/endpoints` (registrar webhooks por tipo), `apis.garmin.com/tools/apiConfiguration`.

**Preparar antes de solicitar (checklist):**
1. Política de privacidad pública (GitHub Pages o dominio propio) con **AI Transparency Statement** (cláusula 15.10, ver §3.9).
2. Descripción del flujo de datos: Garmin → Supabase (UE) → Claude API (planificación) → Garmin Training API.
3. Capturas/mockups mostrando la **atribución "Garmin [modelo]"**.
4. Dominio HTTPS para webhooks (Supabase Edge Functions sirve).

### 3.4 OAuth 2.0 PKCE (Starter/Enterprise)

Fuente: [Garmin OAuth2 PKCE Specification (PDF, 11-jun-2025)](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf).

| Paso | Detalle |
|---|---|
| Autorización | `GET https://connect.garmin.com/oauth2Confirm?response_type=code&client_id=…&code_challenge=…&code_challenge_method=S256&redirect_uri=…&state=…` |
| code_verifier | 43–128 chars `[A-Za-z0-9-._~]`; challenge = `base64url(sha256(verifier))`. **CORS preflight no soportado.** |
| Token | `POST https://connectapi.garmin.com/di-oauth2-service/oauth/token` (form-urlencoded) con `grant_type=authorization_code`, `client_id`, **`client_secret`**, `code`, `code_verifier`, `redirect_uri` |
| Respuesta | `access_token` con `expires_in: 86400` (24 h); `refresh_token` con `refresh_token_expires_in: 7775998` (~90 días); scope fijo `PARTNER_WRITE PARTNER_READ CONNECT_READ CONNECT_WRITE` |
| Refresh | mismo endpoint, `grant_type=refresh_token`; **cada refresh devuelve un refresh token nuevo** (rotación). Restar ≥600 s a la expiración. |
| User ID | `GET https://apis.garmin.com/wellness-api/rest/user/id` → `{"userId": "…"}` (estable entre reconexiones) |
| Permisos | `GET https://apis.garmin.com/wellness-api/rest/user/permissions` → p. ej. `ACTIVITY_EXPORT`, `WORKOUT_IMPORT`, `HEALTH_EXPORT`, `COURSE_IMPORT`, `MCT_EXPORT`. Cambios posteriores llegan por webhook *User Permission*. |
| Desconexión | `DELETE https://apis.garmin.com/wellness-api/rest/user/registration` — **obligatorio** si la app ofrece "Desconectar"/"Borrar cuenta". |
| Backfill | El permiso `HISTORICAL_DATA_EXPORT` viene desmarcado por defecto en la pantalla de consentimiento ([Open Wearables](https://openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics)) — y además backfill es solo Enterprise. |

**Implicaciones para Expo/Supabase:**
- Como el canje de token exige `client_secret`, **el intercambio debe hacerse en el servidor** (Edge Function `garmin-oauth-callback`), nunca en la app.
- Flujo: app abre `expo-web-browser`/`AuthSession` con `redirect_uri` = Edge Function → la Edge Function canjea, guarda tokens cifrados (Supabase Vault) y redirige a un deep link `ironman://garmin/connected`.
- Job de refresh (pg_cron cada hora) para tokens que expiran en <2 h. Guardar siempre el **último** refresh token (rotación).

**OAuth 1.0a:** Garmin lo trata como legacy (Nango mantiene un proveedor `garmin` OAuth1 "for legacy connections" y uno nuevo `garmin-oauth2`) ([Nango](https://nango.dev/docs/api-integrations/garmin-oauth2.md)). **No he encontrado fecha oficial de apagado** ⚠️. Para una app nueva: solo OAuth2 PKCE.

### 3.5 Health API: qué datos da (y cuáles no)

Tipos de resumen (*summary types*) que se registran como webhooks ([Open Wearables](https://openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics), [docs Open Wearables](https://openwearables.io/docs/providers/garmin-api-integration.md)):

| Summary | Contenido útil para nosotros |
|---|---|
| `dailies` | pasos, pisos, kcal activas/BMR, minutos de intensidad, estrés medio/máx, **FC reposo**, **Body Battery** (máx/mín del día) |
| `epochs` | bloques de 15 min (actividad, FC). Bajo valor para nosotros |
| `sleeps` | sesión de sueño, **fases** (deep/light/REM/awake), **sleep score** |
| `hrv` | **HRV nocturna** (resumen) |
| `stressDetails` | estrés con detalle temporal y valores de **Body Battery** |
| `userMetrics` | **VO2max** (carrera/ciclismo), edad fitness |
| `pulseox` | SpO2 |
| `allDayRespiration` | frecuencia respiratoria |
| `bodyComps` | peso, IMC, % grasa… (báscula Index) |
| `bloodPressures`, `skinTemp`, `healthSnapshot`, `moveIQActivities`, `mct` (Women's Health) | secundarios |

**No disponibles en la API oficial** (ni Health API ni Personal API, según las listas de tipos y los informes de usuarios): **Training Readiness, Training Status, carga aguda/crónica (Acute Load), Endurance Score, Hill Score, Race Predictor, Recovery Time.** ⚠️ No he encontrado documentación oficial que los incluya; tratar como "no disponibles" salvo prueba en contrario.

> Consecuencia: aunque tengamos Starter, **la "Training Readiness" de Garmin solo nos llegará por el puente de Claude** (conector no oficial). Por eso la decisión D8: calcular una readiness propia.

**Licencias especiales:** algunos datos (p. ej. intervalos latido-a-latido "enhanced") requieren licencia de pago para uso comercial ([Terra](https://tryterra.co/blog/garmin-connect-developer-program-pause)). No los necesitamos.

### 3.6 Activity API

- Resúmenes de actividad (>100 deportes), `activityDetails` (laps, muestras), ficheros (`activityFiles`: FIT/TCX/GPX), `manuallyUpdatedActivities`.
- Métricas: carrera (cadencia, GCT, oscilación vertical…), ciclismo (potencia, NP, IF, TSS, FTP), natación (estilo, SWOLF, brazadas/largo, piscina), GPS, altitud, FC ([Open Wearables](https://openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics)).
- ⚠️ Garmin **elimina campos no documentados** de los FIT enviados por API (VO2max estimado, recovery time, performance condition), presentes en el export manual ([idevice](https://idevice.com/garmin-reopens-its-connect-api-with-free-personal-keys-and-a-fee-for-big-apps.md)).
- Empuje de actividades **completadas** hacia Garmin: no disponible para terceros normales (solo socios estratégicos tipo Zwift/TrainerRoad/Peloton) ([DC Rainmaker](https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html)). No lo necesitamos.

### 3.7 Training API (empujar entrenos al reloj) y Courses API

Qué hace: publicar **workouts estructurados y planes en el calendario de Garmin Connect**, que se sincronizan al reloj; requiere permiso de usuario `WORKOUT_IMPORT`. Es la vía estándar de TrainingPeaks, Tredict, intervals.icu, etc.

**Payload V2 (verificado en un post de developer de feb-2026)** ([foro Garmin](https://forums.garmin.com/developer/connect-iq/f/discussion/431359/no-interval-details-in-workouts)):
```json
{
  "workoutName": "5x3 VO2max",
  "description": "",
  "sport": "CYCLING",
  "workoutProvider": "IronmanApp",
  "workoutSourceId": "IronmanApp",
  "estimatedDurationInSecs": 1800,
  "segments": [{
    "segmentOrder": 1,
    "sport": "CYCLING",
    "estimatedDurationInSecs": 1800,
    "steps": [
      { "type": "WorkoutStep", "stepOrder": 1, "intensity": "WARMUP",
        "durationType": "OPEN", "targetType": "OPEN" },
      { "type": "WorkoutRepeatStep", "stepOrder": 2,
        "repeatType": "REPEAT_UNTIL_STEPS_CMPLT", "repeatValue": 5,
        "steps": [
          { "type": "WorkoutStep", "stepOrder": 1, "intensity": "ACTIVE",
            "durationType": "TIME", "durationValue": 180,
            "targetType": "POWER", "targetValueLow": 261, "targetValueHigh": 289 },
          { "type": "WorkoutStep", "stepOrder": 2, "intensity": "RECOVERY",
            "durationType": "TIME", "durationValue": 180, "targetType": "OPEN" }
        ] },
      { "type": "WorkoutStep", "stepOrder": 3, "intensity": "COOLDOWN",
        "durationType": "OPEN", "targetType": "OPEN" }
    ]
  }],
  "scheduledDate": "2026-02-17"
}
```
- El modelo V2 tiene **`segments`** con `sport` propio por segmento → es la estructura que permite **multideporte (brick)**. ⚠️ No he podido verificar en documentación pública el valor exacto `MULTI_SPORT` ni qué relojes aceptan workouts multideporte estructurados (un MCP comunitario reporta que algunos dispositivos los rechazan como "not compatible" — [glama](https://glama.ai/mcp/servers/lpoyejjs7f)).
- Endpoints (de memoria de la especificación Training API V2, **no verificados** públicamente ⚠️): crear workout `POST https://apis.garmin.com/workoutportal/workout/v2`; programar `POST https://apis.garmin.com/training-api/schedule/` con `{workoutId, date}`; leer/borrar por id. Confirmar en el portal tras la aprobación.
- Deportes soportados según Tredict (socio desde 2020): **carrera, ciclismo, natación en piscina (lap swimming)**, fuerza, cardio, "otros". **Natación en aguas abiertas NO** (se manda como "otra actividad") ([Tredict](https://tredict.com/blog/garmin_training_api_integration)). Potencia se ignora en natación.
- Bug conocido: objetivos de potencia/FC en intervalos que no aparecen en Garmin Connect tras subir (post de feb-2026, sin respuesta) → **probar con un reloj real** cada tipo de objetivo.
- **Courses API**: subir rutas (cursos) al reloj. Útil para "ruta de la tirada larga del domingo"; prioridad baja.

### 3.8 Push vs Ping, webhooks y backfill

| | Push | Ping |
|---|---|---|
| Qué llega | El **payload completo** en el body del POST | Una notificación con `callbackURL` que tú descargas |
| Tier | Starter y Enterprise | Solo Enterprise |

- Entrega típica: **1–5 min tras sincronizar el reloj**; sin garantía de tiempo real; no hay endpoint de polling en Starter ([Open Wearables](https://openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics)).
- El endpoint debe responder **HTTP 200 en pocos segundos** → encolar y procesar asíncronamente; Garmin **reintenta** si no hay 200 → procesamiento **idempotente** (upsert por `summaryId`/`activityId`).
- Rate limit reportado: ~100 req/min ([Open Wearables](https://openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics)).
- **Backfill** (`/wellness-api/rest/backfill/{type}`, 1 día por petición, ~30 días, normalmente una vez por tipo) → **solo Enterprise**. En Starter **no hay histórico**: para las primeras semanas usar Personal API o el puente Claude.

### 3.9 Cláusulas legales que nos afectan

Fuente: [Garmin Connect Developer Program Agreement, FRM-0952 Rev. B](https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf) (PDF con metadatos de mar-2026; la copia descargada es la variante con Garmin China como contraparte, mismo número de formulario; ⚠️ confirmar la versión que se acepte en el portal, que intervals.icu dice que aparece como popup con cambios no públicos).

| Cláusula | Qué dice (resumen) | Impacto en nuestra app |
|---|---|---|
| 4.1 | Licencia para usar datos "solely for internal business purposes", solo para formatear/mostrar en la app, conforme al consentimiento del usuario. | Uso normal OK. |
| 5.2(e) | No compartir la License Key ni derivar ingresos de la API sin permiso escrito. | App gratuita: OK. Si algún día se monetiza, revisar. |
| 5.2(j) | Prohibido scraping/robots contra servicios de Garmin. | Incompatible con usar librerías no oficiales **en la misma app** que es licenciataria. |
| **5.2(o)** | Prohibido poner la API o **End User Data** a disposición de plataformas/servicios de terceros **"not approved by Garmin in writing"**, incluso desarrollando una API propia. | Es la cláusula que tumba a intervals.icu como "proxy" de datos. Para nosotros: **declarar Anthropic/Claude en la solicitud**; **no exponer datos Garmin** en nuestro MCP a otros clientes sin aprobación. ⚠️ Ojo: exponer datos de Garmin (obtenidos por Starter) al Claude del usuario mediante nuestro MCP podría interpretarse como esto → pedir aprobación explícita o limitarlo a datos derivados/planes. |
| 6.4 + Brand Guidelines | Toda visualización/distribución de datos de dispositivo Garmin a terceros requiere atribución según las [API Brand Guidelines](https://developer.garmin.com/brand-guidelines/overview/) (title-level, pantallas secundarias, datos exportados, **datos derivados**, redes sociales). Formato "Garmin [modelo de dispositivo]"; para derivados, texto tipo "Insights derived in part from Garmin device-sourced data". | Guardar `deviceModel` en cada dato; badge "Garmin Forerunner 965" junto a métricas y en tarjetas compartidas con amigos; frase de atribución en recomendaciones de IA. |
| 10.1–10.2 | Hoy sin cuota, pero Garmin puede cobrar con 30 días de aviso y por exceso de volumen. | Riesgo de coste futuro; bajo para Starter. |
| **15.8** | El licenciatario **no puede pedir ni intentar obtener las credenciales de Garmin del usuario**, ni implementar un sistema de autorización alternativo. | **Prohíbe** el patrón "mete tu email/contraseña de Garmin" (python-garminconnect) en nuestra app si somos licenciatarios. |
| **15.10** | Si los datos se usan para entrenar o **ser procesados por sistemas de IA**, la política de privacidad debe incluir un **"AI Transparency Statement"** visible: naturaleza y propósito del procesamiento, **consentimiento explícito previo** de cada usuario y posibilidad de retirarlo fácilmente. | **Imprescindible**: pantalla de consentimiento IA en onboarding ("Tus datos de Garmin se envían a Claude (Anthropic) para generar tu plan semanal") + toggle para retirarlo + texto en la política. |
| 15.4 | Política de privacidad, consentimiento, derechos ARCO/GDPR. | Datos de salud = categoría especial (art. 9 RGPD): consentimiento explícito. |

### 3.10 Veredicto Garmin oficial

- **Starter es la meta**: gratis, oficial, permite **leer** (push) y **escribir entrenos** (Training API). Encaja con 2–20 usuarios.
- **Personal API es el atajo de día 1** para lecturas automáticas fiables (HRV, sueño, Body Battery, estrés, actividades, FIT), sin aprobación, con matices de términos.
- **Ninguna vía oficial da Training Readiness / Training Status / carga.**

---

## 4. Garmin → Apple Health (HealthKit)

### 4.1 Qué escribe Garmin Connect iOS en Apple Health

La página oficial de soporte de Garmin bloquea el scraping (403); la lista está reproducida por [the5krunner (FAQ de Garmin citada)](https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/), [Ultrafit360 (revisado 9-oct-2026)](https://ultrafit360.com/blog/garmin-apple-health-health-connect) y el [hilo de Apple Community](https://discussions-cn-prz.apple.com/thread/251525307).

| Tipo HealthKit | ¿Garmin lo escribe? | Notas |
|---|---|---|
| Steps, Walking+Running Distance, Flights Climbed | ✅ | |
| Active Energy, Resting (Basal) Energy | ✅ | |
| Heart Rate | ✅ (todo el día) | En **actividades cronometradas solo FC máx y mín** → la gráfica de FC del entreno en Salud sale "Chart Unavailable" |
| Resting Heart Rate | 🟡 probable | No está en la lista oficial; usuarios reportan registros con timestamp a medianoche ([foro Garmin](https://forums.garmin.com/apps-software/mobile-apps-web/f/connect-iq-store-ios/408720/garmin-connect-corrupting-apple-health/1935502)) |
| Sleep Analysis | ✅ | Garmin lista la categoría; **fases para Apple no confirmadas** (para Health Connect sí lista fases) ⚠️ verificar en un iPhone real |
| Workouts | ✅ | kcal, distancia, desnivel, FC, velocidad, pasos. **Sin ruta GPS** (no escribe `HKWorkoutRoute`) |
| Weight, Body Fat %, BMI | ✅ | si se registran en Garmin (báscula Index o manual) |
| Blood Pressure | ✅ | con Index BPM |
| Water | ✅ | |
| **HRV (SDNN)** | ❌ | |
| **SpO2, Respiratory Rate** | ❌ | |
| **VO2max** | ❌ | |
| **Body Battery, Stress, Training Readiness/Status/Load, Recovery Time** | ❌ | métricas propietarias; Apple no tiene tipo equivalente para la mayoría |
| Skin/body temperature, ciclo | ❌ | |
| Mindful minutes | ❓ | no listado |

Prueba indirecta de los huecos: existen apps de pago en la App Store (p. ej. *Vitals Sync*, lanzada 18-jun-2026, o *HRV Sync*) cuyo único propósito es copiar a Salud **HRV, respiración, SpO2 y VO2max** porque Garmin no los envía ([listado](https://mwm.ai/apps/vitals-sync/6780623839)). Esas apps usan login de Garmin Connect (no oficial).

**Dirección:** Garmin → Salud (un sentido). En jun-2025 se anunció lectura desde Salud hacia Garmin; no hay confirmación de su alcance ([the5krunner](https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/)).

**Términos:** como Garmin escribe esos datos él mismo en Salud, **no se aplican las restricciones del Developer Program** a lo que leemos de HealthKit (the5krunner, [14-oct-2026](https://the5krunner.com/2026/10/14/garmin-api-intervals-third-party-apps/)). Sí aplican las reglas de Apple (guideline 5.1.3: no publicidad, política de privacidad, consentimiento).

### 4.2 Gotchas

1. **Garmin Connect solo escribe en Salud con la app en primer plano** → retrasos de horas si el usuario no abre Garmin Connect. Mitigación: notificación matinal "abre Garmin Connect para sincronizar" (o aceptar el retraso).
2. **Histórico limitado:** al activar el permiso, Salud importa como mucho ~2 semanas atrás.
3. **Reenvíos y duplicados:** usuarios reportan que Garmin reescribe workouts de días anteriores tras una sincronización → deduplicar por `HKObject.uuid` + `HKSourceRevision` y por (inicio, tipo, duración).
4. **Fuentes mezcladas:** si el usuario tiene iPhone contando pasos, Salud tiene varias fuentes. Filtrar por fuente Garmin (`HKSource.bundleIdentifier` de Garmin Connect; ⚠️ confirmar el bundle id en dispositivo, Spike cita `com.garmin.android.apps.connectmobile` para Android/Health Connect — [Spike](https://spikeapi.com/blog/why-integrate-garmin-api-directly)).
5. **Cuentas con solo un Edge** (ciclocomputador) no muestran Garmin Connect en Salud.
6. FC de entreno pobre (solo máx/mín) → no sirve para análisis de intensidad; usar Personal API/Starter para eso.

### 4.3 Implementación en Expo

- Librería recomendada: **`@kingstinct/react-native-healthkit` 16.2.0** (12-oct-2026; peer deps `react >=19`, `react-native >=0.79`, `react-native-nitro-modules >=0.35`). Tiene **config plugin de Expo** (entitlements + `NSHealthShareUsageDescription`), **anchored queries** para sincronización incremental y **background delivery** (opción `background` del plugin) ([yarn](https://classic.yarnpkg.com/en/package/@kingstinct/react-native-healthkit)).
- Descartar `react-native-health` (1.19.0, sin cambios desde oct-2024).
- **No funciona en Expo Go** → development build con EAS (ya previsto).
- Patrón: `HKObserverQuery` + `enableBackgroundDelivery` (frecuencia `.immediate`/`.hourly`) → al despertar, `HKAnchoredObjectQuery` por tipo → normalizar → `upsert` a Supabase → refrescar widget (WidgetKit timeline).
- Tipos a pedir (solo lectura): `stepCount`, `activeEnergyBurned`, `basalEnergyBurned`, `heartRate`, `restingHeartRate`, `heartRateVariabilitySDNN` (por si otra fuente lo escribe), `sleepAnalysis`, `workoutType`, `vo2Max`, `bodyMass`.

### 4.4 Veredicto HealthKit

- **Viable como capa complementaria desde el día 1** (actividades básicas, sueño, FC reposo, pasos, peso) y **gratis, sin aprobaciones, sin riesgo de términos**.
- **No viable como fuente principal**: le faltan justo las métricas de recuperación (HRV, Body Battery, estrés, readiness), la FC de entreno es pobre y depende de que el usuario abra Garmin Connect.
- Bonus: también cubre a amigos futuros con Apple Watch u otras marcas sin trabajo extra.

---

## 5. Vías no oficiales (garth, python-garminconnect, MCP comunitarios)

### 5.1 Estado en oct-2026

| Proyecto | Estado | Notas |
|---|---|---|
| [`garth`](https://github.com/matin/garth) | **Deprecado**. Última versión 0.8.0 (28-mar-2026). | "Garmin changed their auth flow, breaking the mobile auth approach". Los tokens OAuth1 existentes funcionan hasta caducar (~1 año); logins nuevos no. Fork: [`garth-ng`](https://pypi.org/project/garth-ng/) (abr-2026). |
| [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) | **Activo**: 0.3.20 (23-oct-2026); ya **no** depende de garth (desde 0.3.0). | Login con varias estrategias (móvil con client id de la app iOS, widget SSO, portal; con/sin impersonación TLS vía `curl_cffi`). MFA: `prompt_mfa` o `return_on_mfa=True` + `resume_login()`. Tiene `upload_workout`, `schedule_workout`, `get_training_readiness`, `get_hrv_data`, `get_body_battery`, `get_sleep_data`… Requiere Python ≥3.12. |
| [`Taxuspt/garmin_mcp`](https://github.com/Taxuspt/garmin_mcp) | Activo (verificado contra producción 1-sep-2026). | 110–155 herramientas según perfil; incluye **`upload_workout(s)`, `schedule_workout`, `schedule_week`**, builders; perfiles `minimal/health/activities/workouts/training/all` y `GARMIN_ENABLED_TOOLS`. Auth con `garmin-mcp-auth` (tokens ~6 meses en `~/.garminconnect`). stdio o `streamable-http` con bearer. |
| [`garmin-personal-mcp`](https://github.com/Shape-Calendar/garmin-personal-mcp) | Nuevo (21-oct-2026). | **Usa la Personal API oficial**; solo lectura. |
| [`garmin-intervals-bridge`](https://github.com/futureweb/garmin-intervals-bridge) | Activo (25-oct-2026). | Usa garminconnect/Personal API para subir FIT originales + wellness a intervals.icu. |

> Observación del entorno de desarrollo: el conector Garmin que el usuario tiene conectado a Claude expone, entre otras, `get_training_readiness`, `get_training_status`, `get_hrv`, `get_body_battery`, `get_sleep_data`, `get_stress`, `get_endurance_score`, `get_race_predictions`, `get_lactate_threshold`, `get_cycling_ftp`, `get_activities_by_date`, `get_workouts`, `get_scheduled_workout_by_id`… pero **en su configuración actual no expone `upload_workout`/`schedule_workout`** (habría que activar el perfil `workouts` o equivalente si es el servidor de Taxuspt).

### 5.2 Riesgos

1. **ToS de Garmin:** prohíbe acceso automatizado; la consecuencia prevista es suspensión de la cuenta Garmin. No se conocen casos con clientes open-source veteranos, pero no hay garantía ([garmin-intervals-bridge](https://github.com/futureweb/garmin-intervals-bridge)).
2. **Bloqueos técnicos:** fingerprinting TLS de Cloudflare; **IPs de datacenter bloqueadas** (reporte con Railway) → un backend en Supabase/Fly/Railway es mal sitio; 429 en login móvil desde abril-2026; HTTP 427; un usuario reporta **bloqueo a nivel de cuenta 48 h+** tras varios logins fallidos ([foro Garmin](https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours/2029273)).
3. **Seguridad/legal:** almacenar emails+contraseñas o cookies de sesión de Garmin de otras personas en nuestro backend = riesgo alto; y si somos licenciatarios Starter, **viola 15.8**.
4. **Stack:** las Edge Functions de Supabase son Deno/TypeScript; python-garminconnect necesitaría otro servicio Python.

### 5.3 Patrón recomendado: "Claude como puente" (nuestro propio servidor MCP)

Idea: no tocamos Garmin desde nuestro backend. **El Claude de cada usuario** (que ya tiene su conector Garmin) **lee** sus datos y **escribe** un *snapshot* normalizado en nuestra app a través de **nuestro servidor MCP** (remoto, por usuario, autenticado). El usuario mueve sus propios datos; nosotros no somos licenciatarios de Garmin en este flujo ni guardamos credenciales Garmin.

```
[Reloj] → Garmin Connect ──(conector Garmin del usuario en claude.ai)──► Claude
                                                                           │
                                               tools de NUESTRO MCP ◄──────┘
                                     upsert_daily_metrics / upsert_activities /
                                     get_week_context / propose_week_plan / log_event
                                                                           │
                                                                    Supabase (RLS)
                                                                           │
                                                                     App iOS + widgets
```

Herramientas mínimas del MCP (detalle de auth/transporte en el documento de integración con Claude):

| Tool | Entrada | Efecto |
|---|---|---|
| `get_week_context` | `weekStart` | Devuelve plan actual, restricciones de calendario (clases/trabajo), imprevistos registrados, carreras objetivo, disponibilidad del compañero |
| `upsert_daily_metrics` | `days: DailyMetricsInput[]` (validado con Zod) | Guarda métricas con `source = "claude_bridge"` y `provenance` (herramienta Garmin usada) |
| `upsert_activities` | `activities: ActivityInput[]` | Guarda actividades (incl. pádel/fútbol) con dedupe |
| `log_event` | `type: padel\|football\|injury\|overload\|work\|stress\|illness\|travel`, fecha, severidad, notas | Registra imprevistos |
| `propose_week_plan` | `weekStart`, `sessions[]`, `rationale` | Crea un **borrador** que el usuario aprueba en la app (nunca sobrescribe sin confirmación) |
| `get_plan_for_device` | `dateRange` | Devuelve los workouts en formato Garmin (JSON V2) para que **el propio Claude** los suba con `upload_workout` + `schedule_workout` de su conector |

Ventajas: **día 1**, sin aprobaciones; acceso a **Training Readiness/Status/carga** (lo que ninguna API oficial da); encaja con cómo ya trabajan.
Limitaciones: **no es automático** (depende de que el usuario hable con Claude; ideal integrarlo en el ritual semanal y en un "check-in" diario corto); calidad dependiente del LLM (validar esquema estrictamente, rechazar valores fuera de rango); el conector Garmin del usuario sigue siendo no oficial (riesgo en su lado, no en el nuestro).

⚠️ Cuando seamos licenciatarios Starter, **no reexponer** por este MCP los datos obtenidos vía Garmin API (cláusula 5.2(o)) salvo aprobación escrita: el MCP debe servir **planes y contexto**, y para métricas devolver solo agregados/derivados o lo que el propio usuario aportó.

### 5.4 Veredicto no oficial

- **Sí** como fuente "enriquecida" vía puente Claude (el riesgo lo asume el conector del usuario, que ya existe).
- **No** dentro de nuestro backend ni pidiendo credenciales.

---

## 6. Alternativas

### 6.1 Strava API: descartada

Fuentes: [Sahha](https://sahha.ai/blog/strava-api-changes-2026/), [appsforstrava](https://appsforstrava.com/blog/strava-developer-program-changes-2026), [foro intervals.icu](https://forum.intervals.icu/t/strava-api-update-new-terms-subs-required-for-api-access/130240), [DC Rainmaker 2024](https://dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html).

| Regla (API Policy/Agreement, vigente desde 1-jun-2026) | Choque con nuestra app |
|---|---|
| §5.3: prohibido usar datos de la API para "develop, train, evaluate or operate any AI application", incluido **RAG y meterlos en el contexto** de un modelo. Única excepción: el MCP oficial de Strava (uso personal del desarrollador). | Nuestro núcleo es planificar con Claude → **incompatible**. |
| §2.3/6.1: los datos de un usuario solo pueden mostrarse **a ese usuario**. | La parte social → incompatible (salvo no mostrar nada de Strava a otros). |
| §5.16: prohibido pasar datos por intermediarios/agregadores y **operar un servidor MCP** que exponga datos de Strava. | Nuestro MCP → incompatible. |
| §6.2: caché máximo 7 días; §6.3/7.4 borrado en 48 h / 30 días. | Historial de carga → incómodo. |
| Suscripción Strava del desarrollador (11,99 USD/mes o 79,99 USD/año); 1 atleta por defecto, hasta 10 sin revisión. Rate limit 200/15 min, 2.000/día (400/4.000 tras upgrade). | Coste y límites menores, pero irrelevantes ante lo anterior. |
| Nueva base URL `api-v3.strava.com` (4-ene-2027); tokens solo en header y `/oauth/revoke` (1-jun-2027). | — |

Además, la propia Strava exige atribución de Garmin para datos que vienen de Garmin (desde 1-nov-2025).

### 6.2 intervals.icu: útil para **escribir** entrenos, arriesgado para **leer** Garmin

Fuentes: [hilo oficial API](https://forum.intervals.icu/t/api-access-to-intervals-icu/609), [OAuth](https://forum.intervals.icu/t/intervals-icu-oauth-support/2759), [Cookbook](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090.md), [Swagger](https://intervals.icu/api/v1/docs/swagger-ui/index.html).

**API (gratis):**
- Base: `https://intervals.icu/api/v1`; athlete id `0` = el dueño del token.
- Auth personal: Basic con usuario `API_KEY` y la clave (Settings → Developer). OAuth para apps multiusuario:
  - Registro: `https://intervals.icu/oauth/apply` (queda "Pending" hasta aprobación manual).
  - Authorize: `https://intervals.icu/oauth/authorize?client_id&redirect_uri&scope&state` (+ PKCE `code_challenge`, `S256`).
  - Token: `POST https://intervals.icu/api/oauth/token` (el code caduca en 2 min). **Sin refresh tokens.** Revocar: `DELETE /api/v1/disconnect-app`.
  - Scopes: `ACTIVITY`, `WELLNESS`, `CALENDAR`, `CHATS`, `LIBRARY`, `SETTINGS` con `:READ`/`:WRITE` (p. ej. `CALENDAR:WRITE,WELLNESS:READ`). Redirect URIs sin comodines.
- Rate limits: API key 5.000/día y 2.500/15 min; OAuth 100/usuario/día (mín. 5.000 total); 10 req/s por IP; 429 con `Retry-After`.
- Endpoints clave:
  - Wellness: `GET /athlete/0/wellness?oldest=&newest=` (campos tipo `restingHR`, `hrv`, `sleepSecs`, `sleepQuality`, `soreness`, `fatigue`, `stress`…); `PUT /athlete/0/wellness-bulk`.
  - Actividades: `GET /athlete/0/activities?oldest=&newest=`, `GET /activity/{id}?intervals=true`, `GET /activity/{id}/file`.
  - **Calendario/planificados:** `POST /athlete/0/events` con `start_date_local` (`…T00:00:00`), `category: "WORKOUT"`, `type` (`Ride`, `Run`, `Swim`…), `name`, `description` (sintaxis de workout de intervals, p. ej. `- 10m Z2`, `5x` + pasos), `moving_time`, `icu_training_load`, **`external_id`** (nuestro id); variante bulk con upsert; `PUT/DELETE /athlete/0/events/{id}`.
  - Webhooks: `CALENDAR_UPDATED` (incluye `external_id`, `deleted_events`), `ACTIVITY_UPLOADED`, `ACTIVITY_ANALYZED`, `SPORT_SETTINGS_UPDATED`.
- **Datos de Strava no están disponibles por API** (desde 2024).

**Empuje a Garmin:** el usuario conecta Garmin en intervals.icu y marca **"Upload planned workouts"**; intervals.icu usa **dos apps Garmin** (una para actividades/wellness y otra para subir workouts). Sube solo **la próxima ~1 semana**; no se puede elegir workout a workout; filtros indoor/outdoor ([foro](https://forum.intervals.icu/t/upload-planned-workouts-to-garmin-connect/1521)). A 25-oct-2026 los usuarios siguen usándolo (hilos activos sobre rangos de potencia sincronizados).

**Limitaciones para triatlón:**
- Natación: los descansos tipo `- 20s` llegan al reloj como series de nado/patada; recomendado `- 20s intensity=rest`; estilos mal mapeados ([foro natación](https://forum.intervals.icu/t/swim-workout-planning-for-garmin/75705)).
- **Brick/multideporte: no documentado** → asumir no soportado.

**Lectura de datos Garmin vía intervals.icu — en riesgo:**
- 9-oct-2026: "It is likely that we will have to block access to Garmin data via the API soon" (David, intervals.icu). Afectaría a actividades, FIT, streams y wellness con origen Garmin, **incluido el histórico**; los FIT subidos manualmente por el atleta "likely ok". 14-oct: lo vinculan a la reapertura del programa y prometen "an easier path for individuals". **Sin fecha ni decisión final** a 25-oct-2026 ([the5krunner](https://the5krunner.com/2026/10/14/garmin-api-intervals-third-party-apps/), [domestique#29](https://github.com/platypus45/domestique/issues/29)).
- No se ha dicho si las **claves personales** quedan afectadas.

**Veredicto intervals.icu:** buen **atajo de escritura** (bici/carrera) mientras no tengamos Starter, si ambos usuarios aceptan tener cuenta en intervals.icu. **No** usarlo como fuente de datos Garmin. Integración: por clave personal de cada usuario (más rápido) o solicitar app OAuth (aprobación manual).

### 6.3 Agregadores

| Proveedor | Precio de entrada (pequeño volumen) | Garmin | Comentario |
|---|---|---|---|
| [Terra](https://tryterra.co/pricing) | Quick Start **499 USD/mes** (399 anual), 100k créditos; 200 créditos por usuario activo/mes; **Planned Workouts** +99 USD/mes | Sí (lectura + empuje de workouts) | DC Rainmaker reporta que Garmin **cortó el acceso de Terra** hasta que cumpliera las reglas (reenvío a terceros, OAuth). Caro para 2 usuarios. |
| ROOK | Core **399 USD/mes** (750 usuarios), sin tier gratis; backfill 7 días | Sí | ([Sahha compare](https://sahha.ai/compare/rook-alternatives/)) |
| Spike | desde ~450 USD/mes (demo) | Sí | Reportada adquisición por Raintree (jul-2026), no verificada |
| Thryve | Trial 25 usuarios; **499 EUR/mes** (500 usuarios) | Sí | Datos en UE |
| Junction (ex-Vital) | ~0,50 USD/usuario/mes con **mínimo 300 USD** | Sí | Precios en página antigua de Vital |
| Sahha | Tier gratis; 299 USD/mes (1.000 usuarios) | Vía HealthKit/Health Connect | Competidor que publica las comparativas (sesgo) |
| [Open Wearables](https://openwearables.io/docs/providers/garmin-api-integration.md) | **Gratis, MIT, self-hosted** | Sí, **con tus propias credenciales Garmin** (Starter) | No soporta aún la Personal API. Útil como referencia de implementación (webhooks, backfill) |

**Veredicto:** no compensa (coste ≥300–500 USD/mes y Garmin desconfía de los intermediarios: el propio Garmin exige credenciales propias por despliegue). Si algún día se quisiera multi-marca (COROS/Polar/Suunto/Apple Watch), estudiar **Open Wearables** self-hosted.

### 6.4 Ficheros FIT de workout

- Generarlos es fácil: **`@garmin/fitsdk` 21.218.0** (oficial, JS, con `Encoder` desde 21.161.0); el FIT SDK tiene la receta "Encoding FIT Workout Files" ([foro FIT SDK](https://forums.garmin.com/developer/fit-sdk/f/discussion/361529/ability-to-encode-an-activity-using-javascript-sdk/)).
- **Entregarlos es el problema:** Garmin Connect **web no importa FIT de workouts**; hay que copiarlos por **USB a `GARMIN/NewFiles`** del reloj ([foro Garmin Connect](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/389325/can-i-upload-custom-workouts-to-my-garmin-without-using-the-workout-creator-built-into-garmin-connect/1852014)). Desde un iPhone no es práctico.
- Útil para: natación en aguas abiertas (que la Training API no soporta) o como export de emergencia desde el PC. Blocks lo usa mientras espera acceso Garmin ([the5krunner](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/)).
- **Veredicto:** P3, opcional ("Descargar .FIT" en la ficha del entreno).

### 6.5 Connect IQ (mención)

- Programa separado, **gratis y abierto** (no se cerró). Una app/data field Connect IQ en el reloj podría leer métricas en el dispositivo y enviarlas a nuestro servidor vía el móvil.
- Coste: aprender Monkey C, publicar en la Connect IQ Store, mantener compatibilidad de dispositivos. **No para el MVP.** Posible P3 (p. ej. un *glance* "sesión de hoy" en el reloj).

---

## 7. Cómo lo hacen otros planificadores (en la parte Garmin)

| Producto | Lectura de datos | Envío de entrenos al reloj | Nota |
|---|---|---|---|
| TrainingPeaks | Garmin Activity/Health API (socio histórico) | Training API | Propiedad de Garmin desde 22-jul-2026 |
| Tredict | Garmin oficial (OAuth, desde 2020) | Training API (run, bike, lap swim; no open water) | Ofrece plugin ChatGPT y MCP para Claude ([blog](https://www.tredict.com/blog/garmin_personal_api_chatgpt_and_claude/)) |
| intervals.icu | 2 apps Garmin (actividades/wellness y workouts) | Training API, próxima ~semana | Bloqueará reexportar datos Garmin por su API |
| Blocks (planificador) | Esperando acceso Garmin (jul-sep-2026) | **Vía intervals.icu** o **FIT** según el cookbook de Garmin | Wahoo/Hammerhead le aprobaron en semanas |
| Intervals Pro | Garmin **a través de intervals.icu** | — | **Cerró el 12-oct-2026** por la restricción "downstream" |
| Apps de coaching IA (TriDot, Humango, MOTTIV, Runna…) | Socios oficiales Garmin + Apple Health | Training API | Patrón estándar del sector ⚠️ (no verificado uno a uno) |

**Lección:** el patrón ganador es **OAuth oficial + Training API**; quien depende de un intermediario (intervals.icu, Strava) queda expuesto a cambios de términos.

---

## 8. Recomendación por capas

### Capa 0 — Día 1 (sin aprobaciones de nadie)

| Función | Implementación | Automático |
|---|---|---|
| Métricas de recuperación (HRV, sueño, Body Battery, estrés, FC reposo) | **Garmin Personal API**: cada usuario pega su clave (1 año) en la app → se guarda cifrada en Supabase Vault → Edge Function + `pg_cron` a las 07:30 y 10:00 (Europe/Madrid) + botón "Actualizar". Rango inicial: últimos 28–180 días según endpoint. | ✅ |
| Training Readiness / Training Status / carga / predicciones | **Puente Claude** → `upsert_daily_metrics` en nuestro MCP durante el check-in diario/semanal | 🟡 manual |
| Actividades (incl. pádel/fútbol) | Personal API (`activitylist-service`) + HealthKit en dispositivo + puente Claude; dedupe | ✅ |
| Sueño/pasos rápidos para widgets | HealthKit background delivery en el iPhone | ✅ (con retraso si no abren Garmin Connect) |
| Readiness propia | Función SQL/TS: z-score de HRV y FC reposo vs. 7/28 días + sueño + Body Battery al despertar + RPE/molestias declaradas | ✅ |
| Entrenos al reloj | Opción A: **Claude del usuario** sube con `upload_workout`/`schedule_workout` (activar perfil de workouts en su conector) usando `get_plan_for_device`. Opción B: **intervals.icu** (clave personal, `POST /events`, "Upload planned workouts" activado). Opción C: manual. | 🟡 |

**Alternativa si no se quiere usar la Personal API desde el backend:** guardar la clave en el **Keychain** (`expo-secure-store`) y hacer el pull desde el dispositivo (más cercano al espíritu "tus propios datos", pero iOS ejecuta las tareas en segundo plano de forma oportunista).

### Capa 1 — Semanas 1–4

1. **Enviar la solicitud Starter** (día 1, en paralelo al desarrollo) con política de privacidad + AI Transparency Statement + declaración de Anthropic como procesador IA.
2. Implementar el adaptador `garmin_official` detrás de un *feature flag*: OAuth PKCE (Edge Function), webhooks push (`/garmin/webhook` → cola → upsert idempotente), `user/permissions`, `DELETE user/registration` al desconectar, atribución en UI.
3. Implementar `WorkoutSink` Garmin Training API (crear workout V2 + schedule) y probar en reloj: carrera por ritmo/FC, bici por potencia, natación piscina por distancia + descansos, fuerza; brick como segmentos ⚠️.

### Capa 2 — Tras aprobación Starter

- `garmin_official` pasa a fuente prioritaria de lecturas (push, sin pedir claves) y **único** sink de entrenos.
- Personal API queda como **fallback/backfill** de histórico (Starter no da histórico).
- Puente Claude queda solo para **Training Readiness/Status** y planificación conversacional; el MCP deja de aceptar/reexponer métricas que ya tenemos por API oficial (cláusula 5.2(o)).
- Desactivar la ruta intervals.icu.

### Capa 3 — Futuro / amigos

- Amigos con otras marcas: HealthKit ya los cubre en lo básico; valorar Open Wearables (COROS/Polar/Suunto oficiales).
- Courses API (rutas), FIT export, Connect IQ glance.
- Si se superan 1.000 usuarios (improbable): Enterprise de pago.

### Matriz de decisión resumida

| Vía | Lee recuperación | Lee readiness/status | Lee actividades | Escribe entrenos | Aprobación | Coste | Riesgo términos | Riesgo técnico | Prioridad |
|---|---|---|---|---|---|---|---|---|---|
| Garmin Starter (OAuth + Training) | ✅ push | ❌ | ✅ | ✅ | Sí (formulario) | 0 € | Bajo (cumpliendo 6.4/15.10) | Bajo | **P0 (solicitar ya)** |
| Garmin Personal API | ✅ pull | ❌ | ✅ + FIT | ❌ | No | 0 € | Medio-bajo (gris) | Bajo | **P0 día 1** |
| Puente Claude (nuestro MCP) | ✅ | ✅ | ✅ | ✅ (vía conector usuario) | No | 0 € (suscripción Claude del usuario) | Bajo para nosotros | Medio (manual, LLM) | **P0 día 1** |
| HealthKit | 🟡 (sin HRV/BB) | ❌ | 🟡 | ❌ | No (Apple) | 0 € | Bajo | Bajo | **P1** |
| intervals.icu | ⚠️ bloqueo inminente | ❌ | ⚠️ | ✅ (~7 días) | No (clave) / Sí (OAuth) | 0 € | Medio | Medio (natación) | P2 (puente de escritura) |
| python-garminconnect en backend | ✅ | ✅ | ✅ | ✅ | No | 0 € | **Alto** | **Alto** | ❌ |
| Strava | — | — | ✅ | ❌ | Sí | 12 USD/mes | **Prohibitivo (IA/social)** | — | ❌ |
| Agregadores | ✅ | ❌ | ✅ | ✅ (Terra) | Sí | 300–600 USD/mes | Medio | Bajo | ❌ |
| FIT por USB | — | — | — | 🟡 | No | 0 € | Bajo | UX mala | P3 |

---

## 9. Diseño del adaptador (provider-agnostic)

### 9.1 Principios

1. **El dominio no conoce a Garmin:** `DailyMetrics`, `Activity`, `PlannedWorkout`, `WorkoutStep` son tipos propios.
2. **Una fila por (usuario, día, fuente)** en bruto + **vista fusionada** por prioridad de campo. Nunca se pierde lo que dijo cada fuente.
3. **Capacidades declaradas** por adaptador: la UI y el planificador saben qué hay y qué falta ("Sin HRV hoy: usando FC reposo + sueño").
4. **Procedencia y atribución** en cada dato (`provider`, `deviceModel`, `fetchedAt`, `rawRef`) → cumple Brand Guidelines y facilita depurar.
5. **Validación en la frontera** (Zod) para todo lo que entra: webhooks, Personal API, HealthKit y especialmente el puente Claude.
6. **Idempotencia:** clave natural por proveedor (`summaryId`, `activityId`, `HK uuid`, `external_id`).
7. **Inmutabilidad:** los adaptadores devuelven objetos nuevos; la fusión crea vistas, no muta filas de origen.

### 9.2 Tipos (TypeScript, compartidos app/Edge Functions)

```ts
// packages/domain/src/health.ts
export type ProviderId =
  | 'garmin_official'   // Starter OAuth + webhooks
  | 'garmin_personal'   // Personal API key
  | 'claude_bridge'     // snapshot escrito por el Claude del usuario vía nuestro MCP
  | 'healthkit'
  | 'intervals_icu'
  | 'manual';

export interface Provenance {
  readonly provider: ProviderId;
  readonly deviceModel?: string;        // "Forerunner 965" → atribución "Garmin Forerunner 965"
  readonly fetchedAt: string;           // ISO
  readonly externalId?: string;         // summaryId / activityId / HK uuid
  readonly detail?: string;             // p. ej. "garmin_mcp:get_training_readiness"
}

export type MetricKey =
  | 'sleep' | 'hrv' | 'restingHr' | 'bodyBattery' | 'stress'
  | 'trainingReadiness' | 'trainingStatus' | 'vo2max'
  | 'steps' | 'activeKcal' | 'respiration' | 'spo2' | 'weight';

export interface SleepSummary {
  readonly startTs?: string; readonly endTs?: string;
  readonly durationSec: number;
  readonly deepSec?: number; readonly lightSec?: number;
  readonly remSec?: number;  readonly awakeSec?: number;
  readonly score?: number;   // 0-100 (Garmin)
}

export interface DailyMetrics {
  readonly userId: string;
  readonly date: string;                // YYYY-MM-DD en zona local del usuario
  readonly provenance: Provenance;
  readonly sleep?: SleepSummary;
  readonly hrv?: { readonly overnightAvgMs?: number; readonly weeklyAvgMs?: number;
                   readonly status?: 'BALANCED' | 'UNBALANCED' | 'LOW' | 'POOR' | 'NONE' };
  readonly restingHr?: number;
  readonly bodyBattery?: { readonly atWake?: number; readonly max?: number; readonly min?: number;
                           readonly charged?: number; readonly drained?: number };
  readonly stress?: { readonly avg?: number; readonly max?: number; readonly highSec?: number };
  readonly trainingReadiness?: { readonly score: number; readonly level?: string;
                                 readonly recoveryTimeHours?: number };
  readonly trainingStatus?: { readonly status?: string; readonly acuteLoad?: number;
                              readonly chronicLoad?: number; readonly acwr?: number };
  readonly vo2max?: { readonly running?: number; readonly cycling?: number };
  readonly steps?: number;
  readonly activeKcal?: number;
  readonly respirationAvg?: number;
  readonly spo2Avg?: number;
  readonly weightKg?: number;
}

export type Sport =
  | 'swim_pool' | 'swim_open_water' | 'bike' | 'bike_indoor' | 'run' | 'run_trail'
  | 'brick' | 'strength' | 'mobility' | 'padel' | 'football' | 'walk' | 'other';

export interface Activity {
  readonly id: string;                  // uuid propio
  readonly userId: string;
  readonly provenance: Provenance;
  readonly sport: Sport;
  readonly startTs: string;
  readonly durationSec: number;
  readonly movingSec?: number;
  readonly distanceM?: number;
  readonly elevationGainM?: number;
  readonly avgHr?: number; readonly maxHr?: number;
  readonly avgPowerW?: number; readonly normPowerW?: number;
  readonly trainingLoad?: number;       // Garmin "activity training load" o TSS
  readonly aerobicTE?: number; readonly anaerobicTE?: number;
  readonly kcal?: number;
  readonly rpe?: number;                // 1-10, declarado por el usuario
  readonly fitFilePath?: string;        // Supabase Storage
  readonly plannedWorkoutId?: string;   // enlace plan↔ejecución
}
```

```ts
// packages/domain/src/workouts.ts
export type StepIntensity = 'warmup' | 'active' | 'recovery' | 'rest' | 'cooldown';
export type StepDuration =
  | { readonly type: 'time'; readonly seconds: number }
  | { readonly type: 'distance'; readonly meters: number }
  | { readonly type: 'open' }                         // hasta pulsar "lap"
  | { readonly type: 'calories'; readonly kcal: number };
export type StepTarget =
  | { readonly type: 'none' }
  | { readonly type: 'hr'; readonly low: number; readonly high: number }
  | { readonly type: 'hr_zone'; readonly zone: 1 | 2 | 3 | 4 | 5 }
  | { readonly type: 'power'; readonly low: number; readonly high: number }
  | { readonly type: 'pace'; readonly lowSecPerKm: number; readonly highSecPerKm: number }
  | { readonly type: 'swim_pace'; readonly lowSecPer100m: number; readonly highSecPer100m: number }
  | { readonly type: 'cadence'; readonly low: number; readonly high: number }
  | { readonly type: 'rpe'; readonly value: number };

export type WorkoutStep =
  | { readonly kind: 'step'; readonly intensity: StepIntensity; readonly duration: StepDuration;
      readonly target: StepTarget; readonly note?: string;
      readonly swimStroke?: 'free' | 'back' | 'breast' | 'fly' | 'im' | 'drill' | 'kick' }
  | { readonly kind: 'repeat'; readonly times: number; readonly steps: readonly WorkoutStep[] };

export interface WorkoutSegment { readonly sport: Sport; readonly steps: readonly WorkoutStep[] }

export interface PlannedWorkout {
  readonly id: string;
  readonly userId: string;
  readonly date: string;                 // YYYY-MM-DD
  readonly timeOfDay?: 'morning' | 'midday' | 'evening';
  readonly sport: Sport;                 // 'brick' si hay varios segmentos
  readonly title: string;
  readonly description?: string;
  readonly segments: readonly WorkoutSegment[];
  readonly estDurationSec: number;
  readonly targetLoad?: number;
  readonly poolLengthM?: 25 | 50;
  readonly status: 'draft' | 'planned' | 'completed' | 'skipped' | 'moved';
  readonly sharedWith: 'private' | 'friends' | 'partner'; // social: se comparte el plan, no la salud
}
```

### 9.3 Interfaces de adaptador

```ts
// packages/integrations/src/ports.ts
export interface ProviderCapabilities {
  readonly metrics: readonly MetricKey[];
  readonly activities: boolean;
  readonly fitFiles: boolean;
  readonly historyDays: number;          // cuánto histórico podemos pedir al conectar
  readonly delivery: 'push' | 'pull' | 'on_device' | 'agent';
}

export interface Connection {
  readonly userId: string;
  readonly provider: ProviderId;
  readonly status: 'active' | 'expiring' | 'expired' | 'revoked' | 'error';
  readonly secretRef?: string;           // id en Supabase Vault (nunca el secreto en claro)
  readonly expiresAt?: string;           // clave Personal API / refresh token
  readonly scopes?: readonly string[];   // p. ej. WORKOUT_IMPORT, HEALTH_EXPORT
  readonly externalUserId?: string;      // Garmin API userId
}

export interface DateRange { readonly from: string; readonly to: string }

export interface MetricsProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  fetchDailyMetrics(conn: Connection, range: DateRange): Promise<readonly DailyMetrics[]>;
  fetchActivities(conn: Connection, range: DateRange): Promise<readonly Activity[]>;
  /** Solo proveedores push: traduce un webhook a eventos normalizados. */
  parseWebhook?(body: unknown): Promise<readonly NormalizedEvent[]>;
}

export type NormalizedEvent =
  | { readonly kind: 'daily'; readonly data: DailyMetrics }
  | { readonly kind: 'activity'; readonly data: Activity }
  | { readonly kind: 'deregistration'; readonly externalUserId: string }
  | { readonly kind: 'permissions'; readonly externalUserId: string; readonly scopes: readonly string[] };

export interface WorkoutSinkCapabilities {
  readonly sports: readonly Sport[];
  readonly multisport: boolean;
  readonly horizonDays?: number;         // intervals.icu ≈ 7
  readonly targets: readonly StepTarget['type'][];
}

export interface ExternalWorkoutRef {
  readonly sink: 'garmin_training' | 'intervals_icu' | 'claude_bridge' | 'fit_file';
  readonly externalId: string;           // workoutId / eventId
  readonly scheduleId?: string;
}

export interface WorkoutSink {
  readonly id: ExternalWorkoutRef['sink'];
  readonly capabilities: WorkoutSinkCapabilities;
  push(conn: Connection, w: PlannedWorkout): Promise<ExternalWorkoutRef>;
  update(conn: Connection, ref: ExternalWorkoutRef, w: PlannedWorkout): Promise<ExternalWorkoutRef>;
  remove(conn: Connection, ref: ExternalWorkoutRef): Promise<void>;
}
```

Implementaciones previstas:

| Adaptador | Implementa | Dónde corre |
|---|---|---|
| `GarminPersonalProvider` | `MetricsProvider` (pull) | Edge Function + pg_cron (o dispositivo) |
| `GarminOfficialProvider` | `MetricsProvider` (push, `parseWebhook`) | Edge Function `garmin-webhook` |
| `HealthKitProvider` | `MetricsProvider` (on_device) | App (módulo nativo), sube a Supabase |
| `ClaudeBridgeProvider` | `MetricsProvider` (agent) | Nuestro MCP (`upsert_daily_metrics`) |
| `IntervalsProvider` | `MetricsProvider` (solo wellness no-Garmin / manual) | Edge Function |
| `GarminTrainingSink` | `WorkoutSink` (JSON V2 + schedule) | Edge Function |
| `IntervalsSink` | `WorkoutSink` (`POST /events` con `external_id`) | Edge Function |
| `ClaudeBridgeSink` | `WorkoutSink` (expone el JSON V2 por `get_plan_for_device`; Claude lo sube) | Nuestro MCP |
| `FitFileSink` | `WorkoutSink` (`@garmin/fitsdk` Encoder → Storage) | Edge Function |

### 9.4 Fusión por prioridad de campo

```ts
// packages/integrations/src/merge.ts
const PRIORITY: Readonly<Record<MetricKey, readonly ProviderId[]>> = {
  hrv:               ['garmin_official', 'garmin_personal', 'claude_bridge', 'healthkit', 'intervals_icu', 'manual'],
  bodyBattery:       ['garmin_official', 'garmin_personal', 'claude_bridge', 'manual'],
  stress:            ['garmin_official', 'garmin_personal', 'claude_bridge', 'manual'],
  sleep:             ['garmin_official', 'garmin_personal', 'claude_bridge', 'healthkit', 'intervals_icu', 'manual'],
  restingHr:         ['garmin_official', 'garmin_personal', 'claude_bridge', 'healthkit', 'intervals_icu', 'manual'],
  trainingReadiness: ['claude_bridge', 'manual'],           // no existe en APIs oficiales
  trainingStatus:    ['claude_bridge', 'manual'],
  vo2max:            ['garmin_official', 'claude_bridge', 'healthkit'],
  steps:             ['garmin_official', 'garmin_personal', 'healthkit', 'claude_bridge'],
  activeKcal:        ['garmin_official', 'garmin_personal', 'healthkit', 'claude_bridge'],
  respiration:       ['garmin_official', 'garmin_personal', 'claude_bridge'],
  spo2:              ['garmin_official', 'garmin_personal', 'claude_bridge'],
  weight:            ['garmin_official', 'garmin_personal', 'healthkit', 'manual'],
};

/** Devuelve un objeto NUEVO con, por cada métrica, el valor de la fuente de mayor prioridad. */
export function mergeDaily(rows: readonly DailyMetrics[]): MergedDaily { /* … */ }
```

`MergedDaily` incluye por campo `{ value, provenance }` para poder pintar la atribución correcta ("HRV · Garmin Forerunner 965").

**Deduplicación de actividades:** misma persona, `|startTs Δ| ≤ 120 s`, mismo deporte normalizado y `|duración Δ| ≤ 10 %` → se conserva la de mayor prioridad (`garmin_official` > `garmin_personal` > `healthkit` > `claude_bridge` > `intervals_icu` > `manual`) y se enlazan los `externalId` del resto.

### 9.5 Tablas Supabase (esquema mínimo)

| Tabla | Clave | Notas |
|---|---|---|
| `provider_connections` | (`user_id`, `provider`) | estado, `secret_ref` (Vault), `expires_at`, `scopes`, `external_user_id`, `last_sync_at`, `last_error` |
| `daily_metrics_raw` | (`user_id`, `date`, `provider`) | columnas tipadas + `raw jsonb` (solo depuración; purgar a 30 días) |
| `daily_metrics` (vista/materializada) | (`user_id`, `date`) | resultado de `mergeDaily` + `readiness_own` |
| `activities` | `id`; único (`provider`, `external_id`) | + `fit_file_path` |
| `planned_workouts` | `id` | dominio propio; `shared_with` |
| `workout_sync` | (`planned_workout_id`, `sink`) | `external_id`, `schedule_id`, `status` (`pending/synced/failed/stale`), `last_error`, `synced_hash` |
| `webhook_inbox` | `id`; único (`provider`, `dedupe_key`) | cola de webhooks Garmin (responder 200 y procesar luego) |
| `ai_consents` | `user_id` | consentimiento explícito IA (Garmin 15.10 / RGPD art. 9), fecha, versión del texto, revocación |

RLS: métricas y actividades **solo el propio usuario**; `planned_workouts` visibles a amigos según `shared_with`. Los amigos **nunca** leen `daily_metrics`.

### 9.6 Jobs y flujos

1. **Pull Personal API** (`pg_cron` 07:30/10:00 Europe/Madrid): para cada conexión `garmin_personal` activa → canjear clave → JWT (cachear 23 h) → `dailysummaries`, `hrv`, `dailySleep`, `bodyBattery`, `stress`, `activities` de los últimos 3 días (corrige datos tardíos) → upsert `daily_metrics_raw`/`activities` → recalcular `daily_metrics` → push notification si readiness baja.
2. **Aviso de caducidad de clave:** 7 días antes de `expires_at` → notificación "Renueva tu clave de Garmin".
3. **Webhook Garmin oficial:** `POST /garmin-webhook` → validar → insertar en `webhook_inbox` → 200 → worker procesa con `parseWebhook` → upsert.
4. **Sync de entrenos:** al aprobar el plan semanal → para cada `planned_workout` cuyo `hash` cambió → `WorkoutSink.push/update`; borrado → `remove`. Reintentos exponenciales; estado visible en la ficha ("En tu reloj ✓").
5. **Puente Claude:** `upsert_daily_metrics` valida con Zod, rechaza rangos imposibles (HRV 0–300 ms, FC reposo 25–120, Body Battery 0–100…), marca `provider = claude_bridge`.

---

## 10. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Garmin tarda o rechaza Starter | Media | Alto (sin escritura oficial) | Capa 0 funciona sin Starter; solicitar el día 1; política de privacidad impecable |
| Garmin restringe la Personal API para usos "de app" | Media | Medio | Adaptador intercambiable; puente Claude + HealthKit como respaldo |
| Bloqueo del conector no oficial del usuario | Media | Medio (pierde readiness/status) | Readiness propia (D8); migrar lecturas a `garmin-personal-mcp` oficial |
| intervals.icu cambia sus términos de escritura | Baja | Bajo | Solo puente temporal |
| Cláusula 5.2(o) aplicada a nuestro MCP | Media | Medio | Declarar Anthropic en la solicitud; MCP sirve planes/derivados, no reexporta datos de la API Garmin |
| Training API ignora objetivos de intervalos / brick no compatible | Media | Medio | Matriz de pruebas en reloj real; fallback: brick = 2 workouts el mismo día |
| Coste futuro (Garmin 10.1) | Baja | Bajo | Monitorizar; Starter gratis ≤1.000 usuarios |
| RGPD (salud = categoría especial) | — | Alto | Consentimiento explícito, datos en región UE de Supabase, borrado al desconectar (+ `DELETE user/registration`) |
| Cambios de endpoints Personal API (reflejan Garmin Connect web) | Media | Bajo | Tests de contrato diarios + alerta |

---

## 11. Checklist de acciones

- [ ] Publicar política de privacidad con **AI Transparency Statement** y uso de HealthKit.
- [ ] Enviar **Starter access request** (Health + Activity + Training; declarar Anthropic Claude API, Supabase UE; <20 usuarios/12 meses).
- [ ] Cada usuario: crear **Personal API key** (1 año) en `connect.garmin.com/app/settings/personalApiToken`.
- [ ] Portar a TypeScript (Deno) el cliente oficial de la Personal API (Apache-2.0) → `GarminPersonalProvider`.
- [ ] Integrar `@kingstinct/react-native-healthkit` 16.x con config plugin + background delivery (dev build EAS).
- [ ] Servidor MCP propio con `get_week_context`, `upsert_daily_metrics`, `upsert_activities`, `log_event`, `propose_week_plan`, `get_plan_for_device` (ver doc de integración Claude).
- [ ] En el conector Garmin de cada usuario: habilitar herramientas de workouts (`upload_workout`, `schedule_workout`) si se elige la opción A.
- [ ] (Opcional) Cuentas intervals.icu + "Upload planned workouts" si se elige la opción B.
- [ ] Implementar fusión por prioridad + readiness propia + atribución "Garmin [modelo]".
- [ ] Tras aprobación: OAuth PKCE (Edge Function con `client_secret`), webhooks push, Training API, pruebas en reloj (carrera, bici, natación piscina, fuerza, brick).

---

## 12. Fuentes

**Garmin (oficial)**
- [Garmin Connect Developer Program – overview (tiers Personal/Starter/Enterprise)](https://developer.garmin.com/gc-developer-program/overview/)
- [Cliente oficial Personal API (Python, Apache-2.0)](https://github.com/garmin/connect-personal-api-python)
- [OAuth2 PKCE Specification (PDF, jun-2025)](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf)
- [Garmin Connect Developer Program Agreement FRM-0952 Rev. B (PDF)](https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf)
- [API Brand Guidelines (PDF, 30-jun-2025)](https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf) · [Brand guidelines overview](https://developer.garmin.com/brand-guidelines/overview/)
- [Garmin compra TrainingPeaks y TrainHeroic (22-jul-2026)](https://www.garmin.com/en-US/newsroom/press-release/corporate/garmin-acquires-trainingpeaks-and-trainheroic-leading-endurance-and-strength-training-platforms-for-athletes-and-coaches/)
- [Foro Garmin: payload Training API V2](https://forums.garmin.com/developer/connect-iq/f/discussion/431359/no-interval-details-in-workouts)
- [Foro Garmin: API paused (2026)](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-andriod/441607/garmin-connect-api-access-paused-for-months-what-are-startups-supposed-to-do)
- [Foro Garmin: TLS fingerprinting](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/433892/tls-fingerprinting-blocks-third-party-clients/2023526) · [429 bloqueo de cuenta](https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours/2029273)
- [Foro Garmin: Apple Health (RHR a medianoche, reenvíos)](https://forums.garmin.com/apps-software/mobile-apps-web/f/connect-iq-store-ios/408720/garmin-connect-corrupting-apple-health/1935502)
- [Foro Garmin: importar workouts FIT](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/389325/can-i-upload-custom-workouts-to-my-garmin-without-using-the-workout-creator-built-into-garmin-connect/1852014) · [JS SDK Encoder](https://forums.garmin.com/developer/fit-sdk/f/discussion/361529/ability-to-encode-an-activity-using-javascript-sdk/)

**Prensa / análisis 2026**
- [DC Rainmaker – Garmin revamps Connect Developer API (21-oct-2026)](https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html)
- [Garmin Rumors – Personal, Starter, Enterprise](https://garminrumors.com/garmin-connect-developer-program-personal-starter-enterprise/)
- [idevice – free personal keys and a fee for big apps](https://idevice.com/garmin-reopens-its-connect-api-with-free-personal-keys-and-a-fee-for-big-apps.md)
- [Tredict – Personal API no envía workouts](https://www.tredict.com/blog/garmin_personal_api_chatgpt_and_claude/) · [Tredict – Training API](https://tredict.com/blog/garmin_training_api_integration)
- [Shape Calendar – Garmin Personal API con Claude](https://shapecalendar.com/guides/garmin-personal-api) · [garmin-personal-mcp](https://github.com/Shape-Calendar/garmin-personal-mcp)
- [the5krunner – Garmin freezes developer API (14-sep-2026)](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/)
- [the5krunner – Garmin API terms close Intervals Pro (14-oct-2026)](https://the5krunner.com/2026/10/14/garmin-api-intervals-third-party-apps/)
- [Gadgets & Wearables – Intervals Pro shuts down](https://gadgetsandwearables.com/2026/10/14/garmin-api-intervals-pro-shutdown/)
- [Terra – Garmin program pause](https://tryterra.co/blog/garmin-connect-developer-program-pause) · [Momentum – roadmap](https://www.themomentum.ai/blog/garmin-developer-program-closed-roadmap)
- [ROOK – Can you still get Garmin API access in 2026?](https://tryrook.io/blog/garmin-connect-api-access/)
- [PR open-health-sync #214 (tiers, Fitbit 2-nov-2026)](https://github.com/soma-intelligence/open-health-sync/pull/214)
- [Open Wearables – Garmin developer guide](https://openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics) · [docs proveedor Garmin](https://openwearables.io/docs/providers/garmin-api-integration.md)
- [Nango – Garmin OAuth2](https://nango.dev/docs/api-integrations/garmin-oauth2.md)
- [DC Rainmaker – Strava sues Garmin (oct-2025)](https://www.dcrainmaker.com/2025/10/strava-sues-garmin-demands-stop-selling-devices.html)

**Apple Health**
- [the5krunner – Garmin y Apple Health (jun-2025)](https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/)
- [Ultrafit360 – qué sincroniza (oct-2026)](https://ultrafit360.com/blog/garmin-apple-health-health-connect)
- [Apple Community – lista de tipos](https://discussions-cn-prz.apple.com/thread/251525307)
- [Vitals Sync (App Store) – métricas que Garmin no envía](https://mwm.ai/apps/vitals-sync/6780623839)
- [@kingstinct/react-native-healthkit](https://classic.yarnpkg.com/en/package/@kingstinct/react-native-healthkit) · [Spike – Garmin en HealthKit/Health Connect](https://spikeapi.com/blog/why-integrate-garmin-api-directly)

**No oficial**
- [matin/garth (deprecado)](https://github.com/matin/garth) · [garth-ng](https://pypi.org/project/garth-ng/)
- [cyberjunky/python-garminconnect](https://github.com/cyberjunky/python-garminconnect) · [releases](https://github.com/cyberjunky/python-garminconnect/releases)
- [Taxuspt/garmin_mcp](https://github.com/Taxuspt/garmin_mcp)
- [futureweb/garmin-intervals-bridge](https://github.com/futureweb/garmin-intervals-bridge)

**intervals.icu**
- [API access (hilo oficial)](https://forum.intervals.icu/t/api-access-to-intervals-icu/609) · [página 38 (9-oct-2026)](https://forum.intervals.icu/t/api-access-to-intervals-icu/609?page=38)
- [OAuth support](https://forum.intervals.icu/t/intervals-icu-oauth-support/2759) · [Integration Cookbook](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090.md)
- [Upload planned workouts to Garmin Connect](https://forum.intervals.icu/t/upload-planned-workouts-to-garmin-connect/1521) · [Swim workout planning for Garmin](https://forum.intervals.icu/t/swim-workout-planning-for-garmin/75705)
- [domestique #29 – impacto del bloqueo](https://github.com/platypus45/domestique/issues/29)

**Strava**
- [Sahha – Strava API changes 2026](https://sahha.ai/blog/strava-api-changes-2026/) · [appsforstrava – Strava API pricing 2026](https://appsforstrava.com/blog/strava-developer-program-changes-2026)
- [Foro intervals.icu – Strava new terms](https://forum.intervals.icu/t/strava-api-update-new-terms-subs-required-for-api-access/130240)
- [DC Rainmaker – Strava's changes (nov-2024)](https://dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html) · [the5krunner – clarification](https://the5krunner.com/2024/11/20/strava-issues-clarification/)

**Agregadores**
- [Terra pricing](https://tryterra.co/pricing) · [Sahha – comparativas ROOK/Thryve/Spike/Junction](https://sahha.ai/compare/rook-alternatives/)
