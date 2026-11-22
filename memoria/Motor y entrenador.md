# Motor y entrenador

## De la carrera a la sesión

1. **Temporada.** Carreras, prioridades, nivel y disponibilidad alimentan las fases, semanas de carga, descarga y afinamiento. Plan general permite sobrescribir una semana en `week_plans`. Sin carrera objetivo existe una previsión de mantenimiento.
2. **Semana.** El planificador de reglas combina volumen, reparto por disciplina, sesiones clave, piscina, descanso y huecos de calendario. La colocación y la dureza determinan dónde encaja cada sesión. En el trabajo local del 22 de noviembre, la disponibilidad automática calcula las horas y usa la agenda. El modo manual mantiene el control explícito.
3. **Prescripción.** Los pasos tienen estructura, objetivo y pistas para ejecutarlos. La prescripción combina umbrales, zona y objetivo explícito del paso. En los deportes adecuados usa ppm, ritmo o W. El esfuerzo percibido permite orientar a quien todavía carece de umbrales.
4. **Adaptación.** El check-in y los imprevistos permiten sugerir cambios. Una propuesta hace visible qué se mueve, sustituye o ajusta y deja la decisión al atleta. `planB.ts` comprueba si procede suavizar una sesión, por ejemplo ante cansancio. Protege las sesiones ya cerradas y ciertas sesiones de carrera.
5. **Después.** Al completar el entrenamiento, el detalle contrasta lo previsto con las métricas reales y sensaciones disponibles. Progreso agrega carga, cumplimiento y volumen. El dominio incluye también pautas de alimentación e hidratación por sesión.

## Tres vías para ayudar al atleta

- **Reglas locales.** El planificador es TypeScript puro. La demo tiene un coach de reglas y permite ensayar cambios sin depender de un backend.
- **Coach de la app.** Conversación por voz o texto, briefing matinal, análisis de comida y síntesis de voz tienen contratos de servicio distintos. Pasan por consentimiento, presupuestos o límites según función. Las respuestas estructuradas se validan antes de interpretarlas. Mantener una salida comprensible ante fallo de red o de proveedor.
- **Claude personal del deportista.** MCP permite consultar contexto, registrar actividad/métricas/imprevistos, gestionar carreras, proponer cambios o quedadas y ajustar semanas. El usuario gestiona tokens desde la app. La memoria de desarrollo entre los dos socios vive en esta bóveda.

**Antes de cambiar una regla**, buscar una prueba en `src/domain/__tests__`, revisar el adaptador demo y el recorrido en Supabase. Los módulos compartidos de temporada, zonas y prescripción se copian al dominio de Edge Functions mediante `npm run sync:mirror`. El script `scripts/sync-domain-mirror.mjs` enumera los archivos exactos.
