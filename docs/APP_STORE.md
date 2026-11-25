# Publicar Road to Ironman en la App Store

Casi todo está automatizado:

| Qué | Cómo |
|---|---|
| Build firmada en App Store Connect | Cada push a `main` (`.github/workflows/ios.yml`) |
| Web: soporte, privacidad y normas | Cada cambio en `site/`, `docs/PRIVACY.md` o `docs/TERMS.md` (`pages.yml`) |
| Ficha completa: nombre, subtítulo, descripción, palabras clave, URLs, categorías, edad, precio gratis, disponibilidad, copyright, datos para el revisor, build y capturas | Workflow **App Store** (`app-store.yml` → `scripts/asc/app-store-connect.mjs`), con los textos de `store/listing.json` y las capturas de `store/screenshots/` |
| Envío a revisión | El mismo workflow con `submit=true` |
| Capturas (1290 × 2796) | `scripts/store-screenshots.mjs` sobre la demo web |

**URLs públicas:** soporte https://diegomolinacatala.github.io/ironman/ · privacidad
https://diegomolinacatala.github.io/ironman/privacy/ · normas https://diegomolinacatala.github.io/ironman/terms/

---

## Lo que tiene que hacer una persona

1. **Base de datos de producción** (bloquear y denunciar):

   ```bash
   npx supabase db push --remote
   ```

2. **Cuenta del revisor.** Crea `revision@roadtoironman.app` en Supabase con un código de 6 dígitos y lo
   guarda en el secreto `ASC_REVIEW_CODE` de GitHub. No pide ninguna clave: usa tu sesión de Supabase y la
   de `gh`.

   ```bash
   node scripts/review-account.mjs
   ```

3. **Teléfono de contacto** para el equipo de revisión de Apple (obligatorio):

   ```bash
   gh secret set ASC_CONTACT_PHONE --body "+34 6XX XXX XXX"
   ```

4. **Privacidad de la app** (App Store Connect → la app → *Privacidad de la app*; Apple no tiene API para
   esto). *¿Recopilas datos?* **Sí**. En cada tipo: vinculado a tu identidad **sí**, rastreo **no**, fin
   **Funcionalidad de la app**.

   | Tipo | Datos |
   |---|---|
   | Salud y forma física | Salud · Forma física |
   | Información de contacto | Dirección de correo electrónico · Nombre |
   | Contenido del usuario | Otro contenido del usuario |
   | Identificadores | ID de usuario |
   | Datos de uso | Interacción con el producto |

   Después pulsa **Publicar**.

5. **Comerciante en la UE (DSA)**: *App Store Connect → Negocio → Cumplimiento*. Si te declaras **no
   comerciante** (app gratuita y personal), no se publica ningún dato tuyo. Sin esta declaración, la app no
   sale en los países de la UE.

6. **Rellenar y enviar:** *GitHub → Actions → App Store → Run workflow*. Primero sin marcar *submit*
   y revisa el resultado; después con *submit*. También desde la terminal:

   ```bash
   gh workflow run app-store.yml -f submit=false
   ```

   ```bash
   gh workflow run app-store.yml -f submit=true
   ```

Apple tarda de 1 a 3 días. Si la rechaza, copia el mensaje del *Centro de resoluciones* y se arregla.

### Rechazo del 22-11-2026 (build 19): qué se cambió y qué falta

| Guideline | Qué pedía Apple | Arreglo |
| --- | --- | --- |
| 5.1.1(iv) | Antes del permiso del calendario había un botón «Permitir» y un «Ahora no». | Paso *Calendario*: un único «Continuar» que siempre abre el aviso de iOS. Lo mismo en *Informe* (avisos) y en la guía de COROS (Apple Salud). En Tú, «Activar avisos» / «Conectar calendario». |
| 2.5.4 | `audio` en `UIBackgroundModes` sin audio persistente. | Quitado de `app.config.ts` (el informe hablado solo suena con la app abierta). |
| 2.1 | Vídeo con un iPhone real y el «hardware» (el reloj). | Notas aclaran que no hay emparejamiento. **Falta grabar el vídeo** (abajo). |

**Vídeo (2-3 min, grabado con otro móvil para que se vean a la vez el iPhone y el reloj):**

1. iPhone y reloj Garmin en plano. Abre Road to Ironman (build nueva) e inicia sesión.
2. Onboarding › *Tu reloj* › Garmin: «Abrir Garmin Connect», copiar la clave personal, pegarla, «Garmin conectado».
3. Di o rotula: *no hay emparejamiento Bluetooth; los datos llegan desde Garmin Connect*.
4. Termina una actividad corta en el reloj (o enseña una reciente), sincroniza con Garmin Connect y muestra en
   la app que la sesión aparece hecha (Hoy / Progreso) con su FC.
5. (Opcional) COROS: «Conectar Apple Salud» y el aviso de iOS.

Súbelo a YouTube como **oculto** (no privado), pon el enlace en `review.demoVideoUrl` de
`store/listing.json` (o en el secreto `ASC_DEMO_VIDEO_URL`), lanza una build nueva, ejecuta el
workflow con *submit* y responde en el Centro de resoluciones:

> Hello, thank you for the review. We have addressed all three issues in build 20:
> 5.1.1(iv): the screen before the calendar (and every other) permission request now has a single "Continuar" (Continue) button that always shows the system prompt; there is no "Permitir" or "Ahora no" before it.
> 2.5.4: the "audio" value has been removed from UIBackgroundModes.
> 2.1: Road to Ironman does not pair with any hardware (no Bluetooth or accessories). A watch is optional: Garmin data arrives from Garmin's cloud with the user's Garmin Connect personal key, and COROS data through Apple Health. The demo video is linked in the App Review Information notes: <ENLACE>. Without a watch, tap «Seguir sin reloj» on the watch step.
> Thank you!

---

## Notas

- **El nombre:** "Ironman" es una marca registrada (World Triathlon Corporation). Apple puede pedir un
  cambio (guideline 5.2.1). Si pasa, cambia `APP_NAME` en `app.config.ts` y `appInfo.name` en
  `store/listing.json`.
- **Cuenta del revisor:** el código es su contraseña y solo tiene 6 dígitos. Cámbialo después de cada
  aprobación ejecutando otra vez `node scripts/review-account.mjs`, y relanza el workflow antes de la
  siguiente revisión.
- **Denuncias:** Supabase → *Table editor* → `user_reports` (pendientes: `reviewed_at` vacío). Respóndelas
  en menos de 24 h: borra el contenido o la cuenta y rellena `reviewed_at`. Por ahora no hay botón para
  desbloquear: se hace borrando la fila `blocked` en `friendships`.
- **Capturas nuevas:** `npx expo start --web --port 8081`, luego
  `PLAYWRIGHT=…/node_modules/playwright/index.mjs node scripts/store-screenshots.mjs`, y relanza el
  workflow.
- **Nuevas versiones:** sube `version` en `app.config.ts` y en `store/listing.json` (1.0.1, 1.1.0…), haz
  push, espera la build y relanza el workflow con *submit*.
