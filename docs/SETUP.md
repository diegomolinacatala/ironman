# Puesta en marcha de Road to Ironman (de cero a TestFlight)

Todo se hace desde **Windows**. La app de iPhone la compila un **Mac de GitHub Actions** y la sube a
TestFlight, igual que Tasks (`.github/workflows/ios.yml`). No hace falta cuenta de Expo.

Orden: **1 Supabase → 2 Apple → 3 secretos de Apple en Supabase → 4 GitHub → 5 primera build →
6 TestFlight → 7 en el iPhone → 8 Garmin y Claude → 9 política de privacidad.**

> **Estado (26-oct-2026):** hechos el paso 1 completo (proyecto `gganxjgvdbcwuahfrlvy`, migraciones,
> configuración de login, SQL de una vez, `GARMIN_KEY_SECRET`, funciones desplegadas) y, del paso 4,
> las variables `APPLE_TEAM_ID`, `EXPO_PUBLIC_SUPABASE_*` y los secretos `ASC_KEY_P8` / `ASC_KEY_ID`.
> La primera build sin firmar en GitHub Actions compila (Xcode 26.6, ~35 min). Pendiente: paso 2
> (Apple), `ASC_ISSUER_ID`, paso 3 y lo de cada usuario en el iPhone.
>
> **Login por email:** en el plan gratuito Supabase envía un **enlace** (no un código); la app lo
> acepta (`roadtoironman://auth/callback`). Para recibir un código de 6 dígitos hace falta SMTP propio y
> descomentar las plantillas en `supabase/config.toml`.

> Antes de nada, para probar sin servidor: `npm install` y `npm run web` (modo demo en el navegador).

---

## 1. Supabase (≈25 min)

1. **Proyecto:** supabase.com → *New project* → nombre `road-to-ironman`, región **West EU (Paris)** o
   **Central EU (Frankfurt)**. Guarda la contraseña de la base de datos.
2. **Claves** (*Project Settings → API Keys*): apunta la **Project URL** (`https://XXXX.supabase.co`,
   `XXXX` es el *project ref*), la **publishable key** (`sb_publishable_…`) y la **secret key**
   (`sb_secret_…`, solo para el servidor).
3. **Conectar el repo** (en la carpeta del proyecto; el segundo pide la contraseña):

```bash
npx supabase login
```

```bash
npx supabase link --project-ref XXXX
```

4. **Base de datos** (tablas, permisos, funciones SQL):

```bash
npx supabase db push
```

5. **Login con Apple y correo con código.** Crea `supabase/.env` (no se sube a git) con:

```
SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID=io.github.diegomolinacatala.ironman
```

y sube la configuración de autenticación (incluye la plantilla del email con el código de 6 dígitos):

```bash
npx supabase config push
```

6. **Una sola vez, en el SQL Editor** (push al crearse un aviso y tareas programadas):

```sql
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select vault.create_secret('https://XXXX.supabase.co', 'project_url');
select vault.create_secret('sb_secret_TU_CLAVE', 'secret_key');
select private.schedule_platform_jobs();
```

7. **Clave que cifra las claves de Garmin** (Git Bash; no la cambies nunca después):

```bash
npx supabase secrets set GARMIN_KEY_SECRET="$(openssl rand -base64 48)"
```

8. **Desplegar las funciones del servidor** (sin Docker):

```bash
npx supabase functions deploy mcp ics push-dispatch garmin apple-revoke --use-api
```

9. *Recomendado:* *Authentication → Emails → SMTP* con un proveedor propio (p. ej. Resend, gratis): el
   correo por defecto de Supabase solo envía unos pocos emails por hora.

> En el plan gratuito, un proyecto sin uso durante 7 días se pausa: *Restore* en el dashboard.

---

## 2. Apple Developer y App Store Connect (≈30 min)

En **developer.apple.com → Certificates, Identifiers & Profiles**:

1. **Team ID:** *Membership details* → apúntalo.
2. **App Group:** *Identifiers* → **+** → *App Groups* → `group.io.github.diegomolinacatala.ironman`.
3. **Identificador de la app:** *Identifiers* → **+** → *App IDs* → *App* → descripción
   `Road to Ironman`, *Bundle ID* explícito `io.github.diegomolinacatala.ironman`. Marca:
   - **App Groups** → *Configure* → el grupo del paso 2.
   - **HealthKit**.
   - **Push Notifications**.
   - **Sign In with Apple** (como *primary App ID*).
4. **Identificador de los widgets:** otro *App ID* con *Bundle ID*
   `io.github.diegomolinacatala.ironman.ExpoWidgetsTarget` y solo **App Groups** (el mismo grupo).
5. **Clave para push y Sign in with Apple:** *Keys* → **+** → nombre `Road to Ironman` → marca
   **Apple Push Notifications service (APNs)** y **Sign in with Apple** (*Configure* → primary App ID
   `io.github.diegomolinacatala.ironman`) → *Register* → **descarga el `.p8`** (solo una vez) y apunta el
   **Key ID**. Si ya tienes una clave de APNs (p. ej. la de Tasks) sirve para las push de todas tus
   apps; entonces crea una clave solo con *Sign in with Apple* para esta app.

En **appstoreconnect.apple.com**:

6. **Crear la app:** *Apps* → **+** → *Nueva app* → iOS, nombre `Road to Ironman`, idioma principal
   **Español (España)**, bundle ID `io.github.diegomolinacatala.ironman`, SKU `road-to-ironman`.
   Si el nombre está cogido en la App Store usa una variante (p. ej. `Road to Ironman · Tri`): en la
   pantalla del iPhone se seguirá viendo "Road to Ironman".
7. **Clave de API de App Store Connect** (la que usa GitHub para subir las builds): si conservas el
   `.p8` de la de Tasks, reutilízalo (mismo Key ID e Issuer ID). Si no: *Usuarios y acceso* →
   *Integraciones* → *App Store Connect API* → *Claves de equipo* → **+** → rol **App Manager** →
   descarga el `.p8` y apunta **Key ID** e **Issuer ID**.

> "IRONMAN" es una marca registrada. Para TestFlight interno (vosotros y amigos invitados) no hay
> problema; si algún día la publicáis en la App Store, Apple podría pedir cambiar el nombre.

---

## 3. Secretos de Apple en Supabase (≈5 min)

Desde la carpeta donde tengas el `.p8` del paso 2.5 (Git Bash). Push:

```bash
npx supabase secrets set APNS_TEAM_ID=TU_TEAM_ID APNS_KEY_ID=TU_KEY_ID APNS_TOPIC=io.github.diegomolinacatala.ironman
```

```bash
npx supabase secrets set APNS_PRIVATE_KEY="$(cat AuthKey_TU_KEY_ID.p8)"
```

Sign in with Apple (revocar el acceso al borrar la cuenta; misma clave si la creaste con ambas casillas):

```bash
npx supabase secrets set APPLE_TEAM_ID=TU_TEAM_ID APPLE_KEY_ID=TU_KEY_ID APPLE_CLIENT_ID=io.github.diegomolinacatala.ironman
```

```bash
npx supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_TU_KEY_ID.p8)"
```

Guarda los `.p8` en un sitio seguro fuera del repo.

---

## 4. GitHub (≈10 min)

1. **Subir el código** a `github.com/diegomolinacatala/ironman` y crear `main` (te lo puedo hacer yo).
2. **Secretos y variables del repo** (en la carpeta del proyecto, con `gh` ya autenticado; o en la web:
   *Settings → Secrets and variables → Actions*). Secretos, con la clave de API del paso 2.7:

```bash
gh secret set ASC_KEY_P8 < AuthKey_TU_ASC_KEY_ID.p8
```

```bash
gh secret set ASC_KEY_ID --body TU_ASC_KEY_ID
```

```bash
gh secret set ASC_ISSUER_ID --body TU_ISSUER_ID
```

Variables:

```bash
gh variable set APPLE_TEAM_ID --body TU_TEAM_ID
```

```bash
gh variable set EXPO_PUBLIC_SUPABASE_URL --body https://XXXX.supabase.co
```

```bash
gh variable set EXPO_PUBLIC_SUPABASE_KEY --body sb_publishable_TU_CLAVE
```

3. **Minutos de Mac:** el repo `ironman` es **privado**. El plan gratis de GitHub da unos 200 minutos
   de Mac al mes (unas 6 builds). Si lo haces **público** (como Tasks) son ilimitados.

---

## 5. Primera build (≈40 min, solo esperar)

Cada push a `main` que toque la app lanza la build. También a mano:

```bash
gh workflow run ios.yml --ref main
```

Sigue el progreso en la pestaña **Actions** del repo. El workflow genera el proyecto de Xcode,
compila, firma con tu clave de App Store Connect y sube a TestFlight. Si falla, pásame el enlace de la
ejecución y lo arreglo.

---

## 6. TestFlight (≈10 min)

1. La build aparece en App Store Connect → la app → **TestFlight** tras 10–15 min de procesado.
2. **Tu compañero:** *Usuarios y acceso* → **+** → su email → rol **Developer** o **Marketing**, acceso
   solo a esta app. Él acepta el email.
3. *TestFlight* → *Internal Testing* → crea un grupo con distribución automática y añadíos los dos.
4. Instalad **TestFlight** desde la App Store y aceptad la invitación.

---

## 7. En el iPhone (cada uno, ≈10 min)

1. Abre la app → entra con **Apple** o con tu email (llega un código de 6 dígitos).
2. Onboarding: nombre, @usuario, deportes, horas por semana, franjas y carrera objetivo.
3. Permisos que quieras: notificaciones, calendario (solo horas ocupadas) y Salud.
4. **Salud:** en Garmin Connect activa *Apple Salud*; luego en la app **Yo → Conexiones → Apple Salud**.
5. **Amigos:** **Juntos → Añadir** → busca el @usuario del otro.
6. **Widgets:** mantén pulsada la pantalla de inicio → **+** → Road to Ironman.

---

## 8. Garmin y tu Claude (cada uno)

- **Garmin:** en la web de Garmin Connect, `connect.garmin.com/app/settings/personalApiToken` → crea una
  clave de **1 año** → pégala en **Yo → Conexiones → Garmin**. Se sincroniza sola por la mañana.
- **Conecta tu Claude** (usa tu suscripción de claude.ai, sin coste extra):
  1. En la app: **Yo → Conecta tu Claude → Generar URL** y cópiala (es como una contraseña).
  2. En claude.ai (web o escritorio): *Ajustes → Conectores → Añadir conector personalizado* → pega la
     URL → **sin inicio de sesión**. En el plan gratuito solo cabe 1 conector personalizado.
  3. En un chat activa **Road to Ironman** y tu conector de **Garmin**. Ejemplos:
     "Planifica mi semana en Road to Ironman con mis datos de Garmin y mis huecos" ·
     "Hoy he jugado al pádel 90' a tope, reorganiza mi semana".
  4. Los cambios llegan como **propuesta** (notificación) y los aceptas en la app.

---

## 9. Política de privacidad (≈15 min)

1. Rellena `docs/PRIVACY.md` (nombre, email de contacto, fecha) y publícala (página pública de Notion o
   GitHub Pages).
2. Pega la URL en App Store Connect → *Privacidad de la app*.
3. Para que la pantalla *Privacidad* de la app enlace a ella:

```bash
gh variable set EXPO_PUBLIC_PRIVACY_URL --body https://TU_URL
```

(Entra en la siguiente build.)

---

## Opcional

- **Coach IA dentro de la app** (Claude API, pago por uso): desactivado. Para activarlo hace falta
  `ANTHROPIC_API_KEY` en Supabase, desplegar la función `coach` y la variable `EXPO_PUBLIC_AI_COACH=1`.
- **Garmin "Starter"** (gratis, con solicitud en developer.garmin.com): permitiría enviar los entrenos
  directamente al reloj desde la app.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| La app entra en modo demo | Faltan las variables `EXPO_PUBLIC_SUPABASE_*` en GitHub (paso 4). |
| La build falla al firmar | Revisa que existan los identificadores del paso 2 con sus capacidades y que la clave de API tenga rol App Manager o Admin. |
| No llegan push | Revisa los secretos `APNS_*` (paso 3) y el SQL del paso 1.6. |
| Widgets vacíos | Abre la app una vez; comprueba el App Group en ambos identificadores. |
| Proyecto de Supabase "paused" | Plan gratis tras 7 días sin uso: *Restore*. |
