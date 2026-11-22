# Decisiones que conviene recordar

| Tema | Decisión y razón | Dónde contrastarla |
| --- | --- | --- |
| Producto social | Coordinar entrenos futuros entre amigos y respetar lo acordado cuando cambia el plan. El feed también recoge lo que ya hicieron. | `docs/PRODUCT.md`, `src/domain/together.ts`, migración social del 4 de noviembre. |
| Autoridad del atleta | Revisar los cambios sugeridos y controlar el detalle compartido con cada amigo. | Propuestas, comparación semanal, políticas SQL y contratos MCP. |
| Disponibilidad | Trabajo local del 22 de noviembre orientado a usar el calendario por defecto. Las filas previas sin modo se interpretan como automáticas, lo que merece prueba con perfiles antiguos. | `src/domain/availability.ts`, parsers de app y servidor, migración `20261122000300_availability_auto.sql` en la copia analizada. |
| Acceso al producto | La demo local y las reglas permiten recorrer el producto con pocas dependencias. El diseño de iPhone y la demo web comparten componentes. | `src/data/createRepository.ts`, `src/ui`, layouts de pestañas. |
| Evolución del coach | La decisión histórica de octubre de desactivar IA quedó superada en v2 por el coach integrado, con reglas de respaldo. v4 añade prescripción, revisión posterior, plan general y COROS. | `docs/V2.md`, `docs/V4.md`, selector real de proveedor. |
| Distribución | Generación nativa y firma en un Mac de GitHub Actions. El equipo puede desarrollar en Windows y validar en iPhone. | Workflow iOS y `scripts/ios`. |
| Memoria de equipo · 22 de noviembre | Los socios y ambos asistentes comparten notas Markdown versionadas con el proyecto. Cada tarea termina actualizando la bóveda. | [[Cómo trabajamos]], instrucciones raíz para Codex y Claude. |

Al cambiar una decisión, registrar fecha, motivo y decisión sustituida. Las ideas en [[Ideas de experiencia]] quedan abiertas hasta que el equipo las pruebe y acuerde el cambio.
