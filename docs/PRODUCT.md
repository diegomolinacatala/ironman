# Rebufo — producto (resumen de la investigación y alcance del MVP)

Resumen ejecutivo de `docs/research/01..05`. Fecha: 25-oct-2026.

## 1. Qué hacen los demás (y qué copiamos)

| Producto | Lo mejor que tiene | Lo copiamos así |
|---|---|---|
| **TrainingPeaks** (de Garmin desde jul-2026) | Calendario semanal, colores de cumplimiento, gráfica de carga (forma/fatiga), carreras A/B/C | Mismos colores de cumplimiento (verde ±20 %, amarillo, naranja, rojo, gris) y gráfica de **Forma física / Fatiga / Frescura** (sin usar sus marcas TSS/CTL/ATL/TSB) |
| **TrainerRoad** | Anotaciones "enfermo/lesión/vacaciones" → adaptar plan; sesiones alternativas | **Imprevistos** tipados que generan una propuesta de cambios |
| **Runna** | Botón "no me encuentro al 100 %" con ventana de días | Imprevistos con rango de fechas y severidad |
| **Transition / Athletica** | El re-plan es una *propuesta* que aceptas con un toque | **Diff de propuesta**: aceptar todo, uno a uno o descartar |
| **MOTTIV / TriDot** | Disponibilidad en horas/semana y días largos | Disponibilidad: horas, día de descanso, días largos, días de piscina, franjas |
| **2PEAK / JOIN** | Franjas horarias por día, ajuste diario | Franjas por día de la semana + calendario del iPhone |
| **Strava** | Feed social y "entrenasteis juntos" (a posteriori) | Feed ligero con kudos; las quedadas se planifican *antes* |
| **Garmin Coach** | Sugerencias diarias, pero solo hasta media distancia | Tu Claude + reglas cubren distancia completa |
| **Strava / COROS MCP** | Exponen datos a Claude por MCP (solo lectura) | Nuestro MCP es de **lectura y escritura** |

## 2. Lo que nadie resuelve (nuestro diferenciador)

1. **Encontrar un hueco para entrenar con un amigo**: cruzar los *planes* y los *calendarios reales*
   (clases, trabajo) de dos personas y proponer qué sesión hacer juntos y cuándo → **Huecos** y
   **Oportunidades**.
2. **Re-planificar con la vida real**: pádel, fútbol, estrés laboral o una molestia son entradas de
   primera clase, no "días libres" → **Imprevistos**.
3. **El calendario del móvil como entrada** de disponibilidad (nadie lo lee).
4. **Tu propio Claude como entrenador**, con tus datos de Garmin, escribiendo en tu calendario.
5. **Quedadas como restricción fija**: el re-plan de cada uno respeta lo acordado con el otro.

## 3. Decisiones clave

- **Nombre**: *Rebufo* (ir a rueda). "Tandem" está cogido en la App Store y "Ironman"/"70.3" son
  marcas registradas que su dueño defiende activamente.
- **Claude**: Anthropic no permite que apps de terceros usen el login de tu suscripción. Por eso:
  (a) **Conecta tu Claude** = la app expone un servidor MCP personal que añades en claude.ai (usa tu
  suscripción); (b) **Coach IA** dentro de la app con la API de Anthropic (clave del desarrollador);
  (c) **motor de reglas** que funciona siempre, sin conexión.
- **Garmin**: Garmin reabrió su programa de desarrolladores el 21-oct-2026. La **Personal API**
  (oficial, gratis, clave por usuario, solo lectura) da sueño, VFC, Body Battery y actividades desde
  el día 1. Para **enviar entrenos al reloj** hace falta el nivel *Starter* (gratis, con solicitud):
  pedirlo ya. Mientras tanto, vuestro Claude puede subirlos con su conector de Garmin.
- **Strava descartado**: desde jun-2026 prohíbe usar sus datos con IA y mostrarlos a otros usuarios.
- **Apple Salud** como capa complementaria (entrenos, sueño, FC; Garmin no envía VFC ni VO2max).

## 4. Alcance del MVP

**Incluido**
- Cuenta (email con código / Apple), onboarding con disponibilidad, umbrales y primera carrera.
- Semana y Hoy: sesiones planificadas/completadas, cumplimiento, totales, fase de entrenamiento,
  cuenta atrás, readiness (check-in + métricas), consejos de alimentación por sesión.
- Imprevistos → propuesta de re-plan (reglas o Coach IA) → diff aceptable uno a uno.
- Coach: plan semanal, reorganizar, chat; Conecta tu Claude (MCP con 8 herramientas).
- Carreras A/B/C, periodización automática hacia la carrera A, gráfica de carga, volumen por deporte.
- Juntos: amigos, privacidad (todo / resumen / solo ocupado), comparar semanas, huecos comunes,
  oportunidades, quedadas con invitación y aceptación, feed con kudos, avisos.
- Datos: Garmin Personal API, Apple Salud, calendario del iPhone, nutrición.
- Notificaciones locales y push; widgets (Hoy, Cuenta atrás, Próximo entreno en bloqueo);
  calendario suscribible (ICS) para verlo en Calendario de Apple/Google.

**Fuera del MVP (siguiente)**
- Enviar entrenos estructurados al reloj desde la app (Garmin Training API, nivel Starter).
- OAuth para el conector de Claude (hoy URL personal secreta, revocable).
- Live Activity para quedadas, widgets interactivos ("Hecho" desde el widget).
- Grupos de más de 2 con quedadas abiertas, mensajes por quedada.
- Android.
