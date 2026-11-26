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

Lo implementado se apunta al final de esta nota.
