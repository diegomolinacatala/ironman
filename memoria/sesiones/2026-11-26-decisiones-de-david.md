# Decisiones de David sobre la auditoría

**Autor:** Claude Code (sesión de David) · 26-11-2026 · rama `david/auditoria-y-mejoras`, sin subir.

David revisó una a una las 39 propuestas de [[2026-11-25-auditoria-y-mejoras]], con sus pros y contras. Esta nota guarda lo que decidió. Lo que se implementó está al final.

## Cambios ya hechos en la rama

| # | Cambio | Decisión |
| --- | --- | --- |
| 1 | Fase calculada desde el lunes | Mantener |
| 2 | Ciclo de descargas continuo en Año Nuevo | Mantener |
| 3 | Tope de volumen semanal | Suavizar: +20 % (+15 % principiante, +10 % con estrés) |
| 4 | Informe y semáforo solo con datos de hoy y ayer | Mantener |
| 5 | Check-in en 3 toques («Todo normal», «Como ayer») | Deshacer |
| 6 | «Tal como estaba previsto» al marcar una sesión hecha | Mantener |
| 7 | Ejemplos del coach según hoy y mañana, con un toque | Mantener |
| 8 | Carrera con nombre opcional y detalles plegados | Mantener. Además, cada carrera B se prepara como elija el usuario: «Como entreno», «Solo afinar» o «Preparación específica» |
| 9 | Informe hablado por excepción | Más corto, pero nombrando todos los datos: los normales, juntos («Sueño, VFC y pulso, bien»); los que se salen, con su cifra |
| 10-13 | Cifras en los pliegues, sesiones parecidas, aviso de carga, tomas con minuto | Mantener |
| 14 | El coach no guarda memoria si la petición lleva texto de amigos | Deshacer |
| 15-17 | Zona horaria del teléfono, pruebas en cada PR, textos del imprevisto, accesibilidad, recargas agrupadas, índice de amistades | Mantener |
| 18 | Entrenamiento de MyWhoosh más parecido en cada bici | Solo si el usuario lo activa |
| 19 | Informe de auditoría en el repositorio público | Subirlo entero |
| — | Exportar a Zwift (.zwo) | Descartado: ya no se usa Zwift |

## Propuestas sin hacer

| # | Propuesta | Decisión |
| --- | --- | --- |
| 20 | Cuenta de revisión de Apple | La decide Diego: [issue #1](https://github.com/diegomolinacatala/ironman/issues/1) |
| 21 | Claude de pago si falta el worker | Exigir `AI_ALLOW_PAID=1` |
| 22 | Push que se pierden | Dejarlo: sí se reintentan (el informe exageraba) |
| 23 | `sync_all` de Garmin sin orden | Ordenar por la sincronización más antigua |
| 24 | El reloj descarta la actividad si marcaste la sesión a mano | Que el reloj complete los datos reales |
| 25 | Check-in y «Hecho» sin red | Cola que lo envía al volver la red |
| 26 | ESLint | Configurar y arreglar lo grave |
| 27 | Imprevisto que empieza en pádel | Recordar el último tipo |
| 28 | Plan con poco margen según la fecha de alta | Según el volumen real |
| 29 | Dos semáforos distintos | Más adelante |
| 30 | Revisiones que no recalibran | Sugerir revisar zonas, nunca automático |
| 31 | Tope específico de carrera a pie (+15 %) | Sí |
| 32 | Check-in automático con datos del reloj | Más adelante |
| 33 | Métricas del FIT | Sí, como proyecto aparte |
| 34 | Umbrales que se actualizan solos | Sí, siempre con confirmación |
| 35 | Señales de enfermedad | Sí, confirmándolo con preguntas en el check-in de la mañana: cómo se siente el deportista importa |
| 36 | Aviso del informe al despertar | Sí, opcional |
| 37-39 | Plan de carrera, predicción de tiempo, repetir quedada | Sí |

## Encargos nuevos del 26-11

- Mejorar la inteligencia de la app, que es lo que peor funciona.
- Tiempo: consulta semanal y cada mañana. Si llueve, carrera y bici fuera solo en huecos secos. Si no hay huecos, proponer (con confirmación) rodillo y piscina.
- Distribuciones de entrenamiento personalizadas por deportista.
- Semanas de estudio y exámenes, y el estrés que provocan, muy en cuenta en el plan.
- Aviso del informe X minutos después de despertar, opcional, detectando dentro de las horas habituales de levantarse.

## Implementado

_Se completa al terminar._

## Estado al parar (26-11, sin batería)

En `david/auditoria-y-mejoras` (sin subir), con todas las pruebas en verde (2.416 app, 184 BD, 303 funciones): decisiones aplicadas, coach que entiende situaciones y resuelve primero con reglas, fallo de fatiga del plan corregido, pádel sin borrar natación, aviso de adaptar en Hoy, plan de carrera + previsión, aviso al despertar, motor (rampa +20 %, tope carrera a pie, plan corto por volumen real, carreras B a elegir), MyWhoosh opcional, sin conexión, repetir quedada, revisar zonas y el tiempo.

A medias, en worktrees sin unir:
- `.claude/worktrees/agent-af93854afc1bb28d5`: reloj completa sesiones (commit c431bc7) + señales de enfermedad y umbrales automáticos (sin terminar / sin commit).
- `.claude/worktrees/agent-aa085eee61583716a`: plan semanal (volumen habitual, tirada larga, exámenes, principiantes) y «Tu forma de entrenar»; partió de antes del merge del tiempo.

Pendiente después: unir esas dos ramas, ESLint, actualizar `docs/AUDITORIA-2026-11-25.md` y la memoria, lista de cambios, proyecto FIT aparte, PR.
