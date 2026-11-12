# Publicar Road to Ironman: TestFlight para amigos y App Store

Lo técnico ya está hecho: cada push a `main` compila y sube la build a TestFlight
(`.github/workflows/ios.yml`) y la web pública (soporte, privacidad y normas) se publica sola con
`.github/workflows/pages.yml`. Esta guía es lo que se hace a mano en App Store Connect.

**URLs públicas**

| Para | URL |
|---|---|
| Soporte / marketing | https://diegomolinacatala.github.io/ironman/ |
| Política de privacidad | https://diegomolinacatala.github.io/ironman/privacy/ |
| Normas de uso (EULA) | https://diegomolinacatala.github.io/ironman/terms/ |

---

## 0. Antes de nada (una vez)

1. **Base de datos:** sube la migración de moderación (bloquear y denunciar):

   ```bash
   npx supabase db push
   ```

2. **Cuenta del revisor:** crea la cuenta que usará Apple. Pega la *secret key* de Supabase
   (*Project Settings → API Keys*, `sb_secret_…`); el script imprime el código de 6 dígitos:

   ```bash
   SUPABASE_URL=https://gganxjgvdbcwuahfrlvy.supabase.co SUPABASE_SECRET_KEY=sb_secret_… node scripts/review-account.mjs
   ```

   El revisor entra con **revision@roadtoironman.app** y ese código en la pantalla del código (no se
   envía ningún email a esa dirección). Vuelve a lanzar el script para cambiar el código.

3. **Correo de los códigos:** el correo que trae Supabase envía muy pocos emails por hora. Antes de
   invitar a muchos amigos configura un SMTP gratuito (*Supabase → Authentication → Emails → SMTP*, por
   ejemplo Resend) o pídeles que entren con **Apple**.

---

## 1. TestFlight externo: tus amigos, ya (1–2 días)

1. App Store Connect → **Road to Ironman → TestFlight → Información de prueba**:
   - *Descripción de la beta:* "Planifica tu triatlón con un coach y entrena con tus amigos. Prueba
     Hoy, el plan de la semana y Juntos (añade a un amigo por su @usuario)."
   - *Email de contacto:* diegomolinacatala@gmail.com
   - *Información de inicio de sesión:* `revision@roadtoironman.app` + el código del paso 0.2.
   - *Notas para el revisor:* las mismas que en el §3.
2. **Testing externo → "+" → grupo "Amigos"** → añade la última build.
3. **Enviar a revisión de la beta.** Primera vez: normalmente menos de 24–48 h. Las siguientes builds del
   grupo casi nunca se revisan.
4. Cuando esté aprobada: **Habilitar enlace público** (puedes limitarlo a, por ejemplo, 50 personas) y
   pásalo por WhatsApp. Cada uno instala **TestFlight**, abre el enlace y entra con Apple.
5. En la app: *Juntos → Añadir* → @usuario.

> Las builds de TestFlight caducan a los 90 días; el workflow saca una nueva cada dos meses.

---

## 2. Ficha de la App Store (versión 1.0.0)

**Información de la app**

| Campo | Valor |
|---|---|
| Nombre | Road to Ironman |
| Subtítulo (30) | Triatlón con tu coach y amigos |
| Categoría principal | Salud y forma física |
| Categoría secundaria | Deportes |
| URL de privacidad | https://diegomolinacatala.github.io/ironman/privacy/ |
| Derechos de contenido | No contiene contenido de terceros |
| Precio | Gratis · todos los países (o solo España) |

**Versión 1.0.0**

*Texto promocional (170):*

> Tu plan de triatlón con objetivos de verdad, un informe cada mañana y Juntos: mira los huecos que
> compartes con tus amigos y quedad para entrenar.

*Descripción:*

> Road to Ironman es tu entrenador de triatlón de bolsillo, pensado para entrenar con tus amigos.
>
> PLAN CON OBJETIVOS DE VERDAD
> Cada sesión de natación, bici, carrera y fuerza llega con su estructura (calentamiento, series,
> vuelta a la calma) y sus cifras: pulsaciones, ritmo, vatios y sensaciones calculados con tus umbrales.
> Sabes para qué sirve cada entreno, qué claves cuidar y qué hacer si no es tu día.
>
> HOY
> Un informe cada mañana con cómo has dormido y lo que te toca. Si tienes un imprevisto (trabajo, pádel,
> una molestia), cuéntaselo al coach y reorganiza tu semana.
>
> JUNTOS
> Añade a tus amigos por su @usuario, mira vuestras semanas lado a lado, encuentra los huecos comunes y
> propón una quedada. Tú decides qué ven: todo, un resumen u "ocupado".
>
> TU RELOJ
> Con Apple Salud se marcan solos los entrenos hechos de tu Garmin o COROS, con tu sueño, VFC y pulso en
> reposo.
>
> PLAN GENERAL
> Las semanas que quedan hasta tu carrera: carga, descarga, afinamiento y carrera.
>
> Gratis, sin anuncios. Tus datos de salud no se venden ni se usan para publicidad.
>
> Road to Ironman te ayuda a organizar tu entrenamiento; no es consejo médico.

*Palabras clave (100):*
`triatlon,entrenamiento,plan,triatleta,correr,ciclismo,natacion,maraton,amigos,coach,running,fc,zonas`

(Sin marcas de otros, como Garmin o COROS: Apple rechaza las palabras clave con marcas ajenas.)

*URL de soporte:* https://diegomolinacatala.github.io/ironman/ · *Copyright:* 2026 Diego Molina

**Capturas (obligatorio):** iPhone de 6,9" (1320 × 2868), de 3 a 10. Desde tu iPhone con datos reales:
Hoy (informe de la mañana) · Plan de la semana · detalle de un entreno con sus cifras · Juntos (semana
lado a lado) · Plan general · Progreso. Sin iPad (`supportsTablet: false`).

**Clasificación por edad:** cuestionario → todo "Ninguno", salvo *Contenido generado por usuarios /
comunicación entre usuarios: Sí* (mensajes de quedadas). Sale 12+ o similar.

---

## 3. Información para la revisión

- **Inicio de sesión:** `revision@roadtoironman.app` · código: el del paso 0.2.
- **Notas:**

> Para entrar escribe revision@roadtoironman.app, pulsa "Recibir código" y escribe el código de 6
> dígitos indicado (en esta cuenta el código es fijo; a los usuarios normales les llega por email).
> También funciona "Iniciar sesión con Apple".
>
> La app planifica entrenamientos de triatlón. Apple Salud (HealthKit) se usa solo para leer entrenos,
> sueño, VFC, pulso en reposo, VO2máx y pasos y marcar sesiones como hechas; nunca escribe en Salud.
> Garmin, COROS y el conector de Claude son opcionales: la app funciona sin ellos.
>
> Contenido entre usuarios (solo entre amigos que se aceptan mutuamente): se puede denunciar y bloquear
> desde la pantalla de un amigo (botón de opciones → Denunciar / Bloquear), desde una solicitud de
> amistad (⋯) y manteniendo pulsado un mensaje de una quedada. Revisamos las denuncias en menos de 24 h.
> Normas de uso: https://diegomolinacatala.github.io/ironman/terms/
>
> Borrar cuenta: Tú → Borrar cuenta.

---

## 4. Privacidad de la app (etiquetas)

*¿Recopilas datos?* **Sí.** Para cada tipo: *vinculado a la identidad: sí* · *rastreo: no* · fin:
**Funcionalidad de la app**.

| Tipo | Datos |
|---|---|
| Salud y forma física | Salud, Forma física |
| Información de contacto | Dirección de correo electrónico, Nombre |
| Contenido del usuario | Otro contenido del usuario (mensajes, notas al coach, comidas apuntadas) |
| Identificadores | ID de usuario |
| Datos de uso | Interacción con el producto (kudos, quedadas) |
| Datos sensibles | No |
| Ubicación, contactos, historial de búsqueda, compras, diagnósticos | No |

Las fotos de comida y la voz no salen del iPhone salvo para analizarlas al momento (Cloudflare Workers AI,
sin guardarse); no hace falta declararlas como recopiladas, pero sí están explicadas en la política.

---

## 5. Enviar

*App Store → 1.0.0 → Build → elige la última → Añadir para revisión → Enviar.* Suele tardar de 1 a 3
días. Si la rechazan, copia el mensaje del *Centro de resoluciones* y se arregla.

**Riesgo conocido: el nombre.** "Ironman" es una marca registrada (World Triathlon Corporation). Apple
puede pedir un cambio de nombre (guideline 5.2.1) o la marca podría reclamarlo más adelante. Si pasa,
basta con cambiar `APP_NAME` en `app.config.ts` y el nombre en App Store Connect (por ejemplo
"Road to Triathlon").

---

## 6. Después de publicar

- **Denuncias:** Supabase → *Table editor* → `user_reports` (las pendientes tienen `reviewed_at` vacío).
  Respóndelas en menos de 24 h: borra el contenido o la cuenta y rellena `reviewed_at`.
- **Nuevas versiones:** sube `version` en `app.config.ts` (1.0.1, 1.1.0…), haz push y envíala desde
  App Store Connect. El número de build lo pone el workflow.
