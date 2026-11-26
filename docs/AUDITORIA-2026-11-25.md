# Auditoría de Road to Ironman · 25 de noviembre de 2026

Autor: Claude Code, a petición de David. Base: `main` en `9b9429d`. Rama con los cambios: `david/auditoria-y-mejoras` (11 commits, sin subir).

Método: lectura completa de la memoria y los documentos de contrato. Cuatro revisiones en paralelo: motor y coach, interfaz, backend y seguridad, y comparación con `camino-703` (la app propia de David). Ejecución de todas las suites y recorrido de la demo web en tamaño móvil.

## 1. En qué punto está

Es un producto maduro, no un prototipo. Tiene unas 92.000 líneas de TypeScript, 34 pantallas, 25 migraciones SQL y 10 herramientas MCP. Lo completan un coach con IA gratuita en Cloudflare, un coach de reglas sin conexión, Garmin, COROS, Apple Salud, widgets, calendario, una parte social y automatización de App Store. La 1.0.0 está en revisión de Apple (rechazo de la build 19 contestado; falta el vídeo con el reloj).

Estado de las pruebas al empezar: todo en verde.

| Suite | Al empezar | Al terminar |
| --- | --- | --- |
| Tipos (TypeScript) | sin errores | sin errores |
| Jest (app) | 2.058 | 2.109 |
| Base de datos (PGlite) | 164 | 164 |
| Edge Functions | 261 | 263 |
| Worker de IA | 30 | 30 |

## 2. Lo bueno

- **Arquitectura limpia.** El dominio es TypeScript puro y está muy probado. El repositorio es intercambiable (demo / Supabase). La interfaz usa primitivas de `src/ui` y los hooks de `queries.ts`. La documentación sirve de contrato.
- **Ciencia del deporte seria.** Hay PMC (forma, fatiga, frescura) y un semáforo de disposición con VFC en logaritmo y línea base de 30 días. La periodización cuenta hacia atrás desde la carrera A, con 3:1/2:1 y afinamiento por distancia. La prescripción da ppm, ritmo y vatios por paso, y hay plan B y revisión posterior.
- **Backend endurecido.** RLS en todas las tablas y `search_path` vacío en todas las funciones `SECURITY DEFINER`. Los tokens se guardan solo como hash y la clave de Garmin va cifrada por usuario. La IA tiene cupos diarios atómicos y consentimiento. No hay secretos en el repositorio.
- **Cuidado del detalle.** Accesibilidad trabajada, textos en español de España, tema claro y oscuro, y el rediseño "tranquilo por defecto" con pliegues.

## 3. Lo malo y lo que se ha corregido

### Bugs del motor (corregidos, con tests que fallan con el código anterior)

1. **La fase cambiaba según el día de la semana.** El lunes después de una carrera A salía "transición" y el jueves, "preparación". El planificador usa el lunes, mientras que Hoy, el informe y el replanificador usan el día exacto. Ahora todo se evalúa desde el lunes (`periodization.ts`).
2. **El ciclo de mantenimiento se rompía en Año Nuevo.** 2026 tiene 53 semanas ISO: salían 4 semanas de carga seguidas o dos descargas pegadas, empezando dentro de 5 semanas. Ahora usa un índice de semana continuo que coincide con el actual en 2026, así que nadie ve moverse su descarga.
3. **El tope de rampa casi no limitaba.** Tras cuatro semanas de 300' permitía unos 600'. Ahora además limita el volumen a un +15 % sobre la mayor de las tres últimas semanas (+10 % principiante, +5 % con estrés), que es lo que ya decía el prompt del coach. *Actualización del 26-11:* David lo suavizó a +20 % como máximo (+15 % principiante, +10 % con estrés), también en el prompt del coach.
4. **Informe con datos caducados.** Una fatiga 5/5 de hace cinco días seguía poniendo el informe en rojo. Ahora solo cuentan los datos de hoy y de ayer, y los de ayer van marcados.
5. **La disposición daba "sin datos" si el reloj aún no había sincronizado.** Ahora usa las métricas de ayer y lo dice. El sueño de ayer no se lee como el de anoche.

### Seguridad y fiabilidad (corregidos)

- **Inyección desde texto de amigos.** El título de un entreno de un amigo entraba en el prompt y podía acabar como "memoria" permanente del coach o como imprevisto. Ahora, si la petición lleva datos de amigos, el coach no escribe ninguna de las dos cosas. Las instrucciones MCP también marcan ese texto como datos.
- **Zona horaria fija en Madrid.** Nada actualizaba `profiles.timezone`, así que en Canarias o de viaje el "hoy" del servidor no coincidía con el de la app. Ahora se sincroniza con la del teléfono.
- **La integración continua no probaba la base de datos ni las funciones.** Nuevo `.github/workflows/checks.yml`: `test:all` y el worker en cada PR hacia `main`, en Linux y sin generar builds.
- **Ráfagas de recargas en tiempo real.** Una sincronización de Garmin con N entrenos invalidaba N veces. Ahora los avisos se agrupan durante 300 ms.
- Índice nuevo `friendships(requester_id)`.

### Fricción y peso de la información (corregidos)

| Tarea | Antes | Ahora |
| --- | --- | --- |
| Check-in diario | 8 toques, cinco filas obligatorias | 3 toques: "Todo normal" o "Como ayer"; la calidad del sueño sale de la nota del reloj |
| Marcar una sesión hecha con datos útiles | elegir RPE a mano | "Tal como estaba previsto" rellena duración, distancia y RPE |
| Pedir un cambio al coach | ejemplos fijos que solo rellenan el texto | ejemplos sacados de hoy y mañana que se envían con un toque; el motor de reglas los entiende |
| Añadir la primera carrera | 7 campos, nombre obligatorio, prioridad B | nombre opcional ("Olímpico de marzo"), prioridad A en la primera, detalles plegados |
| Informe hablado | mínimo 110 palabras y relleno genérico; leía la VFC y el pulso aunque fueran normales | tope de 180, sin relleno; la VFC y la batería solo se leen si se salen de lo normal |
| Progreso | pliegues cerrados con texto fijo | cada pliegue muestra su cifra: "Forma 69 · frescura +5", "VFC 66 ms · Sueño 7,2 h"… |
| Nutrición de una sesión | "30-60 g/h" genérico | "2 geles de 25 g: min 20 y 60. Bebe alrededor de 0,6 l" |
| Tras un imprevisto | "Reorganizar (reglas)" / "Pedir al coach IA" | "Reorganizar mi semana" / "Hablarlo con el coach" |

Accesibilidad: el selector segmentado llega a 44 pt, las puntuaciones de 1 a 5 son un grupo de opciones y los botones de los contadores dicen de qué campo son.

## 4. Comparación con camino-703

`camino-703` es un sistema para un solo atleta: Garmin → SQLite → métricas segundo a segundo del FIT → informe diario escrito por Claude → web con el plan escrito a mano. Road to Ironman es mucho más amplio (multiusuario, social, plan automático, App Store). Aun así, `camino-703` hacía mejor varias cosas, y se han portado las que encajan con los datos que ya tiene esta app:

| Idea de camino-703 | Estado en Road to Ironman |
| --- | --- |
| Comparar cada sesión con las parecidas | **Portado** (`domain/similarSessions.ts`): "Eficiencia un 6 % mejor que la media de tus 8 carreras parecidas", sin pedir nada al usuario |
| Ratio de carga aguda/crónica y monotonía | **Portado** (`loadBalance` en `domain/load.ts`): Progreso solo avisa cuando hay un salto o una semana sin día suave |
| Tomas con minuto exacto | **Portado** (`fuelingSchedule` en `domain/fueling.ts`) |
| Exportar a Zwift (.zwo) | **Portado** (`domain/zwo.ts` + "Exportar a Zwift" en las sesiones de bici) |
| Informe corto con cifras y referencias | **Parcial**: el informe ahora va por excepción |
| Métricas del FIT (NP, IF, desacople, deriva de pulso, curva de potencia) | **Pendiente**: hace falta que la función `garmin` descargue el FIT o las muestras y ampliar `CompletedData` |
| FTP calculada de un test de rampa → zonas automáticas | **Pendiente**: depende de lo anterior (hacen falta las potencias) |
| Señales de enfermedad (respiración y FC nocturnas) | **Pendiente**: añadir `sleepRespiration` y `sleepAvgHr` a `DailyMetrics` |
| Aviso 15 minutos después de despertar | **Pendiente**: requiere el cron del backend |

## 5. Pendiente, por prioridad

Cosas que necesitan decisión del dueño o un despliegue:

1. **Contraseña de la cuenta de revisión** (`revision@roadtoironman.app`). Es un prefijo público más 6 dígitos: 10⁶ combinaciones contra una cuenta real. Rotarla tras la aprobación o desactivarla fuera de revisión.
2. **Desplegar** la migración `20261125000100_friendships_requester_idx.sql` y las funciones `coach`, `briefing` y `mcp`, porque los cambios de servidor no actúan hasta desplegarlos.
3. **Ruta de pago silenciosa.** Si falta el worker y existe `ANTHROPIC_API_KEY`, se usa Claude sin tope global de coste (`_shared/ai/provider.ts`). Va contra la regla "nunca coste sin preguntar".
4. **Notificaciones push que se pueden perder.** `pushed_at` se marca antes de enviar y no hay reintento (`_shared/platform/service-stores.ts`).
5. **`sync_all` de Garmin** procesa como mucho 200 usuarios sin orden. Con muchos usuarios, los últimos de la lista no se sincronizan nunca.
6. **Sin cola sin conexión.** Un check-in o una sesión completada sin red se pierde si el usuario no reintenta.

Cosas del motor que conviene hacer después:

- El plan de "supervivencia" se decide por la fecha de alta de la carrera, no por la forma real: un avanzado que añade una distancia completa a 16 semanas recibe 14 semanas de base y ninguna de construcción (`periodization.anchoredWeeks`). Habría que pasar `recentWeeklyMinutes` a `allocate`.
- Hay dos semáforos de disposición distintos, el de la app (`readiness.ts`) y el del servidor (`wellness.ts`), que pueden discrepar el mismo día. Conviene unificarlos.
- Las revisiones no cierran el ciclo: tres rodajes suaves seguidos "más duros de lo previsto" no ajustan ni zonas ni plan. Falta un `reviewTrend` que sugiera recalibrar.
- `RUN_WEEKLY_MINUTES_GROWTH` está definido y no lo usa nadie: no hay tope específico de impacto en carrera.
- El imprevisto sigue empezando en "pádel" por defecto; debería empezar sin tipo elegido.
- No hay ESLint configurado (`npm run lint` no funciona).

## 6. Ideas nuevas

- **Check-in sin check-in.** Con datos del reloj, proponer la disposición directamente y pedir el check-in solo si algo se sale de lo normal.
- **Umbrales que se actualizan solos.** De 6 a 8 semanas de carreras de 20-60' con FC alta, proponer ritmo umbral, CSS y FC máxima observada con un toque ("Tu umbral parece haber bajado a 4:32/km, ¿lo actualizo?").
- **Desacople en las tiradas largas.** Cuando llegue el FIT, "tu pulso subió un 7 % en la segunda mitad" es la mejor medida de fondo aeróbico para un 70.3.
- **Plan de carrera por segmentos.** Para la carrera A: vatios por tramo, ritmo de la carrera a pie, tomas por minuto y transiciones, generado a partir de umbrales y de los entrenos de ritmo de carrera.
- **Predicción de tiempo** por segmento a partir de las sesiones de control (umbral, CSS, FTP), con un rango y no una cifra cerrada.
- **Repetir quedada** con el mismo grupo la semana siguiente (ya está en las ideas de experiencia; es barata de construir).
