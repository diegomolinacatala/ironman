# Métricas por actividad desde el FIT de Garmin

**Autor:** Claude Code, para David · 28-11-2026 · rama `feat/metricas-fit` (sale de `david/auditoria-y-mejoras`).

**Objetivo.** Llevar a Road to Ironman las métricas que calcula camino-703 (`C:\proyectos\deporte\garmin\fitmetrics.py`) a partir de los ficheros FIT: potencia normalizada, IF, desacople aeróbico, deriva del pulso y curva de potencia. Hasta ahora la app solo tenía el resumen de cada actividad.

## Qué permite cada fuente

| Fuente | Datos segundo a segundo | Veredicto |
| --- | --- | --- |
| Garmin Personal API | Sí. `GET /download-service/files/activity/{id}` devuelve un ZIP con el `.fit` original. camino-703 lo usa a diario (`gapi.py › download_fit`, 158 FIT descargados). Garmin quita campos no documentados (VO2max, recuperación), pero los `record` (FC, potencia, velocidad, distancia) llegan completos. | **Hecho en esta rama.** |
| Apple Salud | Sí, en el teléfono: muestras de FC del entreno (`HKQuantitySeriesSample`) y potencia de ciclismo y carrera (iOS 17+). Habría que leerlas en `src/integrations/health` y calcular en el dispositivo o subirlas. | Viable. Proyecto aparte (módulo nativo y permisos nuevos). |
| COROS | No. Solo llega el resumen, vía Apple Salud o el conector oficial de COROS en el Claude del deportista. La API con FIT de COROS es para socios. | Sin datos segundo a segundo. Un COROS que escribe en Salud entraría por la fila anterior. |

## Cambios

- `supabase/functions/_shared/garmin/fit.ts`: lector FIT propio, sin dependencias, porque `_shared` también corre en `node --test`. Lee cabecera, definiciones, mensajes de datos, cabeceras de tiempo comprimidas y campos de desarrollador, que se saltan. También abre el ZIP de Garmin (directorio central, deflate con `DecompressionStream`).
- `garmin/streamMetrics.ts`: fórmulas portadas de camino-703. NP (media móvil de 30 s, potencia cuarta), IF = NP/FTP, mejores 1, 5, 20 y 60 min, desacople (salida por latido, primera mitad frente a segunda, tras 10 min de calentamiento, solo en movimiento) y deriva de FC en ppm. Única diferencia: remuestrea a 1 Hz (el «smart recording» graba cada 1–5 s y una pausa de más de 5 s cuenta una vez). Comprobado con los FIT reales de David: NP 189 W y desacople 9,8 % frente a 189 W y 9,9 % de camino-703. En carrera, 5,9 % y 0,7 ppm iguales.
- `garmin/analysis.ts`: tras cada sincronización, toma las sesiones de bici y carrera de Garmin de 20 min o más que no tengan `analyzedAt`, las más recientes primero y como mucho 4 por sincronización. Descarga el FIT, calcula y guarda con `saveActivityAnalysis`, que fusiona en `completed` solo si sigue enlazada a esa actividad. Si el fichero no existe (404) o no se puede leer, se marca y no se vuelve a descargar. Si Garmin falla, se reintenta en la siguiente. No conserva el FIT, solo los números.
- `CompletedData` (app y servidor): `normalizedPowerW`, `intensityFactor`, `bestPower5MinW`, `bestPower60MinW`, `decouplingPct`, `hrDriftBpm`, `analyzedAt`. `completed` es `jsonb`, así que **no hace falta migración**. `parseCompleted` lee los campos nuevos.
- Ficha del entreno (`CompletedPanel` + `src/domain/activityInsights.ts`): una o dos frases en gris bajo la tabla Plan/Hecho. Ejemplos: «En la segunda mitad tu pulso subió 8 ppm y rendiste un 6 % menos por latido…», «Pulso estable en la segunda mitad (desacople del 2 %)…» y, en bici, «Potencia normalizada 212 W · IF 0,85» y «Mejor potencia: 1 min … · 5 min …». El desacople solo aparece en carreras y rodajes de 45 min o más, con el umbral del 5 % de Friel.
- Coach, Claude, briefing y análisis post-entreno (este último de Diego, PR #6): la vista de cada sesión hecha trae `completed.fromFile` con los números del fichero (`_shared/planning/file-metrics.ts`), solo si la sesión se analizó. Los prompts de `coach`, `briefing` y `analysis` y la descripción de `get_planning_context` explican qué significa cada campo y cuándo es una señal: desacople de más del 5 % en 45 min o más, o un IF alto en una sesión suave. El análisis por reglas (`domain/workoutAnalysis.ts`) añade la frase del desacople: en «A mejorar» si el pulso se disparó y en «Bien» si fue estable.
- Unido con `david/auditoria-y-mejoras`, que ya trae `main` del 27-11 (COROS directo y análisis post-entreno). Solo chocaba `memoria/Integraciones.md`.
- Demo: las tiradas largas de la semilla traen desacople y, en bici, NP e IF, sin tocar la secuencia aleatoria.

## Comprobaciones

`npm run test:all` en verde, con pruebas nuevas en `garmin/fit.test.ts` (codificador FIT mínimo, ZIP guardado y con deflate, fórmulas y orquestación) y en `activityInsights.test.ts`, más un caso en `WorkoutDetailScreen.test.tsx`. Falta probarlo contra la API real de Garmin desde la Edge Function: la descarga solo se ha validado con los ficheros que ya bajó camino-703.

## Despliegue

1. Sin migración.
2. `supabase functions deploy garmin briefing morning coach analysis mcp`. `garmin` y `briefing` sincronizan, `morning` importa el cliente `garmin/api.ts` y `coach`, `analysis` y `mcp` leen la vista y los prompts nuevos.
3. App: entra con la siguiente build. Los datos ya guardados no cambian, y una app antigua ignora los campos nuevos.

## Pendiente

- Que el veredicto del coach en la ficha (`domain/review.ts`) también tenga en cuenta el desacople.
- Apple Salud segundo a segundo (ver tabla).
- Si el CPU de la Edge Function se queda corto con muchos FIT largos, bajar `MAX_PER_SYNC`.
