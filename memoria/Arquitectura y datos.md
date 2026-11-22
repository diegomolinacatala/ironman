# Arquitectura y datos

**Camino de una operación.** Una ruta en `src/app` monta la interfaz de `src/features`, que usa los hooks de `src/data/queries.ts`. El contrato asíncrono está en `src/data/repository.ts`. `createRepository.ts` selecciona una implementación por ejecución. Con URL y clave pública de Supabase se usa el backend, salvo que se fuerce demo. La demo usa el mismo contrato y sus propios datos de ejemplo. Un cambio visible con la cuenta demo debe verificarse también en la implementación remota si afecta a persistencia o permisos.

**Ejemplo para retomar un cambio.** Si una quedada aparece en un teléfono pero no en el otro, seguir el recorrido desde la respuesta de invitación hasta participantes y permisos en SQL, revisar la consulta de sesiones y sus actualizaciones en cliente y comprobar la ventana de fechas de Juntos. Una prueba que solo renderiza la tarjeta deja fuera esos límites.

| Área | Entidades centrales | Qué cuidar al modificarla |
| --- | --- | --- |
| Identidad | `profiles`, Auth, consentimiento, disponibilidad y umbrales | Alta incompleta, cuentas previas, cierre de sesión y eliminación de cuenta. |
| Plan | `races`, `week_plans`, `workouts`, `life_events`, `busy_blocks`, `plan_proposals` | Distinguir objetivos semanales de entrenos concretos. Revisar fechas locales, sesiones fijas y aplicación de cambios. |
| Diario | `daily_checkins`, `daily_metrics`, `nutrition_logs`, `briefings` | Distinguir datos ausentes, manuales e importados. Mantener privados los datos de salud. |
| Social | `friendships`, `joint_sessions`, `joint_session_participants`, `joint_session_comments`, `activity_events`, `kudos`, `user_reports` | Revisar actor, relación, visibilidad, bloqueo y acceso tras cancelar. |
| Servicios | `personal_tokens`, `integration_credentials`, `push_tokens`, `notifications`, `coach_jobs`, `ai_usage` | Separar clave pública y credenciales del servidor, validar alcance de tokens, consumo y reintentos. |

**Servidor.** Supabase reúne Auth, Postgres, políticas por fila (RLS), procedimientos remotos (RPC), Realtime y Edge Functions. Las migraciones SQL ordenadas por fecha son la fuente del esquema. Algunas dependen de extensiones de plataforma para push, cron o tiempo real. Las pruebas PGlite ejercitan RLS y operaciones SQL. Para una migración, contrastar tanto el camino de instalación limpia como los valores antiguos que la aplicación sigue leyendo.

**Stack del cliente observado.** Expo SDK 58, React Native 0.88, React 19.3, Expo Router, TanStack Query y Zod. Código en inglés, producto en castellano. `src/ui` concentra tema, primitivas, tipografía y feedback. `src/lib` concentra configuración, almacenamiento y registro. Los permisos y plugins de compilación se declaran en `app.config.ts`.

**Cuando un documento discrepa.** Verificar primero el archivo ejecutado, el contrato y una prueba representativa. Por ejemplo, la descripción histórica del proveedor de IA en algunos comentarios es anterior al selector real en `supabase/functions/_shared/platform/ai-provider.ts`.
