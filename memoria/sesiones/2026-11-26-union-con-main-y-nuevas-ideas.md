# Unión con main y nuevas ideas de David

**Autor:** Claude Code (sesión de David) · 26-11-2026 · rama `david/auditoria-y-mejoras`, sin subir.

## Punto de partida

`main` traía dos PR de Diego del 26-11: [[2026-11-26-flujo-de-equipo-con-pr]] (PR obligatorias, `ci.yml`, CODEOWNERS en `.github/` y `scripts/`) y [[2026-11-26-claude-cerebro-hibrido]] (Qwen 3.8 en el worker, `save_briefing` en MCP, dictado con jerga, «Abrir en Claude» e interfaz más tranquila en las cinco pestañas).

Se unió `origin/main` en la rama (commit `412bd2f`). Hubo 17 conflictos y se resolvieron así:
- **Diseño:** se conserva el de Diego. Hoy enseña la tarjeta resumida con «Ver entreno», el detalle del entreno va en pliegues «Guía del entreno» y «Objetivos y zonas», y Tú se organiza por categorías.
- **Funciones de la rama que se mantienen:**
  - la línea de lluvia en la tarjeta de Hoy;
  - el aviso sin conexión;
  - la adaptación del día;
  - los umbrales y el aviso de zonas en Progreso;
  - las cifras en los pliegues de Progreso, ahora con los iconos de Diego;
  - MyWhoosh dentro de «Guía del entreno»;
  - el aviso de ciudad en Plan.
- **Ejemplos del coach:** rellenan el mensaje, como decidió Diego, en vez de enviarse con un toque, que era la decisión 7 de David. Siguen saliendo de la sesión de hoy y de la de mañana.
- **CI:** `checks.yml` se funde en `ci.yml`, que ahora también pasa ESLint y el worker. **Al tocar `.github/`, la PR necesita la aprobación de Diego.**
- **ESLint:** los scripts de Node pueden desestructurar `process.env`, porque `scripts/asc/testflight-status.mjs` daba error.

Comprobado tras la unión: tipos OK, 2.539 tests de Jest, 189 de base de datos, 321 de funciones y 36 del worker, y ESLint sin errores.

## Encargos nuevos (26-11, tarde)

Decisiones de David:
- **Estrés y sueño:** cuando el estrés del reloj está alto y el sueño empeora, sobre todo en semanas de exámenes, la app hace estas cuatro cosas:
  - propone aflojar el plan, y el atleta lo acepta;
  - manda un recordatorio de dormir antes de la hora habitual;
  - ofrece una respiración guiada;
  - lo menciona en el informe.
- **Preguntas del domingo y del miércoles:** se activan en Ajustes y están apagadas por defecto.
  - El domingo pregunta la idea de la semana: entrenar con gente o a tu aire, y si será una semana llena o libre.
  - El miércoles pregunta si el fin de semana vuelves a tu ciudad (Castellón). Tiene en cuenta qué material hay en cada sitio: bici, rodillo, piscina.
- **Salida en bici, ¿con quién?:** siempre y para todos. En cada salida en bici al aire libre pregunta si vas con algún amigo de la app y prepara la quedada. El atleta la envía.
- **Ventana de contexto:** una entrevista guiada sobre deporte, estudios o trabajo, exámenes y hábitos, y al final una charla libre para lo que falte. Adapta el plan.
- **Importar un plan externo:** acepta PDF, foto, texto pegado, Excel o CSV, TrainingPeaks y Garmin. Se revisa antes de aplicarlo y pasa a ser la base que la app adapta.
- **Viento fuerte:** siempre avisa. Busca horas con menos viento, como con la lluvia, y solo propone cambiar el entreno cuando de verdad molesta: el umbral es más bajo en bici que corriendo. Siempre lo propone antes de cambiar nada.

## Implementado

Se hizo con cinco agentes en paralelo, cada uno en su worktree, y luego se unió en la rama. Detalle técnico en `docs/ARCHITECTURE.md`, §20 (viento) y §23-26.

- **Viento** (§20, `domain/weather.ts` `WIND_RULES`):
  - Bici: aviso desde 25 km/h y propuesta desde 35 km/h o rachas de 55. Carrera: aviso desde 30 y propuesta desde 45 o rachas de 60.
  - Lluvia y viento juntos dan una sola línea y una sola propuesta. Los huecos que se sugieren tienen que estar secos y sin viento fuerte.
  - MET Norway casi nunca da rachas en España (el endpoint `compact` no las trae), así que en la práctica cuenta el viento medio.
- **«Tu contexto»** (§23):
  - `profiles.athlete_context` (migración `20261127000400`) y entrevista guiada de unas 15 preguntas, más «¿Algo más que deba saber?» con la IA.
  - Plan: mantener un deporte con años de experiencia es una sesión menos y ×0,8; mejorar mucho, una sesión más y ×1,2.
  - La carga de estudios o trabajo baja las horas como mucho un 15 %.
  - Las épocas de exámenes se convierten en imprevistos `exam`.
  - Se respetan las horas de comida y sueño y la hora preferida.
- **Mis sitios, preguntas de la semana y «¿Sales con alguien?»** (§24):
  - `profiles.places` y `profiles.week_questions` (migración `20261127000300`).
  - Domingo: «Muchas cosas» es ×0,8, «Más libre» ×1,1 y «con gente» lleva las sesiones a huecos comunes.
  - Miércoles: «¿Vuelves?» aplica el material de ese sitio, y si la bici está allí pregunta «¿salir en bici?» y luego «¿con quién?».
  - Para todos: en cada bici al aire libre de los próximos 3 días pregunta «¿Sales con alguien?».
- **Estrés que quita sueño** (§25, `domain/stressSleep.ts`, espejado):
  - Salta cuando en 2 de las 3 últimas noches hubo un día estresante y una noche peor que la referencia de 28 días.
  - Qué hace:
    - propone «Suavizar» 2-3 días manteniendo la sesión clave;
    - avisa 45 min antes de la hora habitual de dormir;
    - abre `/breathing` (3 min, 4 s / 6 s);
    - el informe lo nombra;
    - el plan semanal baja entre un 10 y un 15 %.
  - El aviso de dormir viene activado por defecto: solo salta los días con la señal.
- **Importar un plan** (§26, migración `20261127000500`, función `plan-import`):
  - Foto: visión. PDF: `unpdf` y luego texto. Texto pegado: IA, o parser local si no hay IA. Excel/CSV: en el teléfono y sin IA (`fflate`). TrainingPeaks: su iCal, que solo existe en Premium y cubre unos 14 días hacia delante.
  - **Garmin no es posible**: la API personal no tiene calendario y la Training API solo escribe y es para empresas aprobadas.
  - El plan se revisa antes de aplicarlo. Sus sesiones quedan como `imported` y el planificador no las pisa, pero los imprevistos, el tiempo, etc. siguen proponiendo cambios sobre ellas.
  - Añade `expo-document-picker`, así que **hace falta una build nativa nueva**. El chequeo ABI pasa.

Comprobado tras unirlo todo: tipos OK, Jest 2.694, base de datos 201, funciones 336, worker 36, y ESLint sin errores.

**Desplegar (Diego), en orden:**
1. `supabase db push`, con las migraciones `20261125000100`, `20261126000100`–`000600` y `20261127000300`–`000500`. Las funciones leen las columnas nuevas, así que esto va antes.
2. Funciones `coach briefing mcp garmin morning weather plan-import` y las de planificación.
3. `select private.schedule_platform_jobs();`
4. Build nativa de la app.
5. En App Store Connect, etiquetas «Ubicación aproximada» y los datos nuevos de contexto (hábitos, estudios o trabajo, fechas de exámenes). Actualizar también `docs/PRIVACY.md`.

**Pendiente:**
- Probar todo en iPhone.
- El texto «¿Qué planes tienes?» no lo lee nadie todavía.
- «Mis sitios» solo lo usa el planificador de la app; el servidor y MCP no lo conocen.
- El replanificador no usa los horarios de «Tu contexto».
- El aviso de dormir es local: solo funciona si se abre la app ese día.
- No hay sincronización periódica del iCal de TrainingPeaks.
- Una foto por lectura: no junta varias páginas.
- `.xls` antiguo no está soportado.
- PR hacia `main`, con la aprobación de Diego porque toca `.github/`.
