# Estado y relevo

**Última lectura inicial · 22 de noviembre de 2026, Codex.** Base de aplicación analizada en main, `666e17c`, junto al trabajo local que existía al abrir esta sesión. La memoria distingue lo que está en ese commit de lo que solo aparecía en la copia de trabajo.

| Situación | Evidencia | Próxima comprobación |
| --- | --- | --- |
| Social y plan disponibles en código | Juntos, comparación de semanas, quedadas, feed, carreras compartidas, MCP y plan general tienen implementación y pruebas. | Recorrer la primera amistad y quedada con dos cuentas en la misma build. |
| Evolución de disponibilidad en curso | Modo auto/manual, cambios de colocación y replanificación, cálculo de volumen y nueva migración local `20261122000300_availability_auto.sql`. | Al integrar, comprobar perfiles antiguos, calendario vacío/ocupado, modo manual y consistencia entre app y Edge Functions. |
| Rediseño local en curso | Cambios en las cinco pestañas, componente Disclosure, resumen diario del plan y conversación con el coach. | Revisar el flujo del primer amigo, pantallas vacías, modo oscuro y accesibilidad en dispositivo. |
| Fiabilidad del coach en curso | Cambios locales en Worker, validación de respuestas, propuestas, reintentos y adaptadores demo/Supabase. | Probar una propuesta interrumpida y su reintento en ambas implementaciones. |
| Estado de distribución por confirmar | Los commits recientes registran cambios por App Review, reenvío y exclusión de China continental. | Consultar la build y el envío efectivos antes de comunicar una fecha de lanzamiento. |

**Verificación de partida.** TypeScript pasó. El repositorio carecía de configuración ESLint versionada. `npx expo lint` intentó instalarla y acabó con error de detección de versión. Con la configuración temporal generada, `npx eslint src` ejecutó el análisis y señaló 27 errores y 13 avisos en el árbol de trabajo. Se retiraron los cambios de configuración y manifiestos que creó la herramienta. Quedan por comprobar las suites completas, los flujos en iPhone y el estado de servicios desplegados.

## Últimas sesiones

- [[2026-11-22-memoria-inicial]] · Análisis inicial y memoria compartida.
