# Auditoría y mejoras de David

**Autor:** Claude Code (sesión de David) · 25-11-2026 · desde `9b9429d` (main) · rama `david/auditoria-y-mejoras`, sin subir.

**Objetivo.** Auditar el proyecto a fondo y hacerlo más listo y práctico: menos fricción al meter datos, respuestas mejores y menos pesadas. Comparar con `camino-703`, la app propia de David.

**Informe completo:** `docs/AUDITORIA-2026-11-25.md`.

## Cambios (11 commits)

- **Motor.** La fase se evalúa desde el lunes de la semana y el ciclo de mantenimiento es continuo en Año Nuevo. La rampa limita también el volumen a un +15 % sobre la mayor de las tres últimas semanas (+10 % principiante, +5 % con estrés). `wellnessSignals(today)` descarta los datos de hace más de un día. La disposición usa las métricas de ayer si el reloj aún no ha sincronizado.
- **Menos fricción.** Check-in con «Todo normal» y «Como ayer», y la calidad del sueño sale de la nota del reloj. En «Hecho», el chip «Tal como estaba previsto». Ejemplos del coach según hoy y mañana, que se envían con un toque. Carrera con nombre opcional, prioridad A si es la primera y detalles plegados. Panel de imprevisto sin jerga.
- **Menos peso.** El informe hablado va por excepción: tope de 180 palabras sin relleno, y la VFC y la batería solo si se salen de lo normal (también en el prompt y el validador del servidor). Los pliegues de Progreso y el del informe en Hoy muestran su cifra.
- **De camino-703.** Comparación con sesiones parecidas (`domain/similarSessions.ts`), equilibrio de carga aguda/crónica y monotonía (`loadBalance`), tomas con minuto (`fuelingSchedule`) y exportar a Zwift (`domain/zwo.ts`).
- **Seguridad y fiabilidad.** Si la petición al coach lleva texto de amigos, no se escribe memoria ni imprevisto, y las instrucciones MCP lo marcan como datos. `useTimezoneSync` guarda la zona del teléfono en el perfil. Avisos de tiempo real agrupados durante 300 ms. Nuevo workflow `checks.yml` en los PR. Migración `20261125000100_friendships_requester_idx.sql`.
- **Accesibilidad.** Segmented de 44 pt, ScorePicker como radiogroup y etiquetas del Stepper con su campo.

## Comprobaciones

`npm run test:all` en verde: tipos, 2.109 tests de Jest, 164 de base de datos y 263 de funciones. Worker: 30. Los tests nuevos del motor fallan con el código anterior. Recorrido en la demo web en tamaño móvil:
- check-in en 3 toques;
- detalle de bici con plan de tomas y `.zwo` válido (comparado con `deporte/zwift/SS_3x10_75.zwo`);
- Progreso con cifras;
- ejemplo del coach que produce una propuesta.

Nada probado en iPhone.

## Pendiente

1. Revisar la rama con el dueño, abrir un PR hacia main y fusionar (cada push a main sube a TestFlight).
2. Desplegar la migración nueva y las funciones `coach`, `briefing` y `mcp`.
3. Rotar o desactivar la contraseña de la cuenta de revisión tras la aprobación.
4. En iPhone: compartir `.zwo` (hoja de compartir), zona horaria y check-in con datos reales.
5. El resto de la lista priorizada está en el informe, §5.
