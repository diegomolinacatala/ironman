# Estado y relevo

**Última lectura inicial · 22 de noviembre de 2026, Codex.** Base de aplicación analizada en main, `666e17c`, junto al trabajo local que existía al abrir esta sesión. La memoria distingue lo que está en ese commit de lo que solo aparecía en la copia de trabajo.

| Situación | Evidencia | Próxima comprobación |
| --- | --- | --- |
| Social y plan disponibles en código | Juntos, comparación de semanas, quedadas, feed, carreras compartidas, MCP y plan general tienen implementación y pruebas. | Recorrer la primera amistad y quedada con dos cuentas en la misma build. |
| Disponibilidad automática integrada | `availability.mode` (ausente = auto), horas por nivel × distancia × fase, migración `20261122000300_availability_auto.sql`. Ver [[2026-11-22-rediseno-coach-disponibilidad]]. | En iPhone: perfil antiguo, calendario vacío/ocupado y modo manual. |
| Rediseño "tranquilo por defecto" integrado | `Disclosure` en `src/ui`, pliegues en las cinco pestañas, compositor de chat tipo mensajería; regla en `docs/DESIGN.md` §4b. | Recorrido en dispositivo, accesibilidad con VoiceOver. |
| Coach y replanificación fiables integrados | Ids cortos, intención de cambio, reparación, timeouts, reglas que editan; replan con huecos reales; migración `20261122000400_plan_reliability.sql`. | Propuesta de Claude en la semana siguiente y reintento parcial con datos reales. |
| Estado de distribución por confirmar | Los commits recientes registran cambios por App Review, reenvío y exclusión de China continental. | Consultar la build y el envío efectivos antes de comunicar una fecha de lanzamiento. |

**Verificación de partida.** TypeScript pasó. El repositorio carecía de configuración ESLint versionada. `npx expo lint` intentó instalarla y acabó con error de detección de versión. Con la configuración temporal generada, `npx eslint src` ejecutó el análisis y señaló 27 errores y 13 avisos en el árbol de trabajo. Se retiraron los cambios de configuración y manifiestos que creó la herramienta. Quedan por comprobar las suites completas, los flujos en iPhone y el estado de servicios desplegados.

## Últimas sesiones

- [[2026-11-26-claude-cerebro-hibrido]] · La IA del coach fallaba desde el 20-11 porque Cloudflare retiró Nemotron 3. Ahora usa Qwen 3.8, con reserva automática. Modelo híbrido: Claude del plan Pro vía MCP (`save_briefing`), dictado con jerga y cifras. Worker y funciones de Supabase desplegados (Claude Code).
- [[2026-11-25-alta-de-david]] · David, Nico y Darius entran como desarrolladores. David ya tiene acceso al repo y a TestFlight. Nico y Darius están pendientes de alta (Claude Code).
- [[2026-11-22-rechazo-app-review-build-19]] · Arreglos del rechazo 5.1.1(iv), 2.5.4 y 2.1. Falta el vídeo con el reloj (Claude Code).
- [[2026-11-22-rediseno-coach-disponibilidad]] · Rediseño con pliegues, coach y replanificación fiables, disponibilidad automática (Claude Code).
- [[2026-11-22-memoria-inicial]] · Análisis inicial y memoria compartida.
