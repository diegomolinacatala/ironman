# Diario de la mañana (estilo Whoop) y análisis post-entreno

**Autor:** Diego con Claude Code · 27-11-2026 · rama `feat/journal-y-analisis` desde `main` (`6bc71d0`).

**Objetivo.** Dos peticiones de Diego: (1) al terminar una actividad, poder analizarla; (2) al empezar el día, 5 preguntas de sí o no como el Journal de Whoop.

**Cómo lo hace Whoop (investigado).** Cada mañana, tras procesar el sueño, pregunta una lista personal de hábitos de sí/no (el usuario los elige de un catálogo de más de 100 y Whoop recomienda llevar pocos). Con al menos 5 «sí» y 5 «no» de un hábito en 90 días, compara la recuperación de unos días y otros y dice si se asocia a más o menos recuperación (aviso: correlación, no causa). Lo resume en Insights › Impacts y en el informe mensual.

**Decisiones de Diego (preguntadas antes de implementar).**
- Sí/no primero; las escalas 1-5 actuales quedan plegadas y opcionales.
- Preguntas elegibles de un catálogo (20 hábitos), 5 por defecto.
- «Qué te afecta» ya, con la recuperación del reloj.
- Análisis post-entreno con la IA del coach (gratis).

**Cambios.**
- Dominio: `HABIT_IDS` y `DailyCheckin.habits` en `types.ts`; escalas `Score5 | null`. `habitCatalog.ts` (preguntas, etiquetas, 5 por defecto, textos para el coach; replicado al servidor con `sync:mirror`). `habitImpacts.ts`. `readiness.ts`: «enfermo» = ámbar por sí solo, «molestia» = nota, escalas vacías no cuentan. `workoutAnalysis.ts` (análisis por reglas).
- Migración `20261127001000_journal_and_analysis.sql`: escalas opcionales y `habits jsonb` en `daily_checkins`, `profiles.journal_habits`, tabla `workout_analyses` (lee el dueño, escribe solo el servidor).
- Función `analysis` (`_shared/analysis/`): devuelve el análisis guardado o hace una llamada estructurada a la IA con plan frente a hecho, notas, check-in de esa mañana, carga de 7 días y lo de mañana. Consentimiento y 30 análisis/24 h.
- Servidor: el contexto de planificación (coach, MCP de Claude) recibe las respuestas en palabras («Bebió alcohol ayer: sí») y `wellnessSignals` cuenta «enfermo» y «molestia».
- App: check-in con `JournalQuestions` y «Sueño y sensaciones» plegado; Tú › Entrenamiento › «Preguntas de la mañana» (`/settings/journal`); Progreso › «Qué te afecta»; `CompleteSheet` termina en «¡Sesión hecha!» con «Analizar sesión»; el detalle del entreno tiene la tarjeta de análisis (`?analyze=1` la lanza sola). Demo: el atleta bebe los viernes y sábados y su VFC baja al día siguiente, así la tarjeta enseña algo.

**Comprobaciones.** `npm run test:all` en verde (2124 pruebas de app, 167 de base de datos, 287 de funciones). Pruebas nuevas: dominio (catálogo, impactos, disposición, análisis por reglas), formulario y pantallas del check-in, selector de hábitos, hoja de completar, detalle con análisis, función `analysis` (5) y base de datos (3). Tipos de `_shared/analysis` comprobados aparte con `tsc`. **No probado en iPhone, en la vista web ni contra la IA real.**

**Pendiente.**
1. Diego: `supabase db push` de `20261127001000_journal_and_analysis.sql` y `supabase functions deploy analysis coach briefing mcp --use-api` **antes** de la build (sin la migración, guardar un check-in solo con sí/no falla porque las escalas siguen siendo obligatorias en la tabla).
2. Probar en TestFlight: check-in de la mañana, elegir preguntas, «Analizar sesión» tras marcar un entreno y con una actividad de Garmin/COROS.
3. Ideas: notificación al llegar una actividad del reloj («¿la analizamos?»), pedir RPE y sensaciones si faltan, impactos sobre la VFC además de la disposición, que el briefing mencione el hábito con más efecto.
