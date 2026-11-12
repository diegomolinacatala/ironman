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
