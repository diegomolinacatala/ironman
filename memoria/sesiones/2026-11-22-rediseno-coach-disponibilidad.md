# 22 de noviembre de 2026 · Rediseño, coach fiable y disponibilidad automática

**Autor:** Claude Code. **Base:** main, `6f861ce`. **Encargo del propietario, tras usar la app varios días:** la app abruma (demasiada información a la vista), poco intuitiva; quiere algo más simple y funcional con desplegables tipo Apple/Spotify. La reorganización por imprevisto y los cambios pedidos a Claude o al chat de la app funcionan mal. La disponibilidad le frena: no sabe cuántas horas hace y quiere entrenar lo máximo posible usando su calendario. Subir una nueva build a TestFlight.

## Qué cambió

- **Rediseño "tranquilo por defecto".** Nuevo `Disclosure` en `src/ui` (pliegue con resumen de una línea, recuerda abierto/cerrado por dispositivo, `rti.disclosure.v1`). Hoy: cabecera con cuenta atrás, pastillas de acciones, avisos, sesión de hoy con detalles plegados, y pliegues Informe, Mañana, Comidas y Juntos hoy. Plan: resumen de semana plegado, una sola fila de herramientas (Planificar semana + Añadir), días plegados a una línea salvo hoy. Juntos y Progreso pliegan lo secundario. Tú sin selectores en línea. Chat con compositor tipo mensajería (micro, texto, enviar). Regla en `docs/DESIGN.md` §4b.
- **Coach de la app.** Ids cortos (`w1…`) para el modelo con correspondencia en servidor, detección de intención de cambio (cambios obligatorios y más esfuerzo), historial con el resumen de propuestas y su resultado, respuesta honesta si se descartan todos los cambios, un reintento de reparación, salida más corta, timeout propio de Workers AI, motivo real del fallo en la app, motor de reglas que entiende mover, quitar, suavizar, "hoy no puedo" y pádel. La conversación del día se guarda en el móvil.
- **Replanificación.** Las sesiones sin hora chocan con un imprevisto si no queda hueco y se recolocan con hora real; intercambio en vez de borrado; todos los tipos de imprevisto; ventana de datos correcta; revisión de propuestas de 14 días; reintento de cambios parcialmente aplicados; el servidor rechaza fechas pasadas y choques con el calendario; `apply_now` ya no notifica; propuestas de reglas antiguas se descartan.
- **Disponibilidad automática.** `availability.mode` (`auto` por defecto, ausente = auto). Horas desde `AUTO_PEAK_HOURS` (nivel × distancia) por fase, limitadas por la rampa y por el tiempo libre real del calendario; sin día de descanso fijo; eventos de día completo ocupados bloquean el día. Sin pregunta de horas en el alta; "Tus horarios" en Tú con interruptor Automático (recomendado).

## Comprobaciones

`npm run test:all` en verde (TypeScript, 2.055 tests de app, 164 de base de datos, 260 de funciones) y 30 del worker. Recorrido en la demo web: pestañas en claro y oscuro, alta sin horas, chat que propone cambios ante "Tengo pádel el martes a las 19".

## Pendiente

- Probar en iPhone con la cuenta real: perfil antiguo pasando a automático, calendario lleno o vacío, propuesta de Claude que toca la semana siguiente, reintento parcial.
- Propuestas sustituidas se guardan como `discarded`; un estado propio pediría migración y tipos.
- `_shared/briefing/context.ts` aún usa las horas guardadas para las etiquetas de la semana del informe.
