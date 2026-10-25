# Puesta en marcha de Rebufo (de cero a TestFlight)

Guía paso a paso para tenerlo funcionando en vuestros iPhones. Todo se hace desde **Windows**: las
builds de iOS se compilan en los Mac de EAS (Expo) en la nube.

> Orden recomendado: **0 → 1** (probar ya, sin servidor) → **2** (backend) → **3** (app conectada) →
> **4** (TestFlight) → **5–7** (Claude, Garmin, extras).

---

## 0. Requisitos

| Qué | Para qué | Coste |
|---|---|---|
| Node 24 (ya lo tienes) | Herramientas | — |
| Cuenta de **Expo** (expo.dev) | Builds en la nube (EAS) y push | Gratis (15 builds iOS/mes) |
| **Apple Developer** (ya lo tienes) | Firmar la app y TestFlight | 99 €/año |
| Proyecto de **Supabase** (supabase.com) | Base de datos, login, funciones | Gratis (se pausa tras 7 días sin uso) |
| API key de **Anthropic** (console.anthropic.com) | Solo para el "Coach IA" dentro de la app | Pago por uso (céntimos por plan) |
| Claude **Pro/Max** de cada uno | "Conecta tu Claude" (usa vuestra suscripción) | Lo que ya pagáis |
| Clave **Garmin Personal API** de cada uno | Métricas de Garmin automáticas | Gratis |

---

## 1. Probar ya en el navegador (modo demo, sin servidor)

```bash
npm install
```

```bash
npm run web
```

Sin variables de Supabase la app arranca en **modo demo**: datos de ejemplo (tú = Diego, tu
compañero = Álex), todo funciona en local y el coach usa el motor de reglas. Cualquier código de
email vale para entrar.

Tests y comprobaciones:

```bash
npm run test:all
```

---

## 2. Backend en Supabase

### 2.1 Crear el proyecto
1. supabase.com → *New project* → región **EU (Frankfurt o París)**.
2. *Project Settings → API keys*: copia la **URL** y la **publishable key** (`sb_publishable_…`).
   La **secret key** (`sb_secret_…`) NO va en la app, solo en el servidor.

### 2.2 Subir el esquema y la configuración

```bash
npx supabase login
```

```bash
npx supabase link --project-ref TU_REF
```

```bash
npx supabase db push
```

```bash
npx supabase config push
```

### 2.3 Una sola vez en el *SQL Editor* (tareas programadas y push)

```sql
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select vault.create_secret('https://TU_REF.supabase.co', 'project_url');
select vault.create_secret('sb_secret_XXXXXXXX', 'secret_key');
select private.schedule_platform_jobs();
```

Esto activa el envío de push al crearse un aviso y programa las tareas (sincronización Garmin a las
06:30 y 09:30, barrido de push cada 5 min). Sin este paso todo lo demás funciona, pero no llegan push.

### 2.4 Secretos de las funciones

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... EXPO_ACCESS_TOKEN=token_de_expo
```

```bash
npx supabase secrets set GARMIN_KEY_SECRET="$(openssl rand -base64 48)"
```

- `ANTHROPIC_API_KEY`: opcional. Sin ella el Coach IA usa el motor de reglas. Cada usuario debe dar
  su permiso en la app antes de que se envíe nada a Anthropic.
- `GARMIN_KEY_SECRET`: cifra las claves de Garmin guardadas. **No lo cambies** después (habría que
  reconectar Garmin). El segundo comando funciona en Git Bash.
- `EXPO_ACCESS_TOKEN`: expo.dev → *Account settings → Access tokens* (activa "Enhanced push security").

**Revocar Sign in with Apple al borrar la cuenta** (lo pide Apple): en developer.apple.com →
*Keys* crea una clave con *Sign in with Apple*, descarga el `.p8` y guarda:

```bash
npx supabase secrets set APPLE_TEAM_ID=XXXXXXXXXX APPLE_KEY_ID=YYYYYYYYYY APPLE_CLIENT_ID=com.diegomolinacatala.rebufo
```

```bash
npx supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_YYYYYYYYYY.p8)"
```

### 2.5 Desplegar las funciones (sin Docker)

```bash
npx supabase functions deploy --use-api
```

### 2.6 Login
- *Authentication → Providers → Email*: activado. La plantilla con el **código de 6 dígitos**
  (`supabase/templates/otp.html`) se sube con `npx supabase config push`.
- El correo por defecto de Supabase tiene límites muy bajos: para invitar a amigos configura un SMTP
  propio (*Authentication → SMTP*, p. ej. Resend).
- **Sign in with Apple** (recomendado en iOS): antes de `config push`, crea `supabase/.env` (no se sube
  a git) con `SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID=com.diegomolinacatala.rebufo,com.diegomolinacatala.rebufo.dev`
  (o añádelos en *Providers → Apple → Client IDs*). Para el login nativo no hace falta secreto.

---

## 3. Conectar la app al backend

Crea `.env.local` en la raíz (no se sube a git):

```bash
EXPO_PUBLIC_SUPABASE_URL=https://TU_REF.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_...
```

Si quieres otro bundle id: `APP_BUNDLE_ID=com.tunombre.rebufo` (cámbialo antes de la primera build).
Cuando publiques la política de privacidad, añade `EXPO_PUBLIC_PRIVACY_URL=https://…` para que la
pantalla *Privacidad* de la app enlace a ella.

---

## 4. Builds con EAS y TestFlight

```bash
npx eas-cli@latest login
```

```bash
npx eas-cli@latest init
```

`init` crea el proyecto en expo.dev y te da un **projectId**: añádelo a `.env.local` como
`EXPO_PUBLIC_EAS_PROJECT_ID=...` (activa push y actualizaciones OTA).

Variables para las builds en la nube (una vez por variable):

```bash
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://TU_REF.supabase.co --visibility plaintext
```

```bash
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_KEY --value sb_publishable_... --visibility plaintext
```

```bash
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_EAS_PROJECT_ID --value TU_PROJECT_ID --visibility plaintext
```

(Si tu versión de la CLI usa `env:set`, el comando es el mismo cambiando el verbo.)

**Primera build de producción — hazla interactiva** (te pedirá tu Apple ID + 2FA para crear
certificados, el App Group de los widgets, HealthKit y push):

```bash
npx eas-cli@latest build -p ios --profile production --auto-submit
```

En ~30–60 min la build sube a App Store Connect y aparece en **TestFlight** (10–15 min de procesado).

**Política de privacidad**: App Store Connect la pide (la app usa Apple Salud). Rellena y publica
`docs/PRIVACY.md` (GitHub Pages, Notion…) y pega la URL en *App Store Connect → App → Privacidad de la app*.

**Añadir a tu compañero como tester interno** (sin revisión de Apple):
1. App Store Connect → *Usuarios y acceso* → `+` → su email → rol **Developer** (o Marketing),
   acceso solo a esta app.
2. Él acepta la invitación por email.
3. App → *TestFlight* → *Internal Testing* → crea un grupo con distribución automática → añádelo.
4. Instala **TestFlight** en su iPhone y acepta.

Para más amigos: grupo **externo** con enlace público (la primera build pasa una revisión ligera).

**Actualizaciones rápidas sin build** (solo cambios de JS):

```bash
npx eas-cli@latest update --channel production --environment production --message "cambios"
```

Cambios en permisos, widgets, plugins o librerías nativas → nueva build. La versión de runtime se calcula
sola (`fingerprint`), así que una actualización OTA nunca llega a una build con código nativo distinto.

---

## 5. Conecta tu Claude (cada uno el suyo)

1. En la app: **Yo → Conecta tu Claude → Generar URL**. Cópiala (es como una contraseña).
2. En **claude.ai** (web o escritorio): *Ajustes → Conectores → Añadir conector personalizado* →
   pega la URL → autenticación **sin inicio de sesión**.
3. En un chat activa **Rebufo** y tu conector de **Garmin** y pide, por ejemplo:
   - "Planifica mi semana en Rebufo con mis datos de Garmin y mis huecos."
   - "Hoy he jugado al pádel 90' a tope, reorganiza mi semana."
   - "Guarda en Rebufo mi VFC, Body Battery y Training Readiness de Garmin de hoy."
4. Los cambios llegan a la app como **propuesta** (notificación) y los aceptas uno a uno.

Si la URL se filtra: revócala en la app y genera otra (edita la URL del conector en claude.ai).

---

## 6. Garmin

- **Personal API (oficial, desde oct-2026)**: cada uno crea su clave en
  https://connect.garmin.com/app/settings/personalApiToken (elige caducidad de 1 año) y la pega en
  **Yo → Conexiones → Garmin**. Rebufo descarga sueño, VFC, Body Battery, FC en reposo y actividades
  cada mañana y marca los entrenos como hechos.
- **Apple Salud**: en Garmin Connect activa la sincronización con Salud y en Rebufo
  **Conexiones → Apple Salud**. Aporta entrenos, sueño y FC (no VFC ni VO2max).
- **Enviar entrenos al reloj**: hoy vía vuestro Claude (herramienta `get_plan_for_device` + vuestro
  conector Garmin). Para hacerlo directo desde la app hay que pedir el nivel **Starter** del Garmin
  Connect Developer Program (gratis, con revisión): ver `docs/research/04-integracion-garmin.md`.

---

## 7. Widgets y notificaciones

- Widgets: mantén pulsada la pantalla de inicio → `+` → **Rebufo** → *Hoy*, *Cuenta atrás* o (en la
  pantalla de bloqueo) *Próximo entreno*.
- Notificaciones: recordatorios de sesión, parte de la mañana, check-in por la noche y aviso del
  domingo para planificar (configurables en **Yo → Notificaciones**). Las invitaciones a quedadas y
  las propuestas de cambios llegan como push.

---

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| La app entra en modo demo en TestFlight | Faltan `EXPO_PUBLIC_SUPABASE_*` en el entorno `production` de EAS. |
| El proyecto de Supabase está "paused" | Plan gratis tras 7 días sin uso: *Restore* en el dashboard. |
| Widgets vacíos | Abre la app una vez; si cambiaste el bundle id, reinstala. |
| No llegan push | Comprueba `EXPO_ACCESS_TOKEN`, el `projectId` y los secretos de Vault (§2.3). |
| Coach IA responde "modo reglas" | Falta `ANTHROPIC_API_KEY` en los secretos de Supabase. |
