# Juntos y privacidad

**Recorrido.** Una persona comparte su usuario o busca a otra. La solicitud pendiente y la amistad aceptada son estados distintos. Con una amistad aceptada, Juntos reúne invitaciones, próximas sesiones, quedadas abiertas, comparación por amigo, carreras compartidas y actividad. Hoy y el informe matinal también recuperan información social relevante.

**De la disponibilidad a la propuesta.** `src/domain/together.ts` cruza intervalos por día, descuenta ocupaciones y aplica por defecto 15 minutos de margen alrededor de los bloques para el desplazamiento. Distingue coincidencia de sesión, coincidencia de deporte y hueco libre. Una oportunidad muestra la razón y abre el formulario con datos precargados. El usuario revisa amigo, deporte, hora y duración antes de enviar.

**Durante la coordinación.** Se puede proponer, responder, editar, cancelar, abrir a amigos, unirse y comentar dentro de la quedada. Una quedada aceptada condiciona los cambios del plan. El evento de actividad conjunta depende de que los participantes aceptados completen sus entrenos vinculados. El solapamiento horario de dos actividades sueltas sigue siendo una idea en el histórico de Claude.

**Qué puede saber un amigo.** La relación admite detalle completo, resumen deportivo u ocupado/libre (`full`, `summary`, `busy`). Al enseñar coincidencias, mantener esa decisión en consultas, feed, sugerencias del coach y notificaciones. La proyección de una semana ajena merece pruebas con dos usuarios distintos. La relación y sus permisos se verifican en servidor. La app incluye bloqueo y denuncia.

**Dónde investigar.** `src/features/social/share.ts` forma el texto de invitación. `features/together` dentro de `src` contiene comparación, conflictos y formulario. Las rutas son `src/app/friends` y `src/app/joint`. En Supabase, consultar las migraciones de amistad, privacidad del feed, social_together y moderation. Las pruebas de regresión están en `supabase/tests/{friend-week,feed-privacy,joint,together,moderation}.test.ts`.

**Dos comportamientos del coach.** La sugerencia dentro de la app precarga el formulario. La herramienta MCP `propose_joint_session` envía una invitación real y su contrato exige confirmarla antes. Mantener esa diferencia en el texto de la interfaz y en las pruebas.
