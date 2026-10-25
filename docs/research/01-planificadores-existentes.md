# 01 — Planificadores de entrenamiento existentes: qué hacen y qué copiamos

> **Fecha de la investigación:** 2026-10-25
> **Alcance:** cómo construyen el plan semanal, cómo adaptan (fallos, imprevistos, fatiga, readiness), cómo capturan disponibilidad, funciones sociales / calendario compartido / entrenar en grupo, notificaciones y widgets. La monetización queda fuera.
> **Para quién:** el equipo que construye el MVP (Expo/React Native + Supabase, iOS vía EAS → TestFlight) para dos compañeros de piso que preparan varios triatlones, uno de ellos de distancia completa, y usan Garmin y su propio Claude.

**Leyenda de vigencia** (se usa en todo el documento):

- **[2026]**: confirmado con una fuente de 2026.
- **[2025]**: confirmado con una fuente de 2025.
- **[ANTIGUO]**: la fuente es de 2024 o anterior. Puede estar desactualizado.
- **[VERIFICAR]**: dato de marketing, de foro, o deducido. Hay que comprobarlo en la app antes de usarlo para una decisión.

---

## 0. Resumen para decidir (TL;DR)

1. **Nadie resuelve bien "encontrar un hueco para entrenar con un amigo".** Strava detecta *a posteriori* que entrenasteis juntos (Group Activities) y tiene eventos de club con confirmación de asistencia. Howbout (calendario social genérico) comparte libre/ocupado. Ninguna app cruza *los planes de entreno* y *los calendarios de vida* de dos atletas para proponer una sesión conjunta compatible. **Es nuestro diferenciador principal.**
2. **Re-planificar tras imprevistos es el segundo hueco.** Los mejores patrones son:
   - las anotaciones de TrainerRoad ("Time Off / Illness / Injury"), que llevan a "Adaptar plan";
   - "Not Feeling 100%" de Runna, una ventana de 3 a 14 días;
   - el ajuste con un toque de Transition;
   - la ventana de simulación de 4 semanas de TrainerRoad AI.

   Ninguno modela bien una **actividad extra no planificada**, como un partido de pádel o fútbol, ni el estrés laboral como entrada de primera clase.
3. **La disponibilidad se captura de cinco formas** (ver §3.2):
   - horas por semana (MOTTIV, Athletica);
   - días disponibles más el día largo (Runna, Garmin Coach, TriDot);
   - minutos por día, editables cada día (JOIN);
   - ventanas horarias por día (2PEAK);
   - anotaciones de ausencia (TrainerRoad).

   **Ninguna lee el calendario del móvil para saber cuándo estás ocupado.** Athletica exporta, pero sin horas. Transition exporta a Apple/Google desde agosto de 2026, pero no lee de ellos.
4. **Estándar de cumplimiento a copiar: TrainingPeaks.**
   - Verde: ±20 % del plan.
   - Amarillo: 50–79 % o 121–150 %.
   - Naranja: desviación de más del 50 %.
   - Rojo: no hecho.
   - Gris: no planificado.
   - Métrica por defecto, en este orden: TSS, después duración, después distancia.
5. **Estándar de carga a copiar: el PMC.**
   - CTL (Fitness): media exponencial de 42 días.
   - ATL (Fatigue): media exponencial de 7 días.
   - TSB (Form) = CTL − ATL.
   - En la interfaz, TrainingPeaks lo llama ya "Fitness / Fatigue / Form".
6. **Patrón "conecta tu IA" en 2026: servidores MCP remotos con OAuth.** Strava (1-jun-2026, solo lectura), COROS (21-may-2026, solo lectura; escritura "en camino") y Transition (abr-2026) exponen sus datos a Claude por MCP. **Anthropic no permite que apps de terceros usen el login de una suscripción Free/Pro/Max de Claude** (aclaración del 19-feb-2026). Por tanto, "conectar tu Claude" debe hacerse así: **nuestra app expone un MCP**, el usuario lo añade como conector en claude.ai, y su Claude, que ya tiene Garmin, lee y escribe el plan en la app.
7. **Alerta de Garmin.** Desde la primavera de 2026 el Garmin Connect Developer Program **no acepta nuevas solicitudes**, sin fecha de reapertura. Afecta a la Health API, la Activity API y la Training API, que es la que empuja entrenos al reloj. Además, **Garmin compró TrainingPeaks y TrainHeroic** el 22-jul-2026. Para el MVP **no podemos depender de la API oficial de Garmin**. Las rutas viables son el propio Claude del usuario con su conector Garmin, Apple Health e intervals.icu como puente (§4.6).
8. **Garmin Triathlon Coach solo cubre sprint, estándar y media distancia.** No cubre la distancia completa, y su sugerencia diaria nunca propone descanso. Es un hueco real para nuestros usuarios.
9. **Convenciones de widget ya establecidas** (TrainingPeaks):
   - Tamaños pequeño y mediano: CTL/ATL/TSB más el entreno de hoy.
   - Tamaño grande: añade el de mañana.
   - Al tocar un entreno se abre su tarjeta.
   - Para iOS añadimos pantalla de bloqueo y Live Activity para la "quedada".
10. **Nombre:** "IRONMAN", "70.3", "IRONKIDS" y el logo M-Dot son marcas de World Triathlon Corporation, que las defiende activamente (disputas UDRP como ironmanbarcelona.com). Propuesta principal: **Rebufo**, con "Quedadas", "Huecos" e "Imprevistos" como nombres de función (§4.8).

---

## 1. Contexto de mercado 2025–2026 (lo que ha cambiado)

| Fecha | Hecho | Por qué nos importa |
|---|---|---|
| mar-2025 | Garmin lanza **Connect+** (6,99 $/mes): *Active Intelligence*, avisos de IA al despertar, tras entrenar y por la noche | Patrón de notificación diaria: resumen de mañana más feedback de tarde |
| abr-2025 | **Strava compra Runna** (y The Breakaway) | Strava pasa de red social a red social con planes |
| 10-abr-2025 | **Polar Fitness Program** (9,99 €/mes, planes adaptativos de 4 semanas) | Todos los fabricantes ofrecen ya un plan adaptativo de suscripción |
| oct-2025 | Strava demanda a Garmin (términos de API y atribución) y la retira unas tres semanas después | El ecosistema de APIs es inestable |
| ene-2026 | Strava **Instant Workouts** (sugerencias en el feed, Premium) | Sugerencias de entreno dentro de un feed social |
| ene-2026 | Garmin añade **registro de nutrición** a Connect+ y lo cruza con el sueño y la recuperación | Nutrición conectada con recuperación |
| 21-ene-2026 (aprox.) | **TrainerRoad AI**: ventana de simulación de 4 semanas, predicción de FTP y dificultad prevista por sesión | Mejor UX de "qué pasa si cambio esto" |
| 19-feb-2026 | Anthropic aclara que **los tokens OAuth de Free/Pro/Max no se pueden usar en productos de terceros** | No podemos hacer "Login con Claude" para usar su suscripción |
| primavera-2026 | **Garmin pausa las nuevas altas** del Connect Developer Program (20-may: "rediseño significativo") | No hay API oficial de Garmin para apps nuevas |
| 30-mar-2026 | TriDot lanza su **nueva app iOS** (v1.0.0); en oct-2026 ya está en español | El competidor directo en triatlón es fuerte en datos |
| abr–ago-2026 | **Transition** añade readiness por VFC, chat con acciones, MCP, check-in post-entreno y sincronización con calendario | Es el "AI coach de chat" más cercano a nuestra idea |
| 21-may-2026 | **COROS MCP** (ChatGPT/Claude, solo lectura) | Patrón MCP |
| 1-jun-2026 | **Strava MCP** para Claude (remoto, OAuth, solo lectura, suscriptores) | Patrón MCP; Claude es el primer cliente |
| 9-jul-2026 | Strava: **pestaña Events** dentro de Groups (quedadas de club y carreras con filtros) | Descubrimiento de quedadas; sigue sin cruzar agendas |
| 21-jul-2026 | Strava: **Club Messaging** (encuestas y temas), integración con Runna e integración con Claude | Chat de grupo dentro de la app deportiva |
| 22-jul-2026 | **Garmin compra TrainingPeaks y TrainHeroic** | El estándar de planificación pasa a ser de Garmin |
| 30-sep-2026 | Lanzamiento de **RestOrTrain** (coach conversacional que cambia el calendario y empuja entrenos) | Más entrantes de "IA conversacional" |

Fuentes: [the5krunner (pausa de la API de Garmin)](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/), [Terra (pausa del GCDP)](https://tryterra.co/blog/garmin-connect-developer-program-pause), [Garmin newsroom (TrainingPeaks)](https://www.garmin.com/en-US/newsroom/press-release/corporate/garmin-acquires-trainingpeaks-and-trainheroic-leading-endurance-and-strength-training-platforms-for-athletes-and-coaches/), [Bicycle Retailer](https://bicycleretailer.com/industry-news/2026/07/22/garmin-acquires-trainingpeaks-trainheroic-platforms), [Strava MCP (soporte)](https://support.strava.com/hc/en-us/articles/46190267796237-Strava-MCP-Connector), [Android Authority (COROS MCP)](https://www.androidauthority.com/coros-launches-mcp-3669570/), [9to5Mac (Strava Events)](https://9to5mac.com/2026/07/09/strava-gets-an-events-tab-with-upcoming-races-group-runs-more/), [IndoTelko (Strava, jul-2026)](https://www.indotelko.com/read/1784589282/strava-tambah-fitur-ai-claude-dan-club-messaging), [the5krunner (Connect+)](https://the5krunner.com/2026/04/20/garmin-connect-plus-review/), [Android Authority (nutrición en Garmin)](https://www.androidauthority.com/garmin-connect-nutrition-tracking-feature-3629846), [TrainerRoad AI](https://www.trainerroad.com/blog/introducing-trainerroad-ai/), [Gigazine (política OAuth de Anthropic)](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block), [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/), [Polar Fitness Program](https://polar.com/en/media-room/polar-introduces-fitness-program), [Endurance.biz (RestOrTrain)](https://endurance.biz/2026/industry-news/new-restortrain-app-launches-as-conversational-ai-coaching-platform-for-endurance-sports/), [the5krunner (¿Runna es IA?)](https://the5krunner.com/2026/09/28/is-runna-ai/).

---

## 2. Fichas por producto

Cada ficha sigue el mismo esquema:

- **Plan**: cómo se construye la semana.
- **Adapta**: cómo responde a fallos, imprevistos y fatiga.
- **Disponibilidad**: cómo la captura.
- **Social**: funciones sociales y de calendario compartido.
- **Avisos**: notificaciones y widgets.
- **Copiamos**: lo que nos llevamos al MVP.

### 2.1 TrainingPeaks (Garmin desde jul-2026)

**Qué es.** Es la plataforma de referencia entre entrenador y atleta en resistencia. Gira en torno al calendario, el análisis y los planes que se compran o los que escribe un entrenador. **No genera planes con IA**: el plan viene del entrenador, de una compra o del propio atleta. [2026]

**Plan.**
- Calendario semanal con arrastrar y soltar, biblioteca de entrenos y constructor de entrenos estructurados. Desde jul-2024 tiene también constructor de fuerza, con más de 1.000 vídeos. [ANTIGUO, sigue vigente]
- **ATP (Annual Training Plan):**
  - Hay que marcar cada carrera como **A, B o C**. Las C no afectan al ATP.
  - El auto-cálculo exige al menos una carrera A.
  - Las carreras A deben estar a ≤32 semanas entre sí y a ≤48 semanas del inicio del ATP.
  - Tres métodos: por **duración** (recomendado para principiantes), por **TSS medio semanal** o por **CTL objetivo el día de carrera**, que calcula hacia atrás el TSS semanal necesario.
  - Periodos de Joe Friel:

    | Periodo | Duración sugerida |
    |---|---|
    | Transition | 1–6 semanas |
    | Preparation | 3–4 semanas |
    | Base | 8–12 semanas |
    | Build | 6–8 semanas |
    | Peak | 1–2 semanas |
    | Race | 1–3 semanas |

  - [Guía del ATP](https://www.trainingpeaks.com/learn/articles/the-comprehensive-guide-to-creating-an-annual-training-plan/), [Metodologías del ATP](https://help.trainingpeaks.com/hc/en-us/articles/224662768-Annual-Training-Plan-Methodologies).
- **PMC:** CTL es la media exponencial del TSS diario de 42 días, ATL la de 7 días, y TSB = CTL − ATL. La interfaz los llama *Fitness / Fatigue / Form*. [Explicación del PMC](https://support.myprocoach.net/hc/en-us/articles/360040589772)
- **TSS por deporte:**

  | Deporte | Método preferente | Alternativas, en orden |
  |---|---|---|
  | Natación | sTSS (ritmo) | hrTSS |
  | Carrera | TSS por potencia | rTSS por ritmo normalizado ajustado a pendiente frente a umbral, después hrTSS |

  Todo depende de que los umbrales estén bien puestos. [Ayuda de TSS](https://help.trainingpeaks.com/hc/en-us/articles/204071944)

**Adapta.**
- No re-planifica sola. Adaptar es trabajo del entrenador o del atleta.
- Lo que sí hace es dejar el desvío a la vista con los **colores de cumplimiento**:

  | Color | Significado |
  |---|---|
  | Verde | ±20 % del plan |
  | Amarillo | 50–79 % o 121–150 % |
  | Naranja | desviación de más del 50 % |
  | Rojo | no completado |
  | Gris | no planificado |

- La métrica que manda es, por defecto, TSS, después duración, después distancia. Se puede reordenar o desactivar. [Ayuda de cumplimiento](https://help.trainingpeaks.com/hc/en-us/articles/204861204)
- Desde ene-2024 hay colores de cumplimiento también para objetivos (solo web), y desde jul-2023 una barra de cumplimiento en el resumen de iOS. [ANTIGUO]

**Disponibilidad.** No la modela. El entrenador la conoce fuera de la app.

**Social.**
- El modelo es entrenador → atleta. El entrenador ve y edita el calendario del atleta.
- Se pueden compartir carpetas de entrenos y planes con otras cuentas.
- **No hay calendario compartido entre amigos.**
- El calendario se puede exportar en **.ics** (solo Premium; los cambios tardan hasta 24 h). [Relaciones entrenador-atleta](https://help.trainingpeaks.com/hc/en-us/articles/204072384-Functionality-of-the-Different-Coach-Athlete-Relationships), [Exportar .ics](https://help.trainingpeaks.com/hc/en-us/articles/204072184)
- Mensajería entre entrenador y atleta Premium con fotos, vídeo y documentos, y grupetas en *TrainingPeaks Virtual*. [2025–2026]

**Pantalla de inicio: *Athlete Home*.** Es un hub diario personalizable. Arriba muestra Fitness, Form y Fatigue, y reúne datos de Garmin, Polar, Oura, COROS y WHOOP. [2026, [blog](https://www.trainingpeaks.com/blog/trainingpeaks-athlete-home/)]

**Avisos.**
- **Widget iOS** en tres tamaños:

  | Tamaño | Contenido |
  |---|---|
  | Pequeño y mediano | CTL, ATL, TSB y el entreno de hoy |
  | Grande | Añade el de mañana |

  Al tocar una métrica se abre el inicio; al tocar un entreno, su tarjeta. Solo existe para cuentas de atleta, y no hay pruebas de un widget de pantalla de bloqueo. [VERIFICAR, [ayuda](https://help.trainingpeaks.com/hc/en-us/articles/32841877166477-TrainingPeaks-iOS-Widget)]
- Las notificaciones son Premium, salvo los avisos de cambio de umbral. Hay notificaciones post-entreno (nuevos umbrales, marcas). [ANTIGUO, [ayuda](https://help.trainingpeaks.com/hc/en-us/articles/360053198451-Manage-Alerts-Notifications-on-the-TrainingPeaks-Mobile-App)]

**Copiamos.**
- Calendario semanal con fila de totales.
- Colores de cumplimiento con los umbrales de TrainingPeaks.
- PMC simplificado (Fitness / Fatiga / Forma).
- Prioridad A/B/C por carrera.
- La disposición del widget (hoy y mañana).

### 2.2 TriDot

**Qué es.** Plataforma de triatlón "optimizada" con el motor FitLogic. Varias reseñas la describen como plataforma oficial de IRONMAN [VERIFICAR]. Nueva app iOS desde el 30-mar-2026; la v1.4.0 (2-oct-2026) añade español, francés, alemán, neerlandés y danés. [2026, [App Store](https://apps.apple.com/us/app/tridot-triathlon-training/id6754208848)]

**Plan.**
- Un único plan que integra natación, bici y carrera, del sprint a la distancia completa, con objetivos de ritmo, potencia y esfuerzo.
- **EnviroNorm** ajusta por calor, humedad, altitud y viento.
- **RaceX** hace el plan de carrera: ritmos, potencia y parciales.
- Usa el concepto de "dosis mínima eficaz" en lugar de volumen máximo.

**Adapta.**
- Ajusta tras cada sesión registrada.
- Si faltas **más de unos 5 días**, baja solo la carga futura. [Ayuda sobre enfermedad o lesión](https://support.tridot.com/hc/en-us/articles/5632284661133-Does-my-schedule-adjust-if-I-m-sick-or-injured)
- La propia TriDot no se compromete a una respuesta concreta para cada sesión fallada. [VERIFICAR]

**Disponibilidad.** Va en *Training Preferences*:
- día largo de carrera y día largo de bici;
- **máximo de sesiones por semana y disciplina** (como mínimo 1);
- fuerza activada o no;
- desactivar una disciplina, útil con una lesión.

TriDot avisa de que cada restricción limita al optimizador. [Preferencias](https://tridot.com/resource-library/updating-your-preferences)

**Social.** Comunidad y "entrenos de amigos" (la v1.4.0 arregla su apertura) y un "Assistant" de preguntas. Es un nivel social básico.

**Avisos.** No se documentan widgets ni notificaciones. [VERIFICAR]

**Copiamos.**
- Preferencias por disciplina: día largo y máximo de sesiones.
- Desactivar una disciplina por lesión.
- Ajuste automático tras ausencias largas.

### 2.3 MOTTIV

**Plan.** Planes escritos por entrenadores a partir de las carreras del calendario. Incluyen fuerza, entrenamiento cruzado y nutrición. **El detalle solo se muestra para 2 semanas** (esta y la siguiente); más allá solo hay un resumen. [VERIFICAR, [ayuda](https://mymottiv.com/help-center-articles/how-can-i-see-all-of-my-workout-details-over-the-next-few-months)]

**Disponibilidad.** Un **control deslizante de horas por semana** que se puede mover en cualquier momento, también a mitad de plan. El control **muestra cómo se traducen esas horas en el resultado previsto de la carrera**. [[Añadir o quitar entrenos](https://mymottiv.com/help-center-articles/add-or-subtract-workouts)]

**Adapta.** "Los entrenos se adaptan sobre la marcha". Al añadir carreras, el plan se rehace.

**Social.** Feed social con crónicas de carrera y preguntas.

**Copiamos.**
- El control de horas con su impacto visible ("con 9 h/semana: terminar cómodo; con 12 h: objetivo de tiempo").
- Detalle completo solo a 1–2 semanas vista; el resto, resumido. Así se reduce el ruido y el coste de re-planificar.

### 2.4 HumanGO (Humango, con el coach "Hugo")

**Plan.** Plan con IA a partir de objetivos, nivel y **disponibilidad diaria**, que se pide en el alta. Triatlón de sprint a **distancia completa**. Prioridades A/B/C: pica para la A y usa B y C como calidad o experiencia. [2026, [App Store](https://apps.apple.com/app/id1554430755), [Challenge Family, 16-mar-2026](https://challengefamily.com/news/one-season-one-plan-how-humango-is-ending-the-spreadsheet-struggle-for-challenge-family-athletes/)]

**Adapta.**
- "Recalibración en tiempo real" de todo el calendario futuro ante una reunión que se alarga, una enfermedad o fatiga.
- Usa FC, sueño y recuperación del wearable.
- Aprende del feedback por sesión ("demasiado fácil" / "no completado").

**Social.** *Tribes* (equipos, clubes, grupos virtuales), retos sociales con amigos (abr-2026) y *Coach Mode*.

**Avisos.** No se documentan widgets. [VERIFICAR]

**Copiamos.**
- La disponibilidad diaria en el alta.
- Recalcular el futuro (no solo mover la sesión).
- Feedback mínimo por sesión.

### 2.5 Athletica.ai

**Plan.**
- Periodización de hasta 52 semanas (base, construcción, recuperación, afinamiento) usando **2 años de histórico** de archivos .fit.
- Horas semanales elegidas por la app o puestas a mano (por ejemplo, 10 h ±2).
- Días de entreno configurables. Un icono de descanso puede **forzar el descanso** o **dejar que la IA decida**. [Programación personalizada](https://support.athletica.ai/hc/en-us/articles/34808431659931-How-to-Use-the-Custom-Scheduling-Settings-in-Athletica)

**Adapta.**
- Lee la VFC nocturna y la FC en reposo y las cruza con el esfuerzo del día anterior. Si sube la tensión, suaviza el día siguiente.
- Usa la combinación de **RPE, sensación y comentarios**.
- Permite **mover, saltar o intercambiar** sesiones, y **bloquear la sesión de hoy** para que la IA no la toque.
- El AI Coach **explica y sugiere, pero no modifica solo**. [[Triatlón](https://athletica.ai/sports/triathlon), [Transition (comparativa)](https://www.transition.fun/blog/best-triathlon-training-apps-2026/)]

**Disponibilidad y calendario.** La URL de sincronización de calendario crea **eventos de día completo**, porque Athletica no asigna horas. Es exactamente el hueco que queremos cubrir.

**Copiamos.**
- "Bloquear sesión" (candado).
- El modo "la IA sugiere, tú aceptas".
- Trío RPE, sensación y nota.
- Descanso forzado frente a descanso decidido por la IA.

### 2.6 2PEAK

- **Disponibilidad:** el atleta pone **ventanas de tiempo por día**. La suma da el *Max available Training Time*. La *Usable Training Volume* es lo que 2PEAK planifica de verdad, y puede ser menos. [Blog de 2PEAK](https://blog.2peak.com/?p=7682)
- **Adapta:** no hace falta avisar si saltas o aplazas una sesión. El plan se reajusta según el rendimiento y cambia tras cada sesión no completada en su día. [VERIFICAR, [App Store](https://apps.apple.com/app/id1053397362)]
- **Copiamos:** separar la **disponibilidad declarada** del **volumen usado**. Que tengas 2 h no obliga a entrenar 2 h.

### 2.7 TrainerRoad (con TrainerRoad AI desde dic-2025/ene-2026)

**Plan.**
- *Plan Builder* desde la carrera objetivo; puede incluir días sin bici ya previstos (viajes, vacaciones).
- Planes de triatlón, incluidos Masters con proporción carga:descanso de 2:1 (3:1 en los no Masters).
- **Natación y carrera se prescriben por esfuerzo, fuera de la app.** [[Novedades de planes](https://www.trainerroad.com/blog/first-adaptive-training-feature-release-and-training-plan-updates/), [comparativa de Transition](https://www.transition.fun/blog/best-triathlon-training-apps-2026/)]

**Adapta.**
- **Anotaciones de calendario:** *Time Off*, *Illness*, *Injury* o *Note*. Al añadirlas, la app pide **"Adapt plan"**. [[Anotaciones](https://support.trainerroad.com/hc/en-us/articles/4404676155035-Calendar-Annotations)]
- **Red Light Green Light** (2024): los días amarillos cambian la sesión dura por resistencia, y los rojos la convierten en descanso. Necesita potencia (o FC, con menos precisión) y unas 6–8 semanas de histórico. [ANTIGUO, [foro](https://www.trainerroad.com/forum/t/red-light-green-light-is-now-available-to-all-trainerroad-athletes/91907)]
- **TrainerRoad AI** (2026):
  - **Ventana de simulación de 4 semanas**, unos 29 días, en el calendario. Se recalcula en vivo al saltar, añadir o mover sesiones.
  - Predicción de FTP a 28 días.
  - **Dificultad prevista por sesión:** *Easy / Moderate / Hard / Very Hard / Maximal*, con un porcentaje.
  - *Workout Alternates*: alternativas más fáciles, más duras, más cortas o más largas.
  - *Fatigue Detection* con botón **"restore"** para volver a la sesión original.
  - Control *Training Approach* para la exigencia global.
  - *Dynamic Endurance* para alargar progresivamente los rodajes largos.
  - [[Introducing TrainerRoad AI](https://www.trainerroad.com/blog/introducing-trainerroad-ai/), [Ventana de simulación](https://support.trainerroad.com/hc/en-us/articles/41652509070619-AI-Simulation-Window)]
- **TrainNow:** recomienda una sesión suelta por categorías (*Endurance / Climbing / Attacking*) según la carga reciente. No tiene en cuenta la periodización. [[Resumen de TrainNow](https://support.trainerroad.com/hc/en-us/articles/360057075531-TrainNow-Overview)]

**Disponibilidad.** No hay horario semanal fino. Se gestiona con anotaciones y alternativas de duración.

**Social.** Casi nulo en la app.

**Avisos.** Envía los entrenos de exterior al Apple Watch. No se ha encontrado widget iOS. [VERIFICAR]

**Copiamos.**
- El flujo "anotación → Adaptar plan".
- Etiquetas de dificultad prevista.
- Alternativas para una sesión (más corta, más fácil...).
- Botón de restaurar.
- La idea de "ventana de trabajo" (re-planificar solo 1–4 semanas).

### 2.8 Intervals.icu

**Plan.**
- Calendario con arrastrar y soltar, biblioteca y planes que se asignan desde una fecha. Los entrenos se *copian*, así que editarlos no rompe el plan.
- **No genera planes.**
- PMC (fitness, fatiga, forma) multideporte. [[intervals.icu](https://intervals.icu), [foro](https://forum.intervals.icu/t/q-how-do-i-use-the-coaching-feature-on-intervals-icu/41038)]

**Cumplimiento.**
- Empareja automáticamente actividad y sesión planificada si coinciden deporte y carga o tiempo; también a mano arrastrando.
- Colores: **80–120 % bueno (verde)**, 50–150 % pobre (naranja), el resto malo (rojo). Se muestra como punto o barra de color.
- **El cumplimiento no sale por la API**: se calcula en el cliente. [[Foro: semáforo de cumplimiento](https://forum.intervals.icu/t/more-prominent-colour-for-completed-workouts-traffic-light-compliance-indicator/84)]

**Social.** **Seguir** (solo lectura) frente a **entrenar** (escritura). Los datos son privados por defecto y hay que aceptar cada solicitud. Las actividades que vienen de Strava se ocultan a los seguidores. [[Atletas](https://www.intervals.icu/features/athletes/)]

**Integración (clave para nosotros).**
- API REST con clave personal (Settings → Developer Settings).
- Descarga automática de bienestar (VFC, sueño, FC en reposo) desde Garmin Connect.
- **Sube los entrenos planificados a Garmin.** Un usuario dice que solo se suben los próximos 7 días [VERIFICAR].
- Lo usan como **puente hacia Garmin** apps como Blocks, mientras Garmin no da altas nuevas. [[Integraciones](https://www.intervals.icu/integrations/), [the5krunner](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/)]

**Copiamos.**
- Los permisos de seguir frente a editar, aceptados por el propietario.
- El emparejamiento automático entre plan y actividad.
- Usar intervals.icu como puente opcional hacia Garmin.

### 2.9 Final Surge

- Calendario personal, de **equipo** y por atleta. El entrenador mueve, añade o quita sesiones en cualquiera de ellos. [[App Store](https://apps.apple.com/us/app/-/id929796646)]
- Comunicación por comentarios post-actividad, **sensación del entreno** e **informes de dolor o lesión**. *Social Wall* de equipo.
- Correos diarios con el entreno del día y organización de **group runs**.
- **Copiamos:** el informe de dolor o lesión como objeto estructurado (zona y severidad), no como texto libre, y el resumen diario.

### 2.10 JOIN (ciclismo)

- **Disponibilidad:** la mejor implementada del sector.
  - Se indica **para cada día de la semana** cuánto tiempo hay.
  - Se puede cambiar **cada día**, y el cambio se refleja al instante en el plan.
  - El resultado puede ser un entreno o **un día de descanso**: no siempre usa todo el tiempo.
  - [[Cómo funciona JOIN](https://join.cc/how-join-works/), [foro de TrainerRoad](https://www.trainerroad.com/forum/t/join-cycling-app/62908)]
- **Adapta:** con datos del entreno, **RPE tras cada sesión**, una pregunta de **"¿cómo de listo estás?"** (agujetas y fatiga) y la disponibilidad. Según usuarios, también tiene en cuenta las salidas no planificadas con la grupeta.
- **Copiamos:** editar la disponibilidad de *hoy o mañana* en un segundo con recálculo inmediato, y la pregunta de readiness subjetiva en dos ejes (agujetas y fatiga).

### 2.11 Runna (de Strava desde abr-2025)

**Plan.** Lo diseñan entrenadores y lo adapta un algoritmo; según Runna, **no lo crea una IA**. La configuración incluye:
- **días disponibles** para correr;
- **carreras por semana** (mínimo 2);
- **día de la tirada larga**, que se cambian en Plan → Manage Plan → Running Schedule.

[[Ajustar tu calendario de carrera](https://support.runna.com/en/articles/6206024-adjusting-your-running-schedule), [the5krunner](https://the5krunner.com/2026/09/28/is-runna-ai/)]

**Mover sesiones.**
- Se arrastran dentro de la misma semana o ±1 semana.
- Solo a días **sin** otra carrera del plan.
- No se pueden mover en lote ni intercambiar semanas.
- Avisa si el cambio puede afectar al entrenamiento. [[Calendario de entreno](https://support.runna.com/en/articles/10137793-how-to-use-and-manage-your-training-calendar)]

**Adapta.**
- **"Not Feeling 100%"**, en Manage Plan → Adapt Your Plan:
  - Motivo: enfermedad, molestias o semana caótica.
  - Ventana de **3 a 14 días**.
  - Opciones: **mantener solo los rodajes suaves, acortar o pausar**, y quitar la fuerza.
  - Se elige la velocidad de vuelta.
  - **Push el día antes de que acabe** para prorrogar.
  - **No se puede aplicar con fecha pasada.**
  - Para ausencias de más de 14 días recomienda un plan nuevo.
  - [[Cómo usar Not Feeling 100%](https://support.runna.com/en/articles/13531498-how-to-use-not-feeling-100), [Tom's Guide](https://www.tomsguide.com/wellness/fitness/im-deep-into-marathon-training-fighting-the-flu-and-runnas-new-not-feeling-100-percent-tool-couldnt-be-more-timely)]
- Los ritmos objetivo se ajustan si fallas o superas el objetivo *repetidamente*, no por una sola sesión.
- *Adapt for Heat* según la previsión meteorológica.
- Explicaciones personalizadas por entreno (2026).

**Social.** Llega a través de Strava: desde jul-2026 los entrenos de Runna se ven en la página de actividad de Strava, y su base de carreras alimenta Strava Events.

**Copiamos.**
- El modelo de configuración "días disponibles + sesiones por semana + día largo".
- Las reglas de movimiento con aviso.
- **"Not Feeling 100%" como plantilla de nuestro botón "Imprevisto"**: ventana de días, tres niveles de reducción y aviso de fin de ventana.

### 2.12 Garmin (Garmin Coach, sugerencias diarias, calendario de Connect, Connect+)

**Plan.**
- **Garmin Coach** tiene versiones de carrera, ciclismo y **triatlón**. Esta última es gratuita en relojes compatibles y cubre **sprint, estándar y media distancia**. **No hay distancia completa.**
- Incluye dobles sesiones, *bricks* y fuerza opcional.
- Tiene en cuenta el sueño, la recuperación y la forma física. [2026, [blog de Garmin, 29-jul-2026](https://www.garmin.com/en-GB/blog/?p=11178)]

**Disponibilidad.**
- Al crear el plan se eligen los **días disponibles** y el **día de la tirada larga**.
- Hay quejas de que los ajustes se reinician a "Every Day" / "Weekends".
- Mover una sesión: ⋯ → *Reschedule* y después **Send to Device**. [VERIFICAR, [foro de Garmin](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/444196/garmin-run-coach---days-available-and-long-run-days-keeps-getting-reset-to-every-day-weekends), [Tom's Guide](https://www.tomsguide.com/how-to/download-training-plan-garmin-watch)]

**Sugerencias diarias (Daily Suggested Workouts).**
- Se basan en el estado de entrenamiento, la carga y su foco, el VO2max, el tiempo de recuperación, el sueño, los entrenos recientes y la carrera del calendario.
- Usan el motor de Firstbeat.
- **No proponen días de descanso** (según T3). [VERIFICAR, [Fleet Feet](https://www.fleetfeet.com/blog/how-to-use-garmin-daily-suggested-workouts), [T3](https://www.t3.com/features/how-do-garmin-daily-workout-suggestions-work)]

**Carreras.**
- Se añaden en *Training & Planning → Races & Events*, con fecha dentro de los **próximos 365 días**.
- Con varias carreras, la app pide elegir la **carrera principal**.
- En el reloj, la vista de carrera muestra cuenta atrás, tiempo objetivo o previsto y el tiempo meteorológico (previsión unos 14 días antes). [[Manual de Garmin](https://www8.garmin.com/manuals/webhelp/GUID-708A8F4D-9A78-49CF-9528-DE109BBCC472/EN-US/GUID-8186A9FE-DFC1-4DC3-89B2-221883A60B6A.html)]

**Avisos en el reloj.**
- **Morning Report**: puntuación de sueño, estado de la VFC (media de 7 días: *Balanced / Unbalanced / Low / Poor*), Training Readiness de 0 a 100, entreno sugerido, el **calendario del teléfono** y el tiempo.
- **Evening Report** desde 2025.
- [[the5krunner](https://the5krunner.com/2022/06/28/garmin-morning-report/), [Gadgets & Wearables](https://gadgetsandwearables.com/2025/05/18/garmin-evening-report/)]

**Connect+.**
- Avisos de IA al despertar, tras entrenar y por la noche.
- **No tiene chat** para responder (según una reseña).
- Nutrición desde ene-2026.

**Widgets iOS de Garmin Connect.** Hay pocos; los usuarios piden más en el foro. [VERIFICAR]

**Copiamos.**
- El **"parte de la mañana" como notificación diaria**: sueño, VFC, readiness, sesión de hoy y quién entrena contigo.
- El "parte de la noche" para pedir feedback.
- La carrera principal con cuenta atrás.

### 2.13 Strava

**Plan.**
- No prescribe planes; Runna se encarga de eso.
- *Athlete Intelligence* (2024) resume datos.
- *Instant Workouts* (ene-2026, Premium) son sugerencias en un carrusel del feed. [[3bikes](https://www.3bikes.fr/en/2026/01/09/strava-launches-instant-workouts-personalized-training-recommendations-directly-in-your-feed/)]

**Social: la referencia del sector.**
- **Group Activities** detecta *a posteriori* que grabasteis al mismo tiempo y por la misma ruta:
  - estar "cerca" (a menos de unos cientos de metros) **más del 50 % del tiempo**;
  - es asimétrico y no depende del tipo de actividad;
  - se puede desactivar con privacidad *No One*;
  - se pueden añadir amigos que no estén en Strava.
  - [[Ayuda de Strava](https://support.strava.com/hc/en-us/articles/216919497-Group-Activities)]
- **Club Events** con invitación, asistencia, ruta y aviso a los miembros (desde 2017). [ANTIGUO, [Bicycle Retailer](https://bicycleretailer.com/product-tech/2017/04/18/strava-adds-club-feature-enable-group-bike-ride-planning)]
- **Mensajería** directa y de grupo desde dic-2023, con permisos de quién te escribe (*following / mutuals / no one*). [[BikeRadar](https://www.bikeradar.com/news/you-can-finally-send-direct-and-group-messages-on-strava)]
- **Club Messaging** con encuestas y temas (jul-2026).
- **Pestaña Events** dentro de Groups (9-jul-2026): quedadas y carreras filtrables por distancia, fecha, lugar, deporte, desnivel y temperatura.
- Más de 1 millón de clubes; los clubes de running crecieron más de un 59 % en 2025. [[Endurance.biz](https://endurance.biz/2026/industry-news/strava-introduces-race-and-club-event-discovery-features/)]
- Atletas favoritos arriba del feed, con aviso de cada subida.
- *"Athletes for You"*: **no se ha encontrado documentación**. [VERIFICAR]

**Claude.** Conector **MCP** remoto, OAuth y solo lectura, para suscriptores. Despliegue gradual desde el 1-jun-2026. Para Claude Code: `claude mcp add --transport http strava-mcp https://mcp.strava.com/mcp`. [[Soporte de Strava](https://support.strava.com/hc/en-us/articles/46190267796237-Strava-MCP-Connector)]

**Avisos.** Widget de objetivo semanal de distancia en iOS. No se ha visto Live Activity propia. [VERIFICAR, [Tom's Guide](https://www.tomsguide.com/wellness/fitness/this-easy-strava-trick-means-i-never-miss-a-run-how-to-add-the-strava-widget-to-your-iphone-homescreen)]

**Copiamos.**
- Las reglas de "entrenamos juntos" para emparejar después la sesión conjunta (solapamiento de tiempo y GPS).
- Los permisos de mensajes y de visibilidad.
- La invitación con asistencia.

**No copiamos.**
- El feed algorítmico.
- Strava organiza *eventos* y detecta *lo ya hecho*, pero no **propone el hueco**.

### 2.14 Wahoo SYSTM

- **Plan Builder:**
  - tipo de plan (Cycling o Multisport) y propósito (Season Prep o Race Prep);
  - disciplina y distancia;
  - volumen bajo, medio o alto;
  - complementos de fuerza, yoga y mental.

  Los umbrales salen del test **4DP**: sprint, 1 min, 5 min y FTP.
- **Días fijos:** larga de bici el sábado, larga de carrera el domingo, natación lunes, miércoles y viernes. [ANTIGUO (2022), [Slowtwitch](https://slowtwitch.com/training/wahoo-systm-long-term-review/)]
- Según usuarios, **no es adaptativo**. En ene-2026 seguían abiertas en su foro peticiones como "Calendar Sync". [VERIFICAR, [foro de Wahoo](https://wahoox.forum.wahoofitness.com/c/systm-software/feature-requests/11)]
- **Lección:** días fijos y sin adaptación es justo lo que **no** queremos.

### 2.15 COROS (Training Hub y EvoLab)

- **Training Hub:**
  - Dashboard (forma, recuperación, zonas).
  - **EvoLab** (métricas día a día y semana a semana; se desbloquea con una carrera y usa hasta 6 semanas).
  - **Calendario con métricas predictivas** (cómo afectará el plan a tu forma).
  - Gráfica anual de 6 meses pasados y 6 futuros.
  - Biblioteca de planes, constructor de entrenos y equipos con entrenador. [ANTIGUO, [COROS](https://coros.com/stories/coros-metrics/c/welcome-to-the-training-hub)]
- **MCP** (21-may-2026) para ChatGPT y Claude, **solo lectura**: carga, ritmos, recuperación, sueño, VFC y preparación para carrera. La escritura, que permitiría planes de IA y cambios de calendario, está "en camino". [[Android Authority](https://www.androidauthority.com/coros-launches-mcp-3669570/)]
- **Copiamos:** proyectar la carga futura del plan en el calendario, para ver si la semana te deja fundido.

### 2.16 Polar

- **FitSpark:** sugerencias diarias ordenadas por histórico y nivel. Si hay un plan activo, sigue sus objetivos. [[Ayuda de Polar](https://support.polar.com/de/fitspark-daily-training-guide)]
- **Fitness Program** (10-abr-2025):
  - planes de 4 semanas y 20 niveles, por zonas de FC;
  - si no estás recuperado, propone una sesión más ligera;
  - 9,99 €/mes.
  - [[Nota de prensa de Polar](https://polar.com/en/media-room/polar-introduces-fitness-program)]
- **Running Program:** de 5K a maratón, 2–5 carreras por semana y 1–7 h. **Season Planner** por fases.
- **Copiamos:** "sesión más ligera si no estás recuperado" como regla base sencilla.

### 2.17 Nolio (Francia)

- Plataforma entre entrenador y atleta, cercana a TrainingPeaks y asociada con la Federación Francesa de Atletismo.
- Planificación con arrastrar y soltar y duplicado desde biblioteca.
- **Plan frente a real**, con monotonía y tensión de carga.
- El atleta registra **sensaciones** por sesión.
- Precios: Premium Athlete 7,99 €/mes; entrenador individual 29,99 €/mes. [VERIFICAR, [App Store](https://apps.apple.com/app/nolio/id1615773607), [G2](https://www.g2.com/sellers/nolio)]
- **Copiamos:** monotonía y tensión como alertas de "semana demasiado igual o demasiado cargada" (en "Podría").

### 2.18 Nuevos entrantes 2025–2026 y apps sociales de nicho

| Producto | Qué aporta | Fuente |
|---|---|---|
| **Transition** (AI coach de triatlón; sprint a distancia completa) | Plan desde carrera, tiempo objetivo, **horas semanales y días preferidos**. Si fallas sesiones clave, **propone un plan ajustado que aceptas con un toque**. El **chat actúa**: mueve, intercambia, añade y quita sesiones, cambia ajustes, busca carreras. *Recovery Intelligence* por VFC, FC en reposo y sueño (abr-2026, necesita VFC nocturna de Garmin). Check-in post-entreno (jun-2026). **MCP** (abr-2026). **Sincronización con Apple y Google Calendar** (ago-2026). Pestaña *Fuel* con macros y comidas por foto. Tarjetas para compartir. | [App Store](https://apps.apple.com/us/app/-/id6670714598), [blog de Transition](https://www.transition.fun/blog/best-triathlon-training-apps-2026/) |
| **RestOrTrain** (30-sep-2026) | Chat que revisa sesiones, planifica y **cambia el calendario y empuja entrenos**. Si le dices "esta semana tengo menos tiempo", reajusta. Se integra con Garmin, Wahoo, COROS e **intervals.icu**. | [Endurance.biz](https://endurance.biz/2026/industry-news/new-restortrain-app-launches-as-conversational-ai-coaching-platform-for-endurance-sports/) |
| **Stride** | Trata natación, bici y carrera **como una sola carga** (la fatiga de un deporte afecta a los otros). Usa Whoop y Oura. La comparativa es suya, así que es parcial. | [stride.is](https://stride.is/docs/comparisons/best-ai-triathlon-training-apps/) |
| **AI Endurance** | Red neuronal entrenada con tus datos. Bici y carrera las planifica la IA; natación sale de una biblioteca. 20 $/mes. | [Transition (comparativa)](https://www.transition.fun/blog/best-triathlon-training-apps-2026/) |
| **Vyrve** (jun-2026) | Coach de triatlón con chat de ritmos y nutrición. Dice adaptarse a tu agenda real. [VERIFICAR] | [mwm.ai](https://mwm.ai/apps/vyrve/6782112491) |
| **Pacer** | Re-planifica la semana con lo que de verdad corriste y la recuperación. Lee datos de COROS. | [Product Hunt](https://www.producthunt.com/p/pacer-ai-running-coach/pacer) |
| **TIME2TRI Athlete** | Permite **vincular compañeros a una sesión** para que la vean y comenten. Es lo más parecido a una sesión compartida. | [Google Play](https://play.google.com/store/apps/details?id=me.time2tri.athlete&hl=en_US&gl=US) |
| **TrainingMeet / Train Pack / Pacers / Run with me** | Encontrar gente por deporte, ciudad, fecha o ritmo y unirse a sesiones publicadas. **Ninguna cruza tus agendas.** | [Train Pack](https://apps.apple.com/app/train-pack/id1633081087), [Pacers](https://apps.apple.com/app/pacers/id6754220008), [Run with me](https://www.producthunt.com/products/run-with-me), [TrainingMeet](https://play.google.com/store/apps/details?id=com.app.trai&hl=en_US) |
| **Howbout** (calendario social, no deportivo) | Sincroniza Google, Outlook y Apple. **Compartes el calendario entero o solo tu disponibilidad.** Ves en color cuándo están libres tus amigos. Encuestas de fecha **conectadas a la disponibilidad**, chat por plan, asistencia y recordatorios. | [Howbout](https://howbout.app/groups), [ayuda de Howbout](https://howbout.app/get-help/is-there-an-app-where-i-can-easily-see-when-my-friends-are-f/) |

**Lección de Howbout:** el modelo de privacidad "comparto libre/ocupado, no el detalle" y "la encuesta usa la disponibilidad" es exactamente lo que falta en las apps deportivas. Lo combinamos con el plan de entreno.

---

## 3. Tablas comparativas

### 3.1 Matriz de capacidades

Valores: **Sí**, **Parcial**, **No**, **?** (no documentado). "Hueco común" significa proponer una franja en la que dos atletas pueden entrenar juntos.

| Producto | Plan automático | Adapta a fallos | Readiness (VFC/sueño) | Captura de disponibilidad | IA de chat que actúa | Compartir con amigos | Hueco común | Widget iOS | Distancia completa |
|---|---|---|---|---|---|---|---|---|---|
| TrainingPeaks | No (entrenador o plan) | Manual | Muestra datos | No | No | Entrenador→atleta, .ics | No | Sí (inicio) | Sí (planes) |
| TriDot | Sí | Sí | Parcial | Sesiones por disciplina, días largos | "Assistant" (preguntas) | Parcial (amigos) | No | ? | Sí |
| MOTTIV | Sí (plantillas) | Parcial | ? | Control de h/semana | No | Feed | No | ? | Sí |
| HumanGO | Sí (IA) | Sí | Sí | Diaria en el alta | ? | Tribes, retos | No | ? | Sí |
| Athletica | Sí (IA) | Sí | Sí (VFC, FC en reposo) | h/semana y días | Sugiere, no actúa | No | No | ? | Sí |
| 2PEAK | Sí | Sí (automático) | ? | **Ventanas por día** | No | No | No | ? | Sí |
| TrainerRoad | Sí (bici con IA) | **Sí (anotaciones y simulación)** | RLGL por carga | Anotaciones de ausencia | No | No | No | ? | Parcial (natación y carrera por esfuerzo) |
| Intervals.icu | No | No (sí empareja) | Muestra | No | No (sí API y MCP de terceros) | Seguir y entrenar | No | ? | n/a |
| Final Surge | No (entrenador) | Manual | Premium: VFC | No | No | Equipo, muro | No | ? | Planes |
| JOIN | Sí (bici) | Sí | Pregunta subjetiva | **Minutos por día, editables cada día** | No | No | No | ? | n/a |
| Runna | Sí (algoritmo) | Sí (Not Feeling 100 %) | No | Días, sesiones y día largo | No | Vía Strava | No | ? | Solo carrera |
| Garmin Coach + DSW | Sí | Sí | **Sí (Readiness)** | Días y día largo | No (Connect+ sin chat) | No | No | Pocos | **No** (hasta media) |
| Strava | No (Runna) | n/a | No | No | No (sí MCP) | **Sí (clubes, eventos, chat)** | No (solo a posteriori) | Sí (objetivo semanal) | n/a |
| Wahoo SYSTM | Sí (plantillas) | No | No | **No (días fijos)** | No | No | No | ? | Sí (planes) |
| COROS | Planes de biblioteca | Parcial | Sí (EvoLab) | No | No (MCP de lectura) | Equipos | No | ? | ? |
| Polar | Sí (FitSpark/FP) | Sí | Sí | ? | No | No | No | ? | No |
| Transition | Sí (IA) | **Sí (un toque)** | Sí | h/semana y días preferidos | **Sí** | Tarjetas, referidos | No | ? | Sí |
| Howbout (no deportivo) | n/a | n/a | n/a | **Lee calendarios** | No | **Sí (libre/ocupado)** | **Sí (genérico)** | ? | n/a |

**Conclusión:** la columna "Hueco común" está vacía en todo el sector deportivo. "Captura de disponibilidad leyendo el calendario real" solo la tiene una app no deportiva.

### 3.2 Modelos de captura de disponibilidad

| Modelo | Quién | Ventajas | Inconvenientes | Uso en el MVP |
|---|---|---|---|---|
| Horas por semana (control) | MOTTIV, Athletica, Transition | Simple; muestra el impacto en el objetivo | No sabe *cuándo* | Sí, como **presupuesto semanal** |
| Días disponibles + nº de sesiones + día largo | Runna, Garmin Coach, TriDot | Habitual y entendible | Sin horas; mal con semanas irregulares | Sí, en el **alta** |
| Minutos por día, editables cada día | JOIN | Responde al momento | Hay que mantenerlo | Sí, como **edición rápida de hoy y mañana** |
| Ventanas horarias por día | 2PEAK | Permite encajar a una hora concreta | Configuración pesada | Sí, como **plantilla semanal de franjas** |
| Anotaciones de ausencia (vacaciones, enfermedad, lesión) | TrainerRoad | Explícito; lleva a adaptar el plan | Solo bloques completos | Sí, como tipos de **Imprevisto** |
| Ventana de "no estoy al 100 %" (3–14 días) | Runna | Cubre enfermedad, molestias y semanas caóticas | Solo hacia delante | Sí, como **Imprevisto con duración** |
| Leer libre/ocupado del calendario | Howbout | Sin trabajo extra; refleja clases y trabajo | Permisos; ruido de eventos que no bloquean | **Sí, diferenciador** (EventKit) |

**Recomendación.** La disponibilidad efectiva de cada usuario se calcula así:

> (plantilla de franjas) − (ocupado en el calendario de iOS) − (imprevistos) + (ajustes rápidos del día), acotado por el presupuesto de horas por semana.

### 3.3 Taxonomía de disparadores de adaptación observados

| Disparador | Ejemplos en el mercado | Respuesta típica |
|---|---|---|
| Sesión no hecha | 2PEAK, HumanGO, Athletica, Transition | Recolocar o redistribuir; un toque para aceptar (Transition) |
| Sesión distinta de lo planificado (más o menos) | TrainerRoad AI, JOIN | Recalcular fatiga y sesiones futuras |
| Actividad extra no planificada | JOIN (grupeta), TrainerRoad (salida al aire libre) | Sumar carga y suavizar los días siguientes |
| Readiness o VFC baja | Garmin, Athletica, Polar, Transition, RLGL | Cambiar intensidad por Z2 o descanso |
| Feedback subjetivo (RPE, sensación) | JOIN, Athletica, HumanGO, Transition | Ajustar dificultad futura |
| Ausencia, enfermedad o lesión | TrainerRoad (anotaciones), Runna (3–14 días), TriDot (más de 5 días, apagar disciplina) | Quitar, reducir o pausar; vuelta progresiva |
| Falta de tiempo | JOIN, Runna, RestOrTrain | Acortar manteniendo las sesiones clave |
| Calor | Runna (*Adapt for Heat*), TriDot (EnviroNorm) | Ajustar ritmos |
| Cambio de carreras | MOTTIV, HumanGO (A/B/C), TrainingPeaks ATP | Re-periodizar |

**Hueco detectado:** nadie trata como entrada de primera clase el **"otro deporte"** (pádel, fútbol, con su carga e impacto en piernas), el **estrés laboral o académico** ni la **"sesión conjunta con un amigo"** (que fija hora y tipo). Son justo los imprevistos que describen nuestros usuarios.

---

## 4. Síntesis

### 4.1 Patrones a copiar para el MVP

1. **Semana como unidad, con detalle solo a 1–2 semanas vista** (MOTTIV) y ventana de re-plan acotada (TrainerRoad: 4 semanas). El "plan" lejano es solo un esqueleto de fases y volumen.
2. **Sesiones clave frente a flexibles.** Al recortar se preservan las claves (tirada larga, rodaje largo de bici, calidad), como hace Runna con la tirada larga.
3. **Bloquear una sesión** (Athletica "lock today") y **restaurar el original** (TrainerRoad "restore").
4. **El re-plan es una propuesta, no un hecho consumado.** Se muestra la diferencia, se acepta con un toque (Transition) y la IA sugiere sin imponer (Athletica).
5. **Alternativas por sesión**: más corta, más fácil o en otro deporte (TrainerRoad *Workout Alternates*).
6. **Etiqueta de dificultad prevista** (Easy… Maximal) además de duración y zona (TrainerRoad).
7. **Botón de imprevisto con ventana y niveles de reducción**, más un aviso cuando termina (Runna).
8. **Readiness diaria mezclando objetivo y subjetivo:** VFC, sueño y FC en reposo de Garmin, más "agujetas/fatiga" (JOIN) y RPE post-sesión (Athletica, Transition).
9. **Cumplimiento con colores estándar** (TrainingPeaks) y emparejamiento automático entre plan y actividad (intervals.icu).
10. **Carga y PMC**: Fitness, Fatiga y Forma; carreras A/B/C; carrera principal con cuenta atrás (TrainingPeaks, Garmin).
11. **Permisos sociales explícitos y aceptados por el dueño** (intervals.icu: seguir o editar; Strava: quién te escribe; Howbout: libre/ocupado o detalle).
12. **Parte diario** (Garmin Morning Report y Connect+) y **pregunta de la tarde** (feedback).
13. **Widget "hoy + mañana"** con deep link a la tarjeta (TrainingPeaks).
14. **"Conecta tu IA" vía MCP** (Strava, COROS, Transition): la app es la fuente de verdad del calendario y la IA del usuario lee y escribe.

### 4.2 Huecos que nadie resuelve bien (nuestras oportunidades)

| # | Hueco | Qué hacen otros | Nuestra propuesta |
|---|---|---|---|
| G1 | **Encontrar un hueco para entrenar con un amigo** | Strava: detecta *después*; eventos de club manuales. Howbout: libre/ocupado sin deporte. TIME2TRI: vincular compañero a una sesión ya creada. | **"Huecos"**: cruza la disponibilidad efectiva de los dos con sus planes y propone *qué* sesión hacer juntos, *cuándo* y *dónde*. Un toque, invitación y bloqueo en ambos planes. |
| G2 | **Re-planificar tras sorpresas de la vida real** (pádel, fútbol, trabajo, estrés, molestias) | Anotaciones de bloques completos (TrainerRoad), ventana de 3–14 días (Runna), chat (Transition, RestOrTrain) | **"Imprevisto"** tipado (§4.3, M5) con carga estimada (sRPE o FC), zona corporal y duración; propuesta de cambios para la semana que **respeta las quedadas ya acordadas**. |
| G3 | **El calendario real (clases, trabajo) como entrada** | Athletica exporta sin horas; Transition exporta a Apple y Google; nadie lee el calendario | Leer el estado libre/ocupado de iOS (EventKit) y escribir las sesiones con hora. |
| G4 | **Distancia completa con Garmin, sin depender de una plataforma cara** | Garmin Coach llega solo a media distancia | Plan desde *tu* Claude con datos de Garmin; la app como calendario y coordinación. |
| G5 | **La IA del usuario como planificador** | Strava y COROS solo exponen lectura; Transition y RestOrTrain usan su propia IA | Nuestro MCP es **de lectura y escritura**: el Claude del usuario planifica y re-planifica dentro de la app. |
| G6 | **Planificar en pareja o grupo pequeño (2–6), no en club** | Strava apunta a clubes y eventos públicos; las apps de partners, a desconocidos | Círculo de amigos cercano, con un modo "pareja" optimizado para dos compañeros de piso. |
| G7 | **Que la semana no se rompa con la quedada** | Nadie modela restricciones compartidas | Una sesión conjunta es una **restricción fija** para el re-plan de ambos. Cambiarla exige renegociar, con aviso al otro. |

### 4.3 Lista priorizada de funciones del MVP

Prioridad: **M = Must, S = Should, C = Could, W = Won't (fuera del MVP).** Los criterios son orientativos para el backlog.

#### Must (sin esto no hay MVP)

| ID | Función | Criterio mínimo de aceptación |
|---|---|---|
| M1 | Cuenta y perfil del atleta | Login (Apple / email). Deportes activos. Umbrales básicos: FTP, ritmo umbral de carrera, CSS de natación y FC máx/umbral. Semana empezando en lunes. Unidades métricas. |
| M2 | **Carreras** con prioridad A/B/C y carrera principal | Crear carrera (nombre, fecha, distancia: sprint, estándar, media, completa, otra). Cuenta atrás en la pantalla Hoy. |
| M3 | **Calendario semanal** (vista principal) más vista día y mes compacta | 7 columnas o filas (lun–dom). Sesiones planificadas y completadas. **Fila de totales**: tiempo por deporte, carga, plan frente a real. |
| M4 | **Tarjeta de sesión** (planificada o completada) | Deporte, título, hora o franja, duración, distancia, zona o intensidad, dificultad prevista, carga estimada, estructura simple (calentamiento, bloques, vuelta a la calma), notas, marcas **clave** / **flexible** / **bloqueada**, compañeros. |
| M5 | **Disponibilidad efectiva** | Plantilla semanal de franjas. Lectura de **libre/ocupado del calendario de iOS** (calendarios elegidos por el usuario). Edición rápida de hoy y mañana. Presupuesto de h/semana. |
| M6 | **Imprevistos**: botón "Ha surgido algo" | Tipos: *otro deporte* (pádel, fútbol...), *sin tiempo* (trabajo, exámenes), *fatiga o sobrecarga*, *estrés*, *dolor o lesión* (zona y severidad 1–3), *enfermedad*, *viaje*. Cada uno con fecha o ventana (1–14 días). **Genera una propuesta de re-plan** y la muestra como diferencia. |
| M7 | **Propuesta de cambios (diff)** | Lista de cambios (movida, acortada, sustituida, eliminada, añadida) con antes y después. Aceptar todo, rechazar o activar uno a uno. Opción de deshacer o restaurar. Nunca toca sesiones bloqueadas ni quedadas sin avisar. |
| M8 | **Conectar "tu Claude"** (servidor MCP de la app, OAuth) | Herramientas de lectura: perfil, carreras, disponibilidad, plan, imprevistos, huecos con amigos. Herramientas de escritura: crear o actualizar el plan semanal, proponer re-plan. El usuario aprueba en la app. Ver §4.6. |
| M9 | **Datos de entreno completados** | Importar actividades hechas (ruta según el documento de integración: Apple Health, intervals.icu o Claude). Emparejamiento automático con la sesión planificada. |
| M10 | **Feedback post-sesión** | RPE 1–10, sensación de 5 niveles, nota y "¿dolor?" (zona). Se pide con una notificación al terminar o por la tarde. |
| M11 | **Cumplimiento** | Colores de TrainingPeaks (§4.4.3) en la tarjeta y en los totales. |
| M12 | **Amigos y permisos** | Invitar por enlace o código. Niveles por amigo: *libre/ocupado*, *ver plan*, *ver detalle y métricas*. Aceptación por el dueño. |
| M13 | **Vista "Nosotros"** (calendarios superpuestos) | Semana con mis sesiones y las del amigo en carriles, más los **huecos comunes** resaltados. |
| M14 | **Quedadas** (sesión conjunta) | Proponer desde un hueco o desde una sesión ("¿te apuntas?"). Invitación con aceptar, rechazar o proponer otra hora. Al aceptar: sesión vinculada en ambos calendarios, marcada como restricción fija. |
| M15 | **Notificaciones push** | Parte de la mañana (hora configurable). Invitación o respuesta de quedada. Propuesta de re-plan lista. Recordatorio de feedback. Recordatorio de quedada (1 h antes, configurable). Horas de silencio. |

#### Should (alto valor, en cuanto M esté estable)

| ID | Función | Nota |
|---|---|---|
| S1 | **Widgets iOS**: pequeño (hoy), mediano (hoy + mañana), pantalla de bloqueo rectangular (próxima sesión y compañero), en línea ("Hoy: Bici 2 h Z2 con Pablo") | Patrón de TrainingPeaks más pantalla de bloqueo; deep link a la tarjeta |
| S2 | **Readiness diaria** | VFC, sueño, FC en reposo y Body Battery (si llegan) + "agujetas/fatiga" 1–5; semáforo y regla base "si está en rojo, propón Z2 o descanso" |
| S3 | **PMC simplificado** | Fitness, Fatiga y Forma desde la carga diaria (TSS, hrTSS o sRPE) |
| S4 | **Escribir las sesiones en el calendario de iOS** | Con hora (a diferencia de Athletica), en un calendario propio de la app |
| S5 | **Alternativas de sesión** (más corta, más fácil, otro deporte) | Patrón de TrainerRoad |
| S6 | **Feed ligero** del círculo | "Pablo ha completado: Rodaje 1 h 30"; reacciones y comentarios; sin algoritmo |
| S7 | **Biblioteca y plantillas de semana** | Duplicar una semana o sesión |
| S8 | **Detección "entrenamos juntos" a posteriori** | Solapamiento de tiempo más del 50 % (y GPS si lo hay) para marcar la quedada como hecha (regla de Strava) |
| S9 | **Mensajes en la quedada** | Hilo por quedada (hora, lugar, "llego 5 min tarde") |

#### Could (si sobra tiempo)

| ID | Función |
|---|---|
| C1 | Live Activity / Dynamic Island: "Quedada en 25 min — Piscina municipal", y el día de carrera |
| C2 | Widgets interactivos (iOS 17+, App Intents): "Hecho" o "Mover a mañana" desde el widget |
| C3 | Empujar entrenos estructurados a Garmin (vía intervals.icu; la Training API está cerrada a altas nuevas) |
| C4 | Proyección de la carga futura (COROS) y simulación de la semana (TrainerRoad) |
| C5 | Nutrición: nota diaria u objetivo de carbohidratos en días clave (los usuarios ya se lo cuentan a Claude) |
| C6 | Grupos de más de 2 personas y quedadas abiertas a todo el círculo |
| C7 | Alertas de monotonía y tensión (Nolio) y de rampa de CTL excesiva |
| C8 | Plan de carrera básico (ritmos y nutrición por segmento) |

#### Won't (fuera del MVP, explícito)

- Motor propio de periodización con ML. El plan lo genera *tu* Claude o reglas simples.
- Marketplace de planes, pagos a entrenadores, Android, web completa y descubrimiento de desconocidos.
- Feed algorítmico, segmentos y clasificaciones.

### 4.4 Convenciones UX

#### 4.4.1 Calendario

- **Vista por defecto:** semana actual, lunes a domingo (convención en España). Hoy, resaltado.
- **Móvil:** lista vertical de días, cada uno con sus tarjetas, y la fila de totales fija arriba o abajo. Es más legible que siete columnas en 390 pt.
- **Fila de totales** (patrón de TrainingPeaks):
  - horas planificadas y hechas por deporte (iconos natación, bici y carrera);
  - carga total;
  - barra de cumplimiento;
  - presupuesto de h/semana.
- **Vista "Nosotros":** dos carriles (yo y el amigo) por día; los huecos comunes, como bandas sombreadas.
- **Horizonte:** detalle completo para la semana actual y la siguiente; más allá, solo esqueleto (fase, volumen y sesiones clave). Es el patrón de MOTTIV.
- **Interacciones:**
  - Toque: abre el detalle.
  - Pulsación larga: menú (mover, alternativa, saltar, bloquear, invitar a amigo).
  - Arrastrar y soltar entre días: dentro de la semana o ±1 semana (como Runna).
  - Aviso si se rompen reglas: dos sesiones duras seguidas, quitar la sesión clave, mover una quedada.
- **Formatos:**
  - Hora en 24 h.
  - Natación en min/100 m.
  - Carrera en min/km.
  - Bici en W y km/h.
  - Distancias en km (natación en m).
  - Fechas "lun 27 oct".

#### 4.4.2 Tarjeta de sesión

| Elemento | Convención |
|---|---|
| Deporte | **Icono y color de deporte** (franja lateral). Natación: azul. Bici: violeta. Carrera: turquesa. Fuerza: gris. Otros (pádel, fútbol): rosa o neutro. **No usar verde, amarillo, naranja ni rojo para deportes**: están reservados al cumplimiento. |
| Título y propósito | "Rodaje Z2 largo" + objetivo en una línea ("base aeróbica") |
| Métricas | Duración (principal), distancia, carga, **dificultad prevista** (Fácil, Moderada, Dura, Muy dura, Máxima) |
| Estructura | Mini-gráfico de bloques por zona (como TrainingPeaks o TrainerRoad) |
| Hora | Franja asignada ("18:30–20:00") o "flexible hoy" |
| Marcas | ★ clave · 🔒 bloqueada · 👥 quedada (avatares) · ↺ propuesta pendiente (borde discontinuo) |
| Estados | Planificada (contorno o relleno suave) · Completada (relleno sólido + punto o barra de cumplimiento) · Saltada (gris tachado + rojo) · No planificada (gris) · Propuesta (discontinua) |
| Completada | Plan frente a real (duración, distancia, carga), RPE y sensación, compañeros detectados |

#### 4.4.3 Cumplimiento (adoptamos el estándar de TrainingPeaks)

| Estado | Regla (métrica: carga, si no duración, si no distancia) | Color | Icono (accesibilidad) |
|---|---|---|---|
| Cumplida | 80–120 % del plan (±20 %) | Verde | ✓ |
| Desviada | 50–79 % o 121–150 % | Amarillo | ~ |
| Muy desviada | Menos del 50 % o más del 150 % | Naranja | ! |
| No hecha | Día pasado sin actividad emparejada | Rojo | ✕ |
| No planificada | Actividad sin sesión emparejada | Gris | + |

- Mostrar **color e icono** (no solo color), por el daltonismo.
- Intervals.icu usa la misma banda verde (80–120 %); es un estándar de facto.
- Una sesión **sustituida por un imprevisto aceptado** no cuenta como "no hecha". Pasa a "ajustada", en gris azulado, para no castigar al usuario por una decisión correcta.

#### 4.4.4 Propuesta de re-plan (diff)

```
Ha surgido: Pádel (mar 28, 19:00–20:30, RPE 7)  ->  propuesta para la semana
  − mié 29  Series carrera 6x1000   ->  Rodaje Z2 40'        (piernas cargadas tras pádel)
  ↔ jue 30  Bici umbral 1h15        ->  vie 31 (mismo)       (no dos días duros seguidos)
  = sáb 01  👥 Rodaje largo con Pablo  (sin cambios: quedada fija)
  [Aceptar todo]  [Revisar uno a uno]  [Descartar]
```

- Cada línea lleva un **motivo en una frase**. Las quedadas y las sesiones bloqueadas aparecen como "sin cambios".
- Tras aceptar: notificación al amigo **solo** si cambia algo compartido.

#### 4.4.5 Notificaciones (tipos, momento y frecuencia)

| Tipo | Momento | Ejemplo | Acciones |
|---|---|---|---|
| Parte de la mañana | Hora elegida (por defecto 07:30) | "Readiness 72 · Hoy: Natación 3 km (19:00) con Pablo" | Ver · Mover |
| Recordatorio de sesión | X min antes (opcional) | "Bici Z2 1 h 30 en 30 min" | Empezar · Posponer |
| Feedback | Al importar la actividad o a las 21:30 | "¿Qué tal la tirada? RPE / sensación" | RPE rápido |
| Invitación a quedada | En el momento | "Pablo propone: Rodaje largo sáb 9:00" | Aceptar · Otra hora · Rechazar |
| Re-plan listo | Tras un imprevisto o una sincronización | "Tu semana tiene 3 cambios propuestos" | Revisar |
| Fin de ventana de imprevisto | El día antes (patrón de Runna) | "Mañana termina tu ajuste por molestias. ¿Prorrogar?" | Prorrogar · Volver al plan |
| Social | Agrupado | "Pablo completó 2 sesiones hoy" | Ver |

- Reglas generales: **máximo unas 2 notificaciones no transaccionales al día**, horas de silencio y agrupación de las sociales.
- Las invitaciones y los cambios que afectan al otro son **siempre** inmediatos.

#### 4.4.6 Widgets iOS (familias de WidgetKit)

| Familia | Contenido | Toque |
|---|---|---|
| `systemSmall` | Sesión de hoy (icono, título, duración, hora, avatar del compañero) o "Descanso" | Tarjeta de hoy |
| `systemMedium` | Hoy + mañana (como TrainingPeaks) + Forma | Tarjeta concreta |
| `systemLarge` | Semana: 7 filas con punto de cumplimiento y quedadas | Calendario |
| `accessoryRectangular` (bloqueo) | Próxima sesión + hora + "con Pablo" | Tarjeta |
| `accessoryCircular` | % de la semana completada o días hasta la carrera A | Hoy |
| `accessoryInline` | "Hoy: Bici 2 h Z2 · 18:30" | Hoy |

- Desde iOS 17, botones interactivos ("Hecho", "Mañana").
- Live Activity para la quedada inminente y para la cuenta atrás el día de carrera (C1).
- Los datos se escriben en un App Group compartido y el widget se refresca cuando cambia el plan.

### 4.5 Algoritmo de "Huecos" y "Quedadas" (borrador para ingeniería)

**Entradas por atleta (A, B):**

1. Disponibilidad efectiva de la semana: franjas `[inicio, fin, ubicación?]`.
2. Plan: sesiones con `deporte`, `duración`, `intensidad/zona`, `flexibilidad` (fija, del día, de la semana), `clave` y `ubicación_tipo` (piscina, carretera, pista, rodillo).
3. Permisos entre A y B.

**Pasos:**

1. **Intersección de franjas.** Calcular `libre_A ∩ libre_B` por día, con un margen de traslado (por defecto 15 min) y una duración mínima igual a la sesión candidata más corta.
2. **Pares compatibles** (heurísticas del MVP; hay que ajustarlas con uso real):
   - Mismo deporte y ambas en Z1–Z2 o técnica: **muy compatible** (rodaje, natación técnica, bici larga).
   - Mismo deporte, una suave y otra de calidad: **compatible con un lugar común** (pista o piscina, cada uno su serie).
   - Mismo deporte y ambas de calidad: compatible si el nivel es parecido (diferencia de ritmo o potencia relativa por debajo de un umbral configurable).
   - Deportes distintos: "quedada de lugar" (ir juntos a la piscina o al gimnasio), con baja prioridad.
3. **Puntuación** = compatibilidad × encaje en la franja × (1 − coste de mover las sesiones) × preferencia (hora favorita, lugar). Penalizar si mover rompe reglas, como dos días duros seguidos o la sesión clave fuera de la ventana.
4. **Propuesta**: las 3 mejores, con un texto ("sáb 9:00–11:30 · Rodaje largo juntos · a Pablo le mueve la tirada de dom a sáb").
5. **Aceptación**: se crea `joint_session`, se vinculan las sesiones de A y B, se marcan como `restricción_fija`, se avisa al otro y se escribe en el calendario de iOS.
6. **Re-plan posterior**: cualquier re-plan (de la app o de Claude por MCP) recibe las quedadas como restricciones duras. Si un imprevisto obliga a romper una, se genera una **renegociación**: notificación al otro con alternativas.
7. **Después**: emparejar actividades con solapamiento de tiempo de más del 50 % (regla de Strava) y marcar la quedada como hecha.

**Privacidad.** Con el nivel *libre/ocupado* el otro solo ve bandas, nunca el título de tus eventos (modelo Howbout). Con *ver plan* ve tus sesiones. Con *detalle* ve además métricas y readiness.

### 4.6 "Conecta tu Claude" y datos de Garmin: lo que el mercado nos dice

**Lo que existe en 2026:**

- **Strava MCP**: remoto, OAuth, solo lectura, suscriptores; Claude es el primer cliente (1-jun-2026).
- **COROS MCP**: solo lectura; la escritura está anunciada para planes de IA y calendario (21-may-2026).
- **Transition**: soporte MCP (abr-2026).
- **Garmin: no hay MCP oficial.** Los conectores son de terceros: *Garmin Chat Connector*, `garmin_mcp`, que usa la API no oficial, y Tredict, que va por la API oficial. [Wareable](https://www.wareable.com/garmin/garmin-chat-connector-simplifies-your-watch-data-into-a-conversation), [hilo del foro de Garmin](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/437504/plea-add-an-official-mcp-interface-to-garmin)
- **Anthropic** no permite usar en apps de terceros los tokens OAuth de las suscripciones Free/Pro/Max. Para eso exige claves de API (Console o proveedor cloud). [Gigazine](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block), [AlternativeTo](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use)

**Implicaciones de diseño** (a detallar en el documento de integración):

1. **Ruta principal: nuestra app expone un servidor MCP remoto con OAuth**, con herramientas de lectura **y escritura**. El usuario lo añade como conector personalizado en claude.ai. Así, en la misma conversación en la que su Claude ya lee Garmin (y su calendario y comidas), le pide "planifícame la semana" o "hoy he jugado al pádel, reajusta". Claude escribe la propuesta en la app y el usuario la acepta en la app (diff, M7).
   - Coste de LLM para nosotros: cero.
   - Respeta el flujo que ya usan.
   - **Comprobar** que los conectores personalizados de claude.ai se pueden usar desde la app móvil de Claude con su plan. [VERIFICAR]
2. **Ruta secundaria** (opcional): un botón "re-planificar ahora" dentro de la app que llama a la API de Anthropic con **nuestra** clave (o una clave del usuario) desde una Edge Function de Supabase. Sirve para re-planes instantáneos sin salir de la app. Es un coste variable.
3. **Fallback sin IA:** reglas deterministas para imprevistos (por ejemplo, después de pádel o fútbol con RPE de 7 o más, nada intenso para piernas en las 24 h siguientes; con readiness en rojo, Z2 o descanso). Así la app funciona aunque Claude no esté conectado.

**Datos de Garmin:** la API oficial no admite altas nuevas desde la primavera de 2026. Opciones a evaluar en el documento de integración:

- (a) Que el Claude del usuario, con su conector Garmin, escriba en nuestra app un **resumen diario** (readiness, VFC, sueño, actividades) mediante una herramienta MCP. La app nunca toca Garmin.
- (b) **Apple HealthKit**: Garmin escribe entrenos, FC, sueño y pasos. La VFC y la FC en reposo probablemente **no**. [VERIFICAR, [the5krunner](https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/)]
- (c) **intervals.icu** como puente: clave de API del usuario; actividades y bienestar de Garmin; sube entrenos planificados a Garmin.
- (d) Librerías no oficiales: riesgo de términos de servicio y de roturas. **No recomendado** para un producto en la App Store.
- Además: las directrices de marca de Garmin (jul-2025) exigen **atribución** cuando se muestran sus datos. Hay que guardar el campo `source` en el modelo de datos. [Terra](https://tryterra.co/blog/garmin-connect-developer-program-pause)

### 4.7 Entidades de datos que se derivan de la investigación (orientativo)

| Entidad | Campos clave | Origen del patrón |
|---|---|---|
| `race` | fecha, distancia, prioridad A/B/C, es_principal | TrainingPeaks ATP, Garmin |
| `planned_session` | fecha, franja, deporte, duración, distancia, zona, carga_estimada, dificultad, estructura (JSON), clave, bloqueada, flexibilidad, origen (claude/regla/manual), joint_session_id | TrainingPeaks, TrainerRoad, Athletica |
| `completed_activity` | inicio, fin, deporte, duración, distancia, FC, potencia, carga, `source` (garmin/healthkit/intervals/manual), planned_session_id | intervals.icu (emparejamiento) |
| `session_feedback` | rpe 1–10, sensación 1–5, dolor (zona, 1–3), nota | Athletica, Final Surge, JOIN |
| `availability_template` | día de la semana, franjas [inicio, fin], ubicación | 2PEAK, JOIN |
| `calendar_busy` | inicio, fin (sin título si no se comparte) | Howbout |
| `life_event` (imprevisto) | tipo, inicio, fin, carga (sRPE o FC), zona corporal, severidad, nota | TrainerRoad, Runna |
| `readiness_daily` | fecha, vfc, sueño, fc_reposo, body_battery, subjetivo (agujetas, fatiga), semáforo, `source` | Garmin, JOIN |
| `replan_proposal` | disparador, cambios[] (antes, después, motivo), estado (pendiente, aceptada, rechazada), autor (claude/regla) | Transition, TrainerRoad |
| `friendship` | usuario_a, usuario_b, nivel (libre_ocupado / plan / detalle), estado | intervals.icu, Howbout |
| `joint_session` | sesiones vinculadas, lugar, estado (propuesta, aceptada, hecha, cancelada), hilo de mensajes | aporte propio, con Strava (Group Activities) |

Carga de deportes sin potencia ni ritmo, como pádel o fútbol: **sRPE = RPE (0–10) × minutos**, el método de Foster. Si hay FC de Garmin, se usa hrTSS o la carga del reloj y se prefiere la fuente objetiva.

### 4.8 Nombres para la app

**Restricciones de marca:**

- **IRONMAN**, **IRONMAN Triathlon**, **70.3**, **IRONKIDS** y el logo **M-Dot** son marcas de World Triathlon Corporation (The IRONMAN Group). Tiene decenas de registros en la USPTO y más de 130 en el extranjero (2009), y gana disputas de dominio como `ironmanbarcelona.com`. [Slowtwitch](https://slowtwitch.com/news/the-trademark/), [ADR Forum](https://www.adrforum.com/DomainDecisions/1256881.htm)
- **No usar** "Ironman", "Iron-" ni "70.3" en el nombre, el subtítulo, las palabras clave ni los iconos. En la interfaz se dice "distancia completa (3,8/180/42,2)" y "media distancia (1,9/90/21,1)".
- El directorio del repo se llama `ironman`: es uso interno y no pasa nada, pero **no debe llegar al bundle id, al nombre en la App Store ni al dominio**.
- Nombres ya usados por otros (descartar): **Transition**, **TriDot**, **TriBuddy**, **Tandem** (hay una app de intercambio de idiomas y otra "Tandem: Connect with Experts"), **Peloton**, **Duo**.

**Candidatos** (de mayor a menor recomendación). **Ninguno está verificado en la App Store ni en EUIPO/OEPM**; hay que comprobarlos antes de decidir.

| Nombre | Idea | Ventajas | Inconvenientes |
|---|---|---|---|
| **Rebufo** | Ir a rebufo: entrenar a la estela de un amigo | Único, con significado, muy de ciclismo y triatlón; liga con lo social | Poco intuitivo fuera de España y Latinoamérica |
| **Quedada** | La palabra española para quedar a entrenar | Describe la función estrella | Palabra común, difícil de registrar como marca; mejor como **nombre de función** |
| **Relevo** | Relevos de triatlón; pasarse el testigo | Evoca equipo de 2–3 personas | Menos ligado a planificar |
| **A Rueda** | "Ir a rueda" (chupar rueda) | Desenfadado y ciclista | Puede sonar a "aprovechado"; dos palabras |
| **Cuadra** | De "cuadrar la semana" | Nombra el problema (cuadrar agendas) | Ambiguo (cuadra de caballos) |
| **Hueco** | "¿Tienes hueco?" | Habla directamente de disponibilidad | Connotación de vacío; mejor como función |
| **Compi** | Compañero de entreno o de piso | Cercano; refleja el origen del proyecto | Genérico y probablemente ocupado |
| **Brick** | Sesión *brick* (bici + carrera) | Jerga de triatlón conocida | Muy genérico, en inglés, probablemente ocupado |

**Recomendación:** marca **Rebufo** (subtítulo en la App Store de hasta 30 caracteres, por ejemplo "Planifica y entrena con amigos"), con funciones **Quedadas** (sesiones conjuntas), **Huecos** (franjas comunes) e **Imprevistos** (re-plan). Alternativa: **Relevo**.

---

## 5. Riesgos y notas de vigencia

| Tema | Riesgo | Acción |
|---|---|---|
| Garmin Developer Program en pausa | No hay API oficial para apps nuevas (salud, actividad, envío de entrenos) | Diseñar sin depender de ella; vigilar developer.garmin.com |
| Garmin dueño de TrainingPeaks | Cambios en integraciones de terceros con TrainingPeaks | No depender de la API de TrainingPeaks |
| Política de Anthropic (OAuth) | No hay "Login con Claude" para usar la suscripción | MCP de la app (el usuario conecta su Claude) o clave de API propia |
| MCP en móvil | Disponibilidad de conectores personalizados en la app iOS de Claude según el plan | [VERIFICAR] antes de comprometer el flujo |
| Datos de VFC y FC en reposo en HealthKit | Garmin puede no escribirlos | [VERIFICAR] en un iPhone real con Garmin Connect |
| Wahoo SYSTM, COROS Training Hub, RLGL de TrainerRoad | Fuentes de 2021–2024 | Marcados [ANTIGUO]; no son decisivos |
| "Athletes for You" de Strava | No se ha encontrado documentación | [VERIFICAR] si importa |
| Umbrales de cumplimiento | TrainingPeaks e intervals.icu difieren en amarillo y naranja | Adoptar TrainingPeaks; documentarlo en la ayuda |
| Afirmaciones de IA de los proveedores | La mayoría viene de páginas de producto o fichas de App Store | No copiar promesas; validar con uso real |

---

## 6. Fuentes (agrupadas)

**TrainingPeaks**
- [Novedades de TrainingPeaks](https://www.trainingpeaks.com/learn/articles/trainingpeaks-feature-updates)
- [Athlete Home](https://www.trainingpeaks.com/blog/trainingpeaks-athlete-home/)
- [Cumplimiento (ayuda)](https://help.trainingpeaks.com/hc/en-us/articles/204861204)
- [Widget iOS](https://help.trainingpeaks.com/hc/en-us/articles/32841877166477-TrainingPeaks-iOS-Widget)
- [Guía del ATP](https://www.trainingpeaks.com/learn/articles/the-comprehensive-guide-to-creating-an-annual-training-plan/)
- [Metodologías del ATP](https://help.trainingpeaks.com/hc/en-us/articles/224662768-Annual-Training-Plan-Methodologies)
- [PMC (myprocoach)](https://support.myprocoach.net/hc/en-us/articles/360040589772)
- [TSS por deporte](https://help.trainingpeaks.com/hc/en-us/articles/204071944)
- [Relaciones entrenador-atleta](https://help.trainingpeaks.com/hc/en-us/articles/204072384-Functionality-of-the-Different-Coach-Athlete-Relationships)
- [Exportar .ics](https://help.trainingpeaks.com/hc/en-us/articles/204072184)
- [Notificaciones en la app móvil](https://help.trainingpeaks.com/hc/en-us/articles/360053198451-Manage-Alerts-Notifications-on-the-TrainingPeaks-Mobile-App)
- [Garmin compra TrainingPeaks (nota de prensa)](https://www.garmin.com/en-US/newsroom/press-release/corporate/garmin-acquires-trainingpeaks-and-trainheroic-leading-endurance-and-strength-training-platforms-for-athletes-and-coaches/)
- [Cyclingnews](https://www.cyclingnews.com/cycling-tech-components/garmin-aqcuires-training-platforms-trainingpeaks-and-trainheroic/)

**TriDot**
- [App Store](https://apps.apple.com/us/app/tridot-triathlon-training/id6754208848)
- [Enfermedad o lesión](https://support.tridot.com/hc/en-us/articles/5632284661133-Does-my-schedule-adjust-if-I-m-sick-or-injured)
- [Preferencias](https://tridot.com/resource-library/updating-your-preferences)
- [Precios](https://www.tridot.com/pricing)

**MOTTIV**
- [Por qué MOTTIV](https://mymottiv.com/why-mottiv)
- [Añadir o quitar entrenos](https://mymottiv.com/help-center-articles/add-or-subtract-workouts)
- [Detalle de entrenos a meses vista](https://mymottiv.com/help-center-articles/how-can-i-see-all-of-my-workout-details-over-the-next-few-months)

**HumanGO**
- [App Store](https://apps.apple.com/app/id1554430755)
- [Challenge Family](https://challengefamily.com/news/one-season-one-plan-how-humango-is-ending-the-spreadsheet-struggle-for-challenge-family-athletes/)

**Athletica**
- [Triatlón](https://athletica.ai/sports/triathlon)
- [Programación personalizada](https://support.athletica.ai/hc/en-us/articles/34808431659931-How-to-Use-the-Custom-Scheduling-Settings-in-Athletica)
- [Foro: ajustes](https://forum.athletica.ai/t/customize-your-training-with-updated-athletica-settings/3334)

**2PEAK**
- [Blog](https://blog.2peak.com/?p=7682)
- [App Store](https://apps.apple.com/app/id1053397362)

**TrainerRoad**
- [Introducing TrainerRoad AI](https://www.trainerroad.com/blog/introducing-trainerroad-ai/)
- [Ventana de simulación](https://support.trainerroad.com/hc/en-us/articles/41652509070619-AI-Simulation-Window)
- [Ver 4 semanas por delante](https://www.trainerroad.com/blog/see-4-weeks-ahead-training-with-trainerroad-ais-new-training-simulation/)
- [Anotaciones de calendario](https://support.trainerroad.com/hc/en-us/articles/4404676155035-Calendar-Annotations)
- [Red Light Green Light](https://www.trainerroad.com/forum/t/red-light-green-light-is-now-available-to-all-trainerroad-athletes/91907)
- [TrainNow](https://support.trainerroad.com/hc/en-us/articles/360057075531-TrainNow-Overview)
- [Plan Builder](https://www.trainerroad.com/blog/introducing-plan-builder/)

**Intervals.icu**
- [Inicio](https://intervals.icu)
- [Integraciones](https://www.intervals.icu/integrations/)
- [Atletas](https://www.intervals.icu/features/athletes/)
- [Foro: cumplimiento](https://forum.intervals.icu/t/more-prominent-colour-for-completed-workouts-traffic-light-compliance-indicator/84)
- [Foro: API](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)
- [Foro: coaching](https://forum.intervals.icu/t/q-how-do-i-use-the-coaching-feature-on-intervals-icu/41038)

**Final Surge**
- [App Store](https://apps.apple.com/us/app/-/id929796646)
- [Web](https://finalsurge.com/)

**JOIN**
- [Cómo funciona JOIN](https://join.cc/how-join-works/)
- [Foro de TrainerRoad](https://www.trainerroad.com/forum/t/join-cycling-app/62908)

**Runna**
- [Ajustar tu calendario de carrera](https://support.runna.com/en/articles/6206024-adjusting-your-running-schedule)
- [Calendario de entreno](https://support.runna.com/en/articles/10137793-how-to-use-and-manage-your-training-calendar)
- [Not Feeling 100%](https://support.runna.com/en/articles/13531498-how-to-use-not-feeling-100)
- [Tom's Guide](https://www.tomsguide.com/wellness/fitness/im-deep-into-marathon-training-fighting-the-flu-and-runnas-new-not-feeling-100-percent-tool-couldnt-be-more-timely)
- [the5krunner: ¿Runna es IA?](https://the5krunner.com/2026/09/28/is-runna-ai/)
- [Endurance.biz](https://endurance.biz/2026/industry-news/runna-updates-beginner-and-return-to-running-training-plans/)

**Garmin**
- [Garmin y el triatlón (blog)](https://www.garmin.com/en-GB/blog/?p=11178)
- [Calendario de carreras (manual)](https://www8.garmin.com/manuals/webhelp/GUID-708A8F4D-9A78-49CF-9528-DE109BBCC472/EN-US/GUID-8186A9FE-DFC1-4DC3-89B2-221883A60B6A.html)
- [Fleet Feet: sugerencias diarias](https://www.fleetfeet.com/blog/how-to-use-garmin-daily-suggested-workouts)
- [T3: sugerencias diarias](https://www.t3.com/features/how-do-garmin-daily-workout-suggestions-work)
- [the5krunner: Morning Report](https://the5krunner.com/2022/06/28/garmin-morning-report/)
- [Evening Report](https://gadgetsandwearables.com/2025/05/18/garmin-evening-report/)
- [the5krunner: Connect+](https://the5krunner.com/2026/04/20/garmin-connect-plus-review/)
- [BikeRadar: Connect+](https://bikeradar.com/news/garmin-connect-plus)
- [Foro de Garmin: Run Coach](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/444196/garmin-run-coach---days-available-and-long-run-days-keeps-getting-reset-to-every-day-weekends)
- [the5krunner: pausa de la API](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/)
- [Terra: pausa del GCDP](https://tryterra.co/blog/garmin-connect-developer-program-pause)
- [Garmin Health API](https://developer.garmin.com/gc-developer-program/health-api/)

**Strava**
- [Group Activities](https://support.strava.com/hc/en-us/articles/216919497-Group-Activities)
- [Conector MCP](https://support.strava.com/hc/en-us/articles/46190267796237-Strava-MCP-Connector)
- [Let's Data Science: MCP](https://letsdatascience.com/news/strava-launches-mcp-connector-for-claude-integration-909e07a0)
- [9to5Mac: Events](https://9to5mac.com/2026/07/09/strava-gets-an-events-tab-with-upcoming-races-group-runs-more/)
- [Endurance.biz: eventos y clubes](https://endurance.biz/2026/industry-news/strava-introduces-race-and-club-event-discovery-features/)
- [IndoTelko](https://www.indotelko.com/read/1784589282/strava-tambah-fitur-ai-claude-dan-club-messaging)
- [BikeRadar: mensajería](https://www.bikeradar.com/news/you-can-finally-send-direct-and-group-messages-on-strava)
- [3bikes: Instant Workouts](https://www.3bikes.fr/en/2026/01/09/strava-launches-instant-workouts-personalized-training-recommendations-directly-in-your-feed/)
- [Tom's Guide: widget](https://www.tomsguide.com/wellness/fitness/this-easy-strava-trick-means-i-never-miss-a-run-how-to-add-the-strava-widget-to-your-iphone-homescreen)
- [Bicycle Retailer: eventos de club (2017)](https://bicycleretailer.com/product-tech/2017/04/18/strava-adds-club-feature-enable-group-bike-ride-planning)

**Wahoo SYSTM**
- [Slowtwitch (2022)](https://slowtwitch.com/training/wahoo-systm-long-term-review/)
- [Qué es SYSTM](https://www.wahoofitness.com/blog/?p=9228)
- [Foro: peticiones](https://wahoox.forum.wahoofitness.com/c/systm-software/feature-requests/11)

**COROS**
- [Training Hub](https://coros.com/stories/coros-metrics/c/welcome-to-the-training-hub)
- [Manual del Training Hub](https://support.coros.com/hc/en-us/articles/4412176269844-COROS-Training-Hub-Manual)
- [Android Authority: MCP](https://www.androidauthority.com/coros-launches-mcp-3669570/)

**Polar**
- [Fitness Program (nota de prensa)](https://polar.com/en/media-room/polar-introduces-fitness-program)
- [Planes de Polar](https://www.polar.com/us-en/guide/polar-training-plans)
- [FitSpark](https://support.polar.com/de/fitspark-daily-training-guide)

**Nolio**
- [App Store](https://apps.apple.com/app/nolio/id1615773607)
- [G2](https://www.g2.com/sellers/nolio)
- [Stadion](https://stadion-actu.fr/nolio-lapplication-pour-le-suivi-de-lentrainement-sassocie-a-la-ffa/)

**Nuevos entrantes y comparativas**
- [Transition: mejores apps 2026](https://www.transition.fun/blog/best-triathlon-training-apps-2026/)
- [Transition (App Store)](https://apps.apple.com/us/app/-/id6670714598)
- [Endurance.biz: RestOrTrain](https://endurance.biz/2026/industry-news/new-restortrain-app-launches-as-conversational-ai-coaching-platform-for-endurance-sports/)
- [Stride](https://stride.is/docs/comparisons/best-ai-triathlon-training-apps/)
- [The Triathlete: mejores apps de IA](https://thetriathlete.co.uk/best-ai-triathlon-training-apps-in-2026/)
- [Vyrve](https://mwm.ai/apps/vyrve/6782112491)
- [Pacer](https://www.producthunt.com/p/pacer-ai-running-coach/pacer)

**Apps sociales y de calendario**
- [Howbout](https://howbout.app/groups)
- [Howbout: ayuda](https://howbout.app/get-help/is-there-an-app-where-i-can-easily-see-when-my-friends-are-f/)
- [TIME2TRI](https://play.google.com/store/apps/details?id=me.time2tri.athlete&hl=en_US&gl=US)
- [Train Pack](https://apps.apple.com/app/train-pack/id1633081087)
- [Pacers](https://apps.apple.com/app/pacers/id6754220008)
- [Run with me](https://www.producthunt.com/products/run-with-me)
- [TrainingMeet](https://play.google.com/store/apps/details?id=com.app.trai&hl=en_US)

**IA e integraciones**
- [Gigazine](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block)
- [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [AlternativeTo](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use)
- [Wareable: Garmin Chat Connector](https://www.wareable.com/garmin/garmin-chat-connector-simplifies-your-watch-data-into-a-conversation)
- [Foro de Garmin: petición de MCP](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/437504/plea-add-an-official-mcp-interface-to-garmin)
- [the5krunner: Garmin y Health Connect](https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/)

**Marcas**
- [Slowtwitch: la marca](https://slowtwitch.com/news/the-trademark/)
- [ADR Forum (UDRP)](https://www.adrforum.com/DomainDecisions/1256881.htm)
