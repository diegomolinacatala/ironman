# 02 · Reglas de ciencia del entrenamiento para el motor de planificación

> **Propósito.** Especificación lista para ingeniería de las reglas que necesita un motor **determinista** que genera y re-planifica la semana de entrenamiento de triatlón (y carreras a pie). La capa de IA ("tu Claude") va encima: propone, explica y negocia, pero **el motor tiene que funcionar solo** y es quien valida cualquier propuesta.
>
> **Fecha de la investigación:** 2026-10-25. **Versión de reglas:** `RULES_VERSION = "2026.10-r1"`.
>
> **Aviso de producto (obligatorio en la app):** la app no es un servicio médico ni de nutrición. Ante dolor persistente, lesión, enfermedad, síntomas cardiacos o dudas de alimentación, el usuario debe consultar a un profesional sanitario (médico, fisioterapeuta, dietista-nutricionista).

---

## 0. Convenciones

| Etiqueta | Significado | Cómo tratarlo en código |
|---|---|---|
| **[C]** | Consenso o evidencia sólida (metaanálisis, posicionamientos, manuales oficiales) | Constante "dura"; cambiarla requiere revisión |
| **[E]** | Evidencia limitada: un estudio primario, muestras pequeñas o datos de un fabricante | Constante configurable con valor por defecto |
| **[H]** | Heurística de coaching o decisión de producto nuestra | Parámetro en `rules.config.ts`, ajustable por A/B o por usuario |

- Todas las constantes viven en un único módulo versionado (`packages/engine/src/rules.config.ts`). Cada decisión del motor lleva un `reasonCode` (ver §14) para que la UI y la IA puedan explicarla.
- **Marcas registradas:** *TSS®, CTL, ATL, TSB, IF, NP* son terminología de TrainingPeaks/Peaksware (TSS es marca registrada). En la UI de una app publicada en App Store usaremos nombres genéricos: **Carga** (≈TSS), **Forma física** (≈CTL), **Fatiga** (≈ATL), **Frescura** (≈TSB), **Intensidad relativa** (≈IF). En el código podemos usar `load`, `fitness`, `fatigue`, `form`. [H]
- Unidades: duración en minutos, intensidad como fracción del umbral (1.0 = umbral), carga en "puntos" (100 = 1 h al umbral).

### 0.1 Qué puede estar desactualizado

| Elemento | Riesgo | Nota |
|---|---|---|
| Duraciones de fase de Friel | Medio | Las cifras públicas vienen de resúmenes secundarios. *The Triathlete's Training Bible* va por la 5.ª ed. (2024) y no hemos verificado sus tablas. Las tratamos como [H] |
| Rampa de CTL y suelos de TSB | Bajo-medio | Son guías de TrainingPeaks y Friel sin fecha clara. Siguen siendo el estándar de facto en 2026 |
| Bandas de Garmin (Readiness, HRV status, Load ratio) | Medio | Vienen de manuales oficiales, pero pueden cambiar según dispositivo o firmware. Hay que leerlas como **enumeraciones** de la API, sin codificar umbrales propios encima |
| Nutrición (ACSM/AND/DC 2016) | Medio | Sigue siendo la referencia. Hay evidencia de 2024-2026 que sube el techo de hidratos a 90-120 g/h en deportistas entrenados |
| "Neck check" | Alto | El consenso del COI de 2022 señala que **no tiene base científica**. Lo usamos como triaje conservador, nunca como permiso |

---

## 1. Entradas y salidas del motor

### 1.1 Entradas mínimas

```ts
type Sport = 'swim' | 'bike' | 'run' | 'strength' | 'other';
type Distance = 'sprint' | 'olympic' | 'half' /*70.3*/ | 'full' /*IM*/ | 'run10k' | 'runHalf' | 'runMarathon';
type Level = 'beginner' | 'intermediate' | 'advanced';

interface AthleteProfile {
  id: string;
  birthYear: number;           // edad ≥ 50 → ciclo 2:1 por defecto
  sex: 'm' | 'f' | 'x';        // solo para el TRIMP de hrTSS
  weightKg?: number;           // necesario para los consejos de nutrición en g/kg
  level: Level;                // ver §6.1
  thresholds: {
    ftpW?: number;             // bici, potencia umbral
    lthrBike?: number;         // FC umbral bici
    lthrRun?: number;          // FC umbral carrera
    thresholdPaceRunSecPerKm?: number;
    cssSecPer100m?: number;    // velocidad crítica de natación (CSS)
    hrRest?: number; hrMax?: number;
  };
  limiter?: 'swim' | 'bike' | 'run';   // deporte débil
  prefs: { restDay?: 0|1|2|3|4|5|6; longDays?: number[]; allowBigWeekend?: boolean; indoorBike?: boolean };
}

interface Race { id: string; date: string; distance: Distance; priority: 'A'|'B'|'C'; }

interface DayAvailability {   // derivado del calendario (clases, trabajo)
  date: string;
  windows: { start: string; end: string; tags?: ('pool'|'daylight'|'gym')[] }[];
  maxSessions?: number;
}

interface DailyWellness {     // de Garmin, más el check-in subjetivo
  date: string;
  trainingReadiness?: number;  // 1-100
  hrvStatus?: 'balanced'|'unbalanced'|'low'|'poor'|'none';
  hrvNightlyAvgMs?: number;
  restingHr?: number;
  sleepMinutes?: number; sleepScore?: number;
  stressAvg?: number;          // 0-100 (Garmin)
  subjective?: { fatigue: 1|2|3|4|5; soreness: 1|2|3|4|5; stress: 1|2|3|4|5; mood?: 1|2|3|4|5 };
}

type PlanEvent =
  | { type: 'unplanned_activity'; activity: Activity }
  | { type: 'missed'; sessionId: string }
  | { type: 'injury'; area: BodyArea; pain0to10: number; onset: 'sudden'|'gradual'; flags: InjuryFlags }
  | { type: 'illness'; symptoms: Symptom[]; feverC?: number }
  | { type: 'life_stress'; level: 'high'|'very_high'; from: string; to: string; reason?: 'work'|'exams'|'other' }
  | { type: 'travel'; from: string; to: string; tzShiftH: number; equipment: { bike: boolean; pool: boolean; gym: boolean } }
  | { type: 'availability_change'; days: DayAvailability[] };
```

### 1.2 Salidas

```ts
interface PlannedSession {
  id: string; date: string; slot?: { start: string; end: string };
  sport: Sport; typeCode: SessionType;    // ver catálogo §9
  durationMin: number; targetIF: number;  // intensidad relativa objetivo (media de la sesión)
  plannedLoad: number;                    // TSS estimado
  cls: 'REST'|'RECOVERY'|'EASY'|'ENDURANCE'|'LONG'|'QUALITY'|'BRICK'|'RACE'|'OTHER_HARD';
  hardPoints: number;                     // §10.1
  priority: 1|2|3|4|5|6|7;                // §11.2 (1 = la más protegida)
  isKey: boolean;
  structure?: WorkoutStep[];              // exportable a Garmin (workout)
  reasonCodes: string[];
}
interface WeekPlan { weekStart: string; phase: Phase; isRecoveryWeek: boolean; targetHours: number; targetLoad: number; sessions: PlannedSession[]; warnings: string[] }
```

---

## 2. Zonas de intensidad

### 2.1 Modelo de 5 zonas (más subzonas) unificado por deporte

Las zonas de FC y ritmo de carrera son las de **Joe Friel (TrainingPeaks)**. Las de potencia siguen el esquema de Friel/Coggan. La natación usa la CSS más o menos unos segundos por 100 m. [C para las fórmulas de Friel; H para el mapeo cruzado y la columna de IF]

| Zona | Nombre (UI) | Bici % FTP | Bici % LTHR | Carrera % LTHR | Carrera ritmo (% del ritmo umbral; >100 % = más lento) | Natación (s/100 m vs CSS) | RPE (CR-10) | IF típico de una sesión continua en la zona | Seiler 3 zonas |
|---|---|---|---|---|---|---|---|---|---|
| Z1 | Recuperación | < 55 | < 81 | < 85 | > 129 % | CSS +15 s o más | 1-2 | 0.50-0.60 | Z1 (baja) |
| Z2 | Aeróbico / fondo | 55-74 | 81-89 | 85-89 | 114-129 % | CSS +8…+15 | 3-4 | 0.60-0.75 | Z1 (baja) |
| Z3 | Tempo | 75-89 | 90-93 | 90-94 | 106-113 % | CSS +4…+8 | 5-6 | 0.75-0.88 | Z2 (umbral bajo) |
| Z4 | Umbral (incluye "sweet spot" alto) | 90-104 | 94-99 | 95-99 | 99-105 % | CSS −1…+3 | 7-8 | 0.88-1.02 | Z2/Z3 |
| Z5a | Supraumbral | 105-120 | 100-102 | 100-102 | 97-100 % | CSS −2…−4 | 8-9 | 1.00-1.08 (intervalos) | Z3 (alta) |
| Z5b | VO2max | 105-120 | 103-106 | 103-106 | 90-96 % | CSS −4…−6 | 9 | n/a (intervalos) | Z3 |
| Z5c | Anaeróbico / sprint | > 120 | > 106 | > 106 | < 90 % | < CSS −6 | 10 | n/a | Z3 |

Notas para implementar:
- **Tests de umbral (Friel):** contrarreloj de 30 min en solitario. LTHR = FC media de los últimos 20 min. FTP (versión Friel) = potencia media de los 30 min. Ritmo umbral = ritmo medio de los 30 min. Natación: T-time de 1000 m ÷ 10, o CSS = (T400 − T200)/2 por 100 m. Se repiten cada 4-6 semanas, o al final de una semana de recuperación. [C] ([Friel, TrainingPeaks](https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/))
- La bici y la carrera tienen LTHR distintos. Garmin puede devolver FTP y LTHR estimados (`get_cycling_ftp`, `get_lactate_threshold`). Los aceptamos como valor inicial y pedimos confirmación al usuario. [H]
- Si solo hay FCmax: LTHR ≈ 0.89-0.90 × FCmax en carrera y 0.86-0.88 × FCmax en bici. [H] Se marca como `thresholdSource='estimated'` y se baja la confianza de la carga calculada.
- Las bandas de CSS que publican distintas fuentes no coinciden entre sí ([ejemplos](https://www.myprocoach.net/?p=6575)). Las de la tabla son nuestro estándar. [H]

### 2.2 Distribución de intensidad (TID)

**Hechos:**
- Los deportistas de resistencia bien entrenados hacen la mayor parte del volumen a baja intensidad. Los estudios describen sobre todo una distribución **piramidal**, y los de clase mundial a menudo una **polarizada** ([Stöggl & Sperlich 2015](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4621419/)). [C]
- Metaanálisis de 2024 (17 estudios, n=437): la polarizada mejora algo más el VO2pico (SMD 0.24), sobre todo en intervenciones de menos de 12 semanas y en deportistas muy entrenados. No hay diferencias en contrarreloj, tiempo hasta el agotamiento ni potencia o velocidad umbral ([Oliveira et al., Sports Med 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11329428/)). Una revisión de alcance de 2025 concluye que en deportistas de nivel recreativo todos los modelos funcionan, con diferencias mínimas. [C]
- Medio Ironman (18 triatletas recreativos): más tiempo en Seiler-Z2 se asoció a mejor rendimiento. Es observacional ([JSSM 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6873141)). [E]

**Decisión de producto:** distribución **piramidal en base** y **mixta en build** (polarizada para distancias cortas, piramidal con mucho ritmo de carrera para 70.3/IM). Se mide por **tiempo** y en el modelo de 3 zonas de Seiler (Z1 = nuestras Z1-Z2; Z2 = Z3-Z4 baja; Z3 = Z4 alta en adelante). [H]

| Fase | Seiler Z1 (baja) | Seiler Z2 (tempo/umbral) | Seiler Z3 (alta) | Sesiones QUALITY bici+carrera/semana (máx.) |
|---|---|---|---|---|
| Transición | 100 % (sin estructura) | 0 | 0 | 0 |
| Prep | 90-95 % | 5-10 % (solo progresivos) | 0 (solo strides) | 0-1 |
| Base | 85-90 % | 8-12 % | 0-5 % | 2 |
| Build sprint/olímpico | 75-82 % | 8-12 % | 10-15 % | 3 (el brick cuenta) |
| Build 70.3 / IM | 75-82 % | 15-20 % | 3-7 % | 3 (el brick cuenta) |
| Peak/taper | 75-80 % | 10-15 % | 5-10 % | 2-3 (cortas) |
| Semana de carrera | ≥ 85 % | activaciones cortas | activaciones | 1-2 activaciones |

Invariante del motor: `share(Z1+Z2 de nuestras zonas) ≥ 0.75` del tiempo semanal en cualquier fase excepto la semana de carrera. [H]

### 2.3 Intensidad objetivo en competición (para las sesiones de ritmo de carrera)

| Distancia | IF bici objetivo | Carrera (zona / referencia) | Natación |
|---|---|---|---|
| Sprint | 0.90-1.00 | Z4-Z5a | CSS −1…−3 |
| Olímpico | 0.85-0.95 | Z4 (≈ ritmo umbral) | CSS ±1 |
| 70.3 | 0.75-0.85 | Z3 alta / Z4 baja | CSS +2…+4 |
| Ironman | 0.65-0.78 | Z2 alta / Z3 baja | CSS +4…+6 |

[H] Rangos muy citados por entrenadores. Dentro de cada rango, el nivel decide: los principiantes van al extremo bajo.

---

## 3. Estimación de carga (TSS y equivalentes)

### 3.1 Fórmulas

| Fuente | Fórmula | Requiere | Etiqueta |
|---|---|---|---|
| Potencia (bici) | `IF = NP / FTP`; `TSS = h × IF² × 100` (equivale a `(s × NP × IF)/(FTP × 3600) × 100`) | potencia por segundo, FTP | [C] ([TP](https://www.trainingpeaks.com/blog/normalized-power-intensity-factor-training-stress)) |
| rTSS (carrera) | `IF = NGP_speed / threshold_speed`; `rTSS = h × IF² × 100` | GPS o footpod, desnivel, ritmo umbral | [C] (fórmula de TP; el NGP es propietario y lo aproximamos con un ajuste por pendiente) |
| sTSS (natación) | `IF = NSS / CSS_speed`; **`sTSS = h_mov × IF³ × 100`** (cubo por la resistencia del agua) | distancia y tiempo **en movimiento**, sin descansos | [C] ([TP](https://www.trainingpeaks.com/learn/articles/calculating-swimming-tss-score/)) |
| hrTSS (cualquier deporte) | Nuestra aproximación: `hrTSS = 100 × TRIMP(sesión) / TRIMP(60 min a LTHR)` con TRIMP de Banister `Σ Δt_min × HRr × a × e^(b × HRr)`, `HRr = (HR − HRrest)/(HRmax − HRrest)`, a=0.64, b=1.92 (hombre) / a=0.86, b=1.67 (mujer) | serie temporal de FC, LTHR, FC de reposo y máxima | [H] (TP no publica la suya; esta queda calibrada a 100/h al umbral) |
| sRPE (respaldo) | `IF_rpe = RPE_TO_IF[rpe]`; `load = h × IF_rpe² × 100` | duración, RPE 1-10 | [H] (sRPE de Foster: RPE × min, reescalado) |
| Tabla por defecto | `load = h × DEFAULT_TSS_PER_H[type]` | solo duración | [H] |

**Prioridad de la fuente** (igual que TrainingPeaks: potencia > rTSS/sTSS > hrTSS): `power → pace (rTSS/sTSS) → HR (hrTSS) → sRPE → tabla`. Se guarda `loadSource` y `loadConfidence` (1.0 potencia, 0.85 ritmo, 0.75 FC, 0.6 RPE, 0.4 tabla). [C/H] ([TP: TSS vs hrTSS](https://www.trainingpeaks.com/learn/articles/training-with-tss-vs-hrtss-whats-the-difference/))

Advertencias:
- **El hrTSS infravalora los intervalos cortos e intensos** (la FC va con retraso) y sobrevalora el calor y la deshidratación. Con la FC media en lugar de la serie temporal, el error es mayor. [C]
- **rTSS:** en trail o con mala señal GPS, usar hrTSS. En cinta, usar el ritmo de la cinta si el usuario lo introduce o, si no, la FC. [H]
- **sTSS:** es muy sensible al CSS (por el cubo). Con muchos ejercicios de técnica, patada o material (palas, aletas), usar RPE. En aguas abiertas, la distancia GPS no es fiable: aplicar un factor ×0.95 o usar RPE. [H]
- **Fuerza:** el TSS no capta el daño neuromuscular. Asignamos `load = h × 35` (30-45/h) y además `neuromuscularLoad` (ver §11.4). [H]
- **Carrera frente a bici:** con la misma carga, correr produce más daño mecánico. Por eso, además de la carga, el motor lleva un contador aparte de **minutos y km de carrera** (§6.3). [C cualitativo / H en los números]

```ts
const RPE_TO_IF = {1:0.50, 2:0.55, 3:0.62, 4:0.70, 5:0.76, 6:0.82, 7:0.88, 8:0.94, 9:1.00, 10:1.08}; // [H]
```

### 3.2 Carga por hora típica según tipo de sesión (para planificar)

Para la bici, las cifras siguen la tabla de [Roadman Cycling](https://roadmancycling.com/blog/training-stress-score-tss-cycling-guide) (recuperación 30-42, Z2 42-56, tempo 58-72, sweet spot 72-90, umbral 90-110 TSS/h **en trabajo continuo**). Las hemos rebajado para sesiones completas con calentamiento y vuelta a la calma. [H]

| Tipo (código §9) | Bici TSS/h | Carrera rTSS/h | Natación sTSS/h |
|---|---|---|---|
| Recuperación (`*_REC`) | 25-35 (30) | 40-50 (45) | 25-35 (30) |
| Técnica (`SW_TECH`) | — | — | 25-40 (32) |
| Fondo Z2 (`*_END`) | 45-55 (50) | 50-60 (55) | 45-55 (50) |
| Larga (`*_LONG`) | 50-62 (55) | 55-65 (60) | 50-60 (55) |
| Tempo (`*_TEMPO`) | 60-72 (65) | 65-78 (70) | 60-70 (65) |
| Sweet spot (`BK_SST`) | 72-85 (78) | — | — |
| Umbral en intervalos (`*_THR`, `SW_CSS`) | 80-95 (85) | 80-92 (85) | 65-85 (75) |
| VO2 (`*_VO2`) | 75-90 (82) | 75-90 (82) | 60-75 (68) |
| Ritmo 70.3 (`*_RP70`) | 62-75 (68) | 68-78 (72) | — |
| Ritmo IM (`*_RPIM`) | 48-60 (55) | 55-65 (60) | — |
| Fuerza (`ST_*`) | 30-45 (35) | | |
| Movilidad / yoga | 10-20 (15) | | |

Entre paréntesis, el valor por defecto que usa la constante `DEFAULT_TSS_PER_H`.

### 3.3 Carga de la propia competición

Valores de [TrainingPeaks](https://www.trainingpeaks.com/blog/track-triathlon-training-trainingpeaks/): sprint 75-120, olímpico 170-220, 70.3 300-400, Ironman 590-750. Sirven para estimar el día de carrera en el PMC proyectado y la fatiga posterior. [E]

---

## 4. Modelo de rendimiento (PMC): forma física, fatiga y frescura

### 4.1 Constantes y fórmulas [C]

```ts
const CTL_TAU = 42;  // días (forma física)
const ATL_TAU = 7;   // días (fatiga)
const kCTL = 1 - Math.exp(-1 / CTL_TAU);  // ≈ 0.02353 (TP usa la aproximación 1/42 ≈ 0.0238; cualquiera sirve)
const kATL = 1 - Math.exp(-1 / ATL_TAU);  // ≈ 0.1331

// Por día t, con load_t = suma de la carga del día (0 si no se entrena)
CTL[t] = CTL[t-1] + (load[t] - CTL[t-1]) * kCTL;
ATL[t] = ATL[t-1] + (load[t] - ATL[t-1]) * kATL;
TSB[t] = CTL[t-1] - ATL[t-1];     // frescura "de hoy" = forma de ayer − fatiga de ayer (convención TP)
RAMP_7d[t] = CTL[t] - CTL[t-7];   // puntos de forma por semana
```

- **Inicialización:** leer 90 días de histórico de Garmin (lo ideal) o, como mínimo, 42. Sin histórico: `CTL0 = ATL0 = media diaria de carga de las últimas 4 semanas`, estimada con la duración y la tabla. Si no hay nada: `CTL0 = ATL0 = 0.5 × target_inicio` con `confidence='low'`, y no aplicar el control de rampa durante las 2 primeras semanas (solo el control de volumen). [H]
- El PMC es **único para todos los deportes** (carga global). Además llevamos `CTL_run`, `CTL_bike` y `CTL_swim` para informar y controlar la progresión por deporte. [H]
- Carga semanal necesaria para subir `r` puntos de CTL en 7 días, partiendo de `CTL0` con carga diaria constante: `T_dia = CTL0 + r / (1 − e^(−7/42))` ⇒ `weeklyLoad ≈ 7 × (CTL0 + 6.52 × r)`. Ejemplo: CTL 60 y r = 5 ⇒ ≈ 648 puntos/semana. [C, derivación matemática]

### 4.2 Rampa segura (puntos de CTL por semana)

Tabla de [TrainingPeaks](https://www.trainingpeaks.com/blog/track-triathlon-training-trainingpeaks/), coherente con [Friel](https://www.goodreads.com/author_blog_posts/8386404-the-ctl-ramp-rate) (5-8/semana "lo adecuado para la mayoría"; más de 10 es carga de "crash", como mucho 1 semana):

| CTL actual | Riesgo bajo | Riesgo moderado | Riesgo alto |
|---|---|---|---|
| ≤ 45 | ≤ 3 | 4-6 | ≥ 7 |
| 45-70 | ≤ 4 | 6-7 | ≥ 8 |
| ≥ 70 | ≤ 5 | 6-8 | ≥ 9 |

**Reglas del motor:**
- `RAMP_TARGET = límite superior de "riesgo bajo"` para principiantes y para cualquier usuario con estrés vital alto. El límite de "moderado" para intermedios y avanzados. [H]
- `RAMP_HARD_CAP = 8`. El plan generado **nunca** supera 8/semana (salvo una "semana de concentración" que el usuario active explícitamente, con un máximo de 10 durante 1 semana y la siguiente como recuperación). [C/H]
- **Estrés vital** (trabajo, exámenes, mudanza): `RAMP_TARGET −= 2` mientras dure. Friel recomienda explícitamente bajar la rampa en esos casos. [C cualitativo / H en el número]
- Tras una semana de recuperación, el CTL baja. Es lo esperado y **no** hay que compensarlo en la semana siguiente. [C]

### 4.3 Umbrales de frescura (TSB)

| TSB | Estado (UI) | Acción del motor |
|---|---|---|
| > +25 | Desentrenando / transición | Aviso si no se está en transición o taper |
| +5…+25 | Fresco: listo para competir | Objetivo del día de carrera (A) |
| −10…+5 | Neutral / mantenimiento | — |
| −10…−20 | Productivo (carga) | Rango normal en base y build |
| −20…−30 | Carga alta | Aviso (`TSB_WARN`). Si la readiness está en ámbar o rojo, bajar el día duro siguiente |
| < −30 | Riesgo | **Bloqueo:** el plan generado no puede proyectar TSB < −30 ([TP](https://www.trainingpeaks.com/blog/track-triathlon-training-trainingpeaks/): "no superar −30; vigilar desde −20") |

[C para −30 como suelo, citado por TP; H para el resto de rangos, que vienen de guías secundarias]

TSB objetivo el día de una carrera A [H]: sprint y olímpico +5…+15; 70.3 +10…+20; IM +15…+25.

### 4.4 Forma física orientativa por distancia [H, fuentes secundarias y foros]

| Distancia | CTL al empezar el taper (amateur) | Carga semanal en build (pts) |
|---|---|---|
| Sprint | 35-60 | 250-400 |
| Olímpico | 45-75 | 350-500 |
| 70.3 | 60-100 | 500-700 |
| Ironman | 80-130 | 700-1000+ |

Solo sirve para **informar** ("vas por buen camino"), nunca como objetivo que fuerce la rampa. TP advierte que los rangos son amplios y que hay que adaptarlos a la experiencia y al tiempo disponible.

### 4.5 Señales de Garmin como apoyo
- **Load ratio de Garmin** (aguda frente a crónica): bajo < 0.8; óptimo 0.8-1.4; alto 1.5-1.9; muy alto ≥ 2.0 ([manual de Garmin](https://www8.garmin.com/manuals-apac/webhelp/forerunner970/EN-SG/GUID-5EC24965-C82C-4FEA-8647-313C08B6F7C7-6714.html)). Solo informativo: un "alto" refuerza `TSB_WARN`. [C como dato de Garmin / H en el uso]
- **No usamos el ACWR** para decidir la progresión de carrera: en la cohorte Garmin de 5205 corredores, el ACWR y el ratio semana a semana no predijeron lesiones ([Frandsen et al., BJSM 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12421110)). [E]

---

## 5. Periodización (macrociclo)

### 5.1 Fases (modelo de Friel)

| Fase | Objetivo | Contenido dominante | Etiqueta |
|---|---|---|---|
| **Transición** | Recuperar física y mentalmente | Actividad libre, otros deportes, 0 estructura | [C] |
| **Prep** | Volver a entrenar | Z1-Z2, técnica, fuerza anatómica o adaptativa | [C] |
| **Base (1-3)** | Resistencia aeróbica, técnica, fuerza máxima | Z2 dominante, tempo desde Base 2, fuerza pesada | [C] |
| **Build (1-2)** | Especificidad de carrera | Intervalos al ritmo de carrera, bricks, simulaciones | [C] |
| **Peak** | Consolidar y reducir fatiga | Volumen ↓, intensidad mantenida | [C] |
| **Race** | Competir | Activaciones, descanso | [C] |

Según Friel ([TP: base training](https://trainingpeaks.com/blog/what-is-base-training)), el build empieza unas 12 semanas antes de la primera carrera A. Resúmenes secundarios: base 8-16 semanas, build 8-12 (9-10 según Friel), peak 1-2, transición 1-6 ([resumen](https://www.coachray.nz/2021/10/18/joe-friels-bible-for-periodisation/), [Friel, blog](https://www.goodreads.com/author_blog_posts/5177450-aging-customizing-the-build-period)). Las duraciones exactas son [H].

### 5.2 Duración de las fases por distancia (semanas, contando hacia atrás desde la carrera A)

`Taper` = días totales de reducción **incluida** la semana de carrera. `Peak` = semanas completas de taper antes de la semana de carrera.

| Distancia | Race | Peak | Build (mín.-ideal) | Base (mín.-ideal-máx.) | Prep (mín.-ideal) | Total ideal | Mínimo viable | Taper total (días) | Transición posterior |
|---|---|---|---|---|---|---|---|---|---|
| Sprint | 1 | 0 | 4-6 | 4-8-12 | 0-2 | 13-17 | 8 | 7-10 | 2-4 días suaves |
| Olímpico | 1 | 0-1 | 6-8 | 6-10-14 | 0-2 | 16-22 | 10 | 8-12 | 3-7 días |
| 70.3 | 1 | 1 | 6-10 | 6-12-16 | 2-3 | 20-27 | 12 | 10-14 | 7-14 días (sin intensidad 7-10 d) |
| Ironman | 1 | 2 | 8-12 | 8-14-20 | 2-4 | 26-33 | 18 | 14-21 | 2-4 semanas (1.ª sin estructura) |
| 10 km | 1 | 0 | 4-6 | 4-8-12 | 0-2 | 12-17 | 6 | 5-8 | 2-4 días |
| Media maratón | 1 | 0-1 | 6-8 | 4-8-12 | 0-2 | 14-19 | 8 | 7-12 | 5-10 días |
| Maratón | 1 | 2 | 8-10 | 6-10-14 | 2 | 20-25 | 12 | 14-21 | 2-3 semanas |

[H] Reconciliación de Friel, coaching y la literatura de taper (§5.4).

**Algoritmo de asignación (hacia atrás):**

```ts
function buildMacrocycle(today: Date, raceA: Race, ctx: { ctlNow: number; ctlTargetAtTaper: number; recentlyStructured: boolean }): PhaseWeek[] {
  const W = mondaysBetween(today, mondayOf(raceA.date)) + 1;   // semanas, incluida la de carrera
  const D = PHASE_TABLE[raceA.distance];
  let race = 1, peak = D.peak, build = D.build.ideal, base = D.base.ideal;
  let prep = (ctx.recentlyStructured || ctx.ctlNow >= 0.6 * ctx.ctlTargetAtTaper) ? 0 : D.prep.ideal;
  let rest = W - (race + peak + build + base + prep);
  if (rest > 0) {                                  // sobra tiempo
    const addBase = Math.min(rest, D.base.max - base); base += addBase; rest -= addBase;
    // el resto: bloques de "Base de mantenimiento" (patrón 3:1) antes de Prep. El build nunca pasa de su ideal
    return layout({ maintenance: rest, prep, base, build, peak, race });
  }
  // falta tiempo: comprimir en este orden
  for (const step of [
    () => prep  = Math.max(D.prep.min, prep - deficit()),
    () => base  = Math.max(D.base.min, base - deficit()),
    () => build = Math.max(D.build.min, build - deficit()),
    () => peak  = Math.max(raceA.distance === 'full' ? 1 : 0, peak - deficit()),
  ]) { if (deficit() > 0) step(); }
  if (deficit() > 0) warn('PLAN_TOO_SHORT');       // < mínimo viable: plan "supervivencia" (base + taper)
  return layout({ prep, base, build, peak, race });
  function deficit() { return (prep + base + build + peak + race) - W; }
}
```

- **Subfases** [H]: base se divide en tercios (Base1, Base2, Base3) y build en mitades (Build1, Build2). Cada subfase termina en una semana de recuperación (§5.5). Los límites de fase coinciden con las semanas de recuperación.
- Si el usuario está a **menos de `mínimo viable`** semanas: se avisa (`PLAN_TOO_SHORT`). Para un IM a menos de 12 semanas sin base previa (CTL < 50), el aviso es fuerte y se sugiere cambiar a una distancia menor o pasar la carrera a "terminar, no competir". [H]

### 5.3 Varias carreras (A/B/C) [H]

| Prioridad | Taper | Recuperación después | Efecto en el macrociclo |
|---|---|---|---|
| **A** | Completo (§5.4) | Transición según la distancia | Define las fases |
| **B** | Mini-taper de 3-5 días (volumen −30-40 %, sin días duros 48 h antes) | Sprint/olímpico 2-3 días suaves; 70.3: 5-7 días; IM como B: **no recomendado** (aviso) | Sustituye la sesión clave de la semana |
| **C** | Ninguno (día suave antes) | 1-2 días suaves | Cuenta como sesión QUALITY o LONG |

Dos carreras A separadas por N semanas (por ejemplo, olímpico en junio e IM en septiembre):
- `N ≥ 12`: transición corta (según distancia) → base corta (≥ 3 semanas) → build → peak.
- `6 ≤ N < 12`: transición → build recortado → peak.
- `N < 6`: transición → mantenimiento → mini-taper. Si una de las dos es IM y `N < 8`: aviso `RACES_TOO_CLOSE`.
- Las carreras a pie (10k, media, maratón) dentro de una temporada de triatlón se tratan como B o C. Un maratón como B dentro de un build de IM exige una recuperación de ≥ 10 días sin carrera de calidad (aviso). [H]

### 5.4 Taper (reducción precompetitiva)

Evidencia:
- Metaanálisis en deportistas de resistencia (PLOS ONE 2023): taper de ≤ 21 días con el volumen reducido de forma **progresiva un 41-60 %**, **sin cambiar ni la intensidad ni la frecuencia** ([registro](https://www.sponet.de/sponet/Record/4081751?lng=en)). [C]
- Revisión en triatletas: −41-60 % en natación y −21-60 % en bici y carrera ([registro](https://lida.sport-iat.de/ta/Record/4059196?lng=en)). [E]
- Un taper exponencial rinde mejor que uno escalonado, y uno exponencial rápido mejor que uno lento ([Banister et al. 1999](https://coachsci.sdsu.edu/csa/vol71/banister.htm)). En Ironman, una reducción exponencial del 50 % mejoró un 5 km ≈ 4 %; un escalón del 30 % no tuvo efecto (Zarkadas 1995, [PubMed](https://pubmed.ncbi.nlm.nih.gov/8629477/)). [E, n pequeño]
- Duración óptima de 8-14 días en conjunto ([resumen secundario](https://www.precisionhydration.com/performance-advice/performance/how-to-taper-for-triathlon)). Las fuentes de coaching dan sprint 5-7, olímpico 7-10, 70.3 10-14 e IM 14-21 días ([220 Triathlon](https://www.220triathlon.com/training/long-distance/how-to-taper-for-middle-distance-triathlons)). [E/H]

Factores de volumen semanal del motor, relativos a la **media de las 3 últimas semanas de carga de build** (sin contar la recuperación). [H] dentro del rango [C]:

| Distancia | Semana −2 | Semana −1 (peak) | Semana de carrera (sin la carrera) | Intensidad | Frecuencia |
|---|---|---|---|---|---|
| Sprint | build | 0.85 (últimos 3 días al 0.7) | 0.50-0.60 | Se mantiene (1-2 sesiones cortas) | ≥ 80 % de las sesiones |
| Olímpico | build | 0.75-0.80 | 0.50 | Se mantiene | ≥ 80 % |
| 70.3 | 0.85-0.90 | 0.65-0.70 | 0.40-0.50 | Se mantiene | ≥ 80 % |
| Ironman (3 sem.) | 0.75-0.80 | 0.60-0.65 | 0.35-0.45 | Se mantiene | ≥ 75 % |
| 10 km | build | 0.80 | 0.55 | Se mantiene | ≥ 80 % |
| Media maratón | build | 0.75 | 0.50 | Se mantiene | ≥ 80 % |
| Maratón | 0.80 | 0.65 | 0.40-0.50 | Se mantiene | ≥ 75 % |

Reglas de la semana de carrera [H]:
- Última sesión LONG: IM ≥ 10-14 días antes (bici) y ≥ 14 días (carrera); 70.3 ≥ 7-10 días; olímpico ≥ 7 días.
- D−1: descanso o activación de 20-40 min (bici o carrera con 3-4 × 30-60 s a ritmo de carrera). D−2: descanso o natación suave. D−3/D−4: última sesión "con chispa" (brick corto o intervalos breves a ritmo de carrera).
- Nada de fuerza pesada en los 7 días previos a una A. Nada de deportes de contacto u otros deportes de riesgo (pádel, fútbol) en los 7 días previos: **aviso, no bloqueo**.
- Trazado de la reducción: exponencial (bajada fuerte los primeros días y después estable), con un pequeño repunte 3-4 días antes.

### 5.5 Semanas de recuperación

- Friel: al menos tantas sesiones de recuperación como duras, y cada 3.ª o 4.ª semana un periodo de entrenamiento muy reducido. Patrón clásico 3:1. En máster, el 2:1 suele ser más sostenible ([Roadman](https://roadmancycling.com/glossary/recovery-week)). Los planes de triatlón máster de TrainerRoad usan 2:1 ([TrainerRoad](https://www.trainerroad.com/blog/new-triathlon-and-masters-triathlon-plans/)). [C cualitativo]
- Reducción típica del 40-60 % del volumen, manteniendo algo de intensidad. [E/H]

Reglas del motor [H]:

| Parámetro | Valor por defecto |
|---|---|
| Cadencia | `3:1`. Pasa a `2:1` si edad ≥ 50, primera temporada (principiante), vuelta de lesión (< 8 semanas) o estrés vital alto ≥ 2 semanas en el último mes |
| Factor de volumen | 0.60 × media de las semanas de carga del bloque (0.65 en 2:1) |
| Intensidad | 1 sesión corta de calidad en total (o 2 en build: una de bici y una de carrera, al 50 % del trabajo habitual) |
| Fuerza | 1 sesión de mantenimiento |
| Tests | Opcional al final de la semana (día 6-7): FTP, LTHR, ritmo umbral, CSS |
| Desplazamiento | Si hay estrés vital o enfermedad cerca de la recuperación prevista (±1 semana), se **adelanta** la recuperación y se reinicia el contador |

Progresión dentro de un bloque de carga [H]: las semanas 1-2-3 del bloque usan factores `0.95 / 1.00 / 1.05` sobre el objetivo de la subfase, siempre limitados por la rampa (§4.2). El siguiente bloque empieza aproximadamente al nivel de la semana 2 del anterior (escalonado).

---

## 6. Volumen

### 6.1 Nivel del atleta [H]

| Nivel | Criterio (el más bajo que se cumpla) |
|---|---|
| beginner | < 1 temporada de triatlón, o nunca ha terminado la distancia objetivo, o CTL < 35 |
| intermediate | 1-3 temporadas y ha terminado la distancia (o una inmediatamente inferior), CTL de 35 a 70 |
| advanced | > 3 temporadas, ≥ 10 h/semana constantes durante 6 meses, CTL > 70 |

### 6.2 Horas semanales por distancia y nivel (semanas de carga de build; base ≈ 80-90 %) [H]

| Distancia | Principiante | Intermedio | Avanzado | Fuente |
|---|---|---|---|---|
| Sprint | 3-5 | 5-7 | 7-10 | [tri-alliance](https://tri-alliance.com/tools/training-hours/) (4-7 de media) |
| Olímpico | 5-7 | 7-10 | 10-13 | (6-10 de media) |
| 70.3 | 7-9 | 9-12 | 12-16 | (8-14; los planes intermedios pasan de 8-9 a 15+) |
| Ironman | 9-12 | 12-16 | 16-20+ | (12-20) |
| 10 km | 3-4 (carrera) | 4-6 | 6-9 | [H] |
| Media maratón | 3-5 | 5-7 | 7-10 | [H] |
| Maratón | 4-6 | 6-8 | 8-12 | [H] |

`H_peak = min(tabla[dist][nivel].max, 0.9 × horas disponibles del calendario en una semana típica, horas máximas declaradas por el usuario)`.

**Curva de volumen por subfase** (fracción de `H_peak`) [H, inspirado en Friel]:

| Subfase | Sprint/Olímpico | 70.3 | Ironman |
|---|---|---|---|
| Prep | 0.50-0.60 | 0.50-0.60 | 0.50-0.60 |
| Base 1 | 0.65-0.70 | 0.65 | 0.60-0.65 |
| Base 2 | 0.75-0.80 | 0.75 | 0.70-0.75 |
| Base 3 | 0.85-0.90 | 0.85 | 0.80-0.85 |
| Build 1 | 0.90 (sube la intensidad) | 0.95 | 0.90-0.95 |
| Build 2 | 0.85-0.90 | 1.00 | 1.00 |
| Peak / taper | §5.4 | §5.4 | §5.4 |

En distancias cortas, el volumen del build baja algo respecto a Base 3 porque sube la intensidad. En IM, el volumen máximo cae en Build 2.

### 6.3 Progresión por deporte y sesiones largas

- **Regla de la sesión de carrera (Frandsen 2025, 5205 corredores con Garmin):** si una sesión supera en más de un 10 % la distancia de la **carrera más larga de los últimos 30 días**, el riesgo de lesión por sobrecarga aumenta (HRR 1.64 para un exceso de +10-30 %, 1.52 para +30-100 % y 2.28 para más del 100 %). Incluso los aumentos del 1-10 % no son del todo seguros ([BJSM 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12421110)). [E, observacional pero grande y reciente] ⇒ **Restricción dura del motor:** `run.distance ≤ 1.10 × maxRunDistance(últimos 30 días)` (con un mínimo de 5 km para no bloquear a quien empieza de cero).
- Minutos de carrera semanales: `≤ 1.15 ×` la media de las 3 semanas anteriores. Es una regla [H] complementaria: Frandsen no encontró efecto en el ratio semanal, pero la mantenemos como protección suave (aviso, no bloqueo).
- Bici larga: `+15-20 min/semana` o `≤ 1.15 ×` la más larga de los últimos 30 días. [H]
- Natación: `≤ +500 m` por sesión y semana. [H]

**Tope de las sesiones largas en el build** [H]:

| Distancia | Bici larga | Carrera larga | Natación larga | Brick (bici + carrera) |
|---|---|---|---|---|
| Sprint | 1:30 | 1:00 | 1500 m | 45-60' + 15-20' |
| Olímpico | 2:30 | 1:30 | 2500-3000 m | 75-90' + 20-30' |
| 70.3 | 3:30-4:00 | 1:45-2:00 | 3000-3500 m | 2:00-2:30 + 30-45' |
| Ironman | 5:00-6:00 | 2:30 (máx. 2:45) | 3800-4200 m | 3:00-4:00 + 30-60' |

- Bici en rodillo: tope de 2:30 por defecto (`indoorLongCap`), salvo que el usuario lo cambie. [H]
- La carrera larga se limita por **tiempo y** por la regla del 10 % de Frandsen. Gana la que sea más restrictiva.

---

## 7. Reparto por deportes según la fase

Contexto: en competición, la bici ocupa alrededor del 50 % del tiempo (olímpico: natación 16 %, bici 53 %, carrera 30 %, según [JOHK](https://johk.pl/?p=2536)), y el reparto del entrenamiento suele seguir ±5 puntos el de la carrera. [E]

**% del tiempo semanal (sin contar "otros deportes")** [H]:

| Fase | Natación | Bici | Carrera | Fuerza + movilidad |
|---|---|---|---|---|
| Prep | 25 | 35 | 25 | 15 |
| Base (70.3 / IM) | 20 | 47 | 25 | 8 |
| Base (sprint / olímpico) | 23 | 40 | 29 | 8 |
| Build (70.3) | 18 | 50 | 28 | 4 |
| Build (IM) | 17 | 54 | 26 | 3 |
| Build (sprint / olímpico) | 22 | 42 | 32 | 4 |
| Peak / taper | 20 | 48 | 30 | 2 |
| Carreras a pie (todas las fases) | 0 | 0-15 (bici como cruzado opcional) | 75-85 | 10 |

Ajustes:
- `limiter`: +5 puntos al deporte débil, restados del más fuerte. Máximo 1 ajuste. [H]
- Principiante con experiencia nula en natación: natación ≥ 25 % y ≥ 3 sesiones por semana si hay ≥ 8 h. [H]
- **Fuerza:** 2 sesiones por semana en base (fase pesada de 5-8 semanas, según [TP](https://www.trainingpeaks.com/blog/year-round-strength-training-for-triathletes-part-3-heavy-weight-training-phase/)); en build, 1 de mantenimiento; en peak, 0-1; en la semana de carrera, 0. La evidencia apoya la fuerza pesada para mejorar la economía de pedaleo y de carrera, y se necesitan unas ≥ 24 sesiones para obtener beneficios claros ([TP](https://trainingpeaks.com/blog/heavy-lifting-for-endurance-athletes)). [C para el beneficio / H para la frecuencia en build]

---

## 8. Sesiones por semana y deporte según las horas disponibles

[H] Duración mínima útil de una sesión: natación 30' (más 30' de desplazamiento y vestuario en piscina), bici 45' (40' en rodillo), carrera 25', fuerza 25'.

| Horas/semana | Natación | Bici | Carrera | Fuerza | Total de sesiones | Días de descanso | Notas |
|---|---|---|---|---|---|---|---|
| 5 h | 2 (×35-40') | 2 (60' + 90') | 2-3 (30', 40', 60') | 0-1 (20' tras correr) | 6-8 | 1-2 | Brick = bici larga + 10-15' de carrera |
| 8 h | 2 (×45') | 3 (60', 60', 2:00) | 3 (35', 45', 70') | 1 (30') | 9 | 1 | |
| 10 h | 3 (×45') | 3 (60', 75', 2:30) | 3 (40', 50', 80') | 1-2 (30') | 10-11 | 1 | Dos dobles (natación + carrera) |
| 12 h | 3 (×50') | 3-4 (60', 75', 3:00, +45' opc.) | 4 (40', 45', 50', 1:30) | 2 (30') | 12-13 | 1 | |
| 15 h | 3-4 (×60') | 4 (60', 90', 90', 4:00) | 4-5 (45', 50', 60', 1:45) | 2 (30') | 13-15 | 0-1 (1 día muy suave) | Avanzado |

Reglas:
- Frecuencia mínima por deporte: **natación ≥ 2/semana** (la técnica se pierde rápido), bici ≥ 2, carrera ≥ 2 (≥ 3 desde 8 h). [H]
- Primero se reparte el **tiempo** por deporte (§7) y después se divide en sesiones: 1 larga (35-45 % del tiempo del deporte en bici y 30-40 % en carrera), 1-2 de calidad y el resto de fondo o recuperación. [H]
- Carreras a pie: 3 sesiones con 4 h, 4 con 5-6 h, 5 con 7 h o más. 1 larga, 1-2 de calidad y el resto suaves. [H]

---

## 9. Catálogo de sesiones (biblioteca determinista)

Cada tipo genera una estructura exportable a Garmin (`WorkoutStep[]`). Los rangos de duración se escalan con la fase y las horas. [H] La estructura sigue los principios de las zonas de §2.

| Código | Deporte | Clase | hardPoints | Fases | Estructura tipo | IF |
|---|---|---|---|---|---|---|
| `SW_TECH` | natación | EASY | 0 | todas | 30-45': 200 de calentamiento, ejercicios de técnica de 8-12 × 50, 4 × 100 Z2 | 0.70 |
| `SW_END` | natación | ENDURANCE | 0 | todas | 45-75': serie principal de 4-10 × 200-400 a CSS +6…+10 | 0.80 |
| `SW_CSS` | natación | QUALITY | 0.5 | Base 2 → Peak | 10-15 × 100 a CSS −1…+2, r15-20" o 4-6 × 300 a CSS +2 | 0.88 |
| `SW_SPEED` | natación | QUALITY | 0.5 | Build sprint/olímpico | 12-16 × 50 a CSS −4…−6, r30" | 0.85 |
| `SW_OW` | natación | ENDURANCE | 0 | Build/Peak | 30-60' en aguas abiertas, **nunca a solas** | 0.80 |
| `BK_REC` | bici | RECOVERY | 0 | todas | 30-60' Z1 | 0.55 |
| `BK_END` | bici | ENDURANCE | 0 | todas | 60-120' Z2 + cadencia | 0.70 |
| `BK_LONG` | bici | LONG | 1 (0.5 si < 150' e IF < 0.75) | Base/Build | 2-6 h Z2 (en build, con bloques al ritmo de carrera) | 0.70-0.76 |
| `BK_TEMPO` | bici | QUALITY | 1 | Base 2+ | 3 × 15-20' Z3 | 0.80 |
| `BK_SST` | bici | QUALITY | 1 | Base 3 / Build | 3 × 12-20' al 88-94 % FTP | 0.85 |
| `BK_THR` | bici | QUALITY | 1 | Build | 4 × 8-10' o 2 × 20' al 95-105 % | 0.88 |
| `BK_VO2` | bici | QUALITY | 1 | Build sprint/olímpico | 5 × 3-5' al 106-120 %, r = igual | 0.85 |
| `BK_RP70` | bici | QUALITY/LONG | 1 | Build 70.3 | 2-3 × 20-30' a IF 0.78-0.83 | 0.76 |
| `BK_RPIM` | bici | LONG | 1 | Build IM | 2-3 × 30-60' a IF 0.68-0.75 | 0.72 |
| `RN_REC` | carrera | RECOVERY | 0 | todas | 20-40' Z1 | 0.65 |
| `RN_EASY` | carrera | EASY | 0 | todas | 30-60' Z2 (+4-8 strides de 20") | 0.75 |
| `RN_LONG` | carrera | LONG | 1 (0.5 si < 75' e IF < 0.80) | Base/Build | 60-150' Z2 (en build, final a ritmo de carrera) | 0.78 |
| `RN_TEMPO` | carrera | QUALITY | 1 | Base 2+ | 2-3 × 10-15' Z3 | 0.85 |
| `RN_THR` | carrera | QUALITY | 1 | Build | 4-5 × 5-8' Z4, r1-2' | 0.90 |
| `RN_VO2` | carrera | QUALITY | 1 | Build sprint/olímpico/10k | 5-6 × 3' Z5b, r2-3' | 0.88 |
| `RN_HILLS` | carrera | QUALITY | 1 | Base 3 / Build 1 | 6-10 × 60-90" en cuesta Z4-Z5 | 0.85 |
| `BRICK` | bici+carrera | BRICK | 1.5 | Build/Peak (Base: corto opcional) | `BK_*` + `RN_OFFBIKE` 10-45' (Z2 o ritmo de carrera) | — |
| `ST_HEAVY` | fuerza | QUALITY (muscular) | 0.5 | Base | 40-50': 3-4 × 4-6 reps (≥ 80 % de 1RM) de sentadilla, peso muerto rumano, step-up, gemelo | — |
| `ST_MAINT` | fuerza | EASY | 0.25 | Build/Peak | 25-35': 2 × 4-6 pesado o pliometría ligera | — |
| `MOB` | movilidad | RECOVERY | 0 | todas | 15-20' | — |
| `OTHER_*` | otro deporte | OTHER_HARD/ENDURANCE | §11.4 | — | registrado | §11.4 |
| `RACE_*` | competición | RACE | 3 | — | — | §2.3 |

**Prioridad base (1 = la más protegida)** según la distancia, usada en §11.2:

| Sesión | 70.3 / IM | Sprint / olímpico | Carrera a pie |
|---|---|---|---|
| `BK_LONG` / `BK_RP*` | 1 | 3 | — |
| `RN_LONG` | 1 | 2 | 1 |
| `BRICK` (build/peak) | 2 | 2 | — |
| 1.ª QUALITY del limiter | 2 | 1 | 1 (`RN_THR`/`RN_VO2`) |
| 2.ª QUALITY | 3 | 2 | 2 |
| `SW_CSS` / `SW_END` | 4 (3 si la natación es el limiter) | 3 | — |
| `ST_HEAVY` (base) | 4 | 4 | 4 |
| `ST_MAINT` (build) | 6 | 6 | 5 |
| `*_END` de apoyo | 5 | 5 | 5 |
| `*_REC`, `SW_TECH` extra, 3.ª/4.ª natación | 7 | 7 | 7 |

---

## 10. Distribución de la semana (colocación)

### 10.1 Puntos de dureza ("hardPoints") por día

`hardPoints(día) = Σ hardPoints(sesiones)`, con QUALITY bici/carrera = 1, LONG = 1, BRICK = 1.5, QUALITY natación = 0.5, `ST_HEAVY` = 0.5, `ST_MAINT` = 0.25, OTHER (ENDURANCE) = 0.5, OTHER_HARD = 1-1.5 y RACE = 3. Un **día duro** es el que tiene `hardPoints ≥ 1`. [H]

**Escalado de las largas** [H]: `RN_LONG` cuenta 1 si `durationMin ≥ 75` o IF ≥ 0.80; si no, 0.5. `BK_LONG` cuenta 1 si `durationMin ≥ 150` o IF ≥ 0.75; si no, 0.5. Así una "larga" de base en distancias cortas no bloquea el día siguiente.

### 10.2 Restricciones duras (no se pueden violar)

| ID | Regla | Etiqueta |
|---|---|---|
| `L01` | Máximo 2 sesiones por día (3 si una es `MOB` o fuerza de ≤ 30'). Si hay 2 sesiones clave el mismo día, separarlas ≥ 4 h | [H] |
| `L02` | **No hay dos días duros seguidos**, salvo la excepción `BIG_WEEKEND`: `BK_LONG`/`BRICK` + `RN_LONG` en días consecutivos **solo** en 70.3/IM, build, nivel ≥ intermedio, con la carrera larga en Z1-Z2 y el día siguiente REST/EASY. Máximo 1 por semana | [C cualitativo: alternar duro y suave / H] |
| `L03` | Después de 2 días duros seguidos (o de un día con `hardPoints ≥ 2`), el día siguiente debe tener `hardPoints = 0` | [H] |
| `L04` | ≥ 48 h entre sesiones QUALITY o LONG de **carrera** | [H] |
| `L05` | ≥ 1 día de descanso total por semana si las horas son ≤ 12 o el nivel es principiante. Si no, ≥ 1 día con ≤ 60' en Z1 | [H] |
| `L06` | La sesión tiene que caber en una ventana libre del calendario, contando los márgenes (piscina +30', exterior +15'). Bici larga en exterior: ventana con luz (`daylight`), si no, rodillo con su tope | [H] |
| `L07` | `ST_HEAVY` no puede ir en las 24 h previas a un `RN_LONG`, `RN_THR`/`RN_VO2`, `BRICK` o `BK_LONG`, ni en los 7 días previos a una carrera A | [H] |
| `L08` | Número de días duros por semana: 5-7 h → ≤ 3; 8-12 h → ≤ 4; > 12 h → ≤ 4 (5 si es avanzado) | [H] |
| `L09` | QUALITY bici + carrera por semana ≤ el límite de la fase (§2.2) | [H] |
| `L10` | Regla de Frandsen para la carrera (§6.3) y rampa de CTL (§4.2) | [E]/[C] |
| `L11` | TSB proyectado ≥ −30 todos los días | [C] |
| `L12` | Las restricciones de lesión, enfermedad o viaje activas (§11) se imponen a todo lo demás | [H, seguridad] |

### 10.3 Preferencias blandas (penalización con peso; menor = mejor)

| ID | Preferencia | Peso |
|---|---|---|
| `S01` | `BK_LONG`/`BRICK` en el día con la ventana más larga (habitualmente sábado) | 8 |
| `S02` | `RN_LONG` separado ≥ 1 día de `BK_LONG` (salvo `BIG_WEEKEND` aceptado) | 5 |
| `S03` | El día siguiente a un día duro: natación o bici suave (bajo impacto) mejor que correr | 4 |
| `S04` | Las QUALITY después de un día REST o EASY | 4 |
| `S05` | En build 70.3/IM, 1 `BRICK` por semana; en build sprint/olímpico, 1 brick corto a ritmo de carrera; en base, una carrera opcional de 10-15' tras la bici larga | 6 |
| `S06` | No poner el mismo deporte (salvo natación) 3 días seguidos si es principiante | 3 |
| `S07` | Calidad por la mañana o en la franja preferida del usuario. Evitar QUALITY en las 3 h previas a la hora de dormir | 2 |
| `S08` | Fuerza pesada en un día duro, después de la sesión de resistencia (≥ 6 h después o justo detrás), o en un día suave que no preceda a una clave de piernas | 3 |
| `S09` | **Social:** bonificación si la sesión coincide con la ventana de un amigo que tiene una sesión compatible (mismo deporte y zona compatible ±1). Nunca se viola una regla dura por esto | −3 (bono) |
| `S10` | Día de descanso preferido del usuario (`prefs.restDay`, por defecto el lunes) | 5 |

### 10.4 Algoritmo de colocación

```ts
function placeWeek(sessions: PlannedSession[], avail: DayAvailability[], ctx: Ctx): WeekPlan {
  // 1) ordenar por prioridad (1 primero), y a igual prioridad por duración descendente
  const queue = [...sessions].sort((a, b) => a.priority - b.priority || b.durationMin - a.durationMin);
  const plan = emptyWeek(ctx);
  for (const s of queue) {
    const candidates = days(ctx.week)
      .flatMap(d => fittingSlots(d, s, avail))                    // L06
      .filter(slot => hardRulesOk(plan.with(s, slot), ctx));      // L01-L12
    if (candidates.length === 0) {
      const shorter = shrink(s, 0.75);                             // probar al 75 %, luego al 50 % si es prioridad ≤ 3
      if (shorter && tryPlace(shorter)) continue;
      plan.dropped.push({ s, reason: 'NO_SLOT' });                 // la IA o la UI ofrecen alternativas
      continue;
    }
    const best = minBy(candidates, slot => softPenalty(plan.with(s, slot), ctx));
    plan.add(s, best);
  }
  rebalanceLoad(plan, ctx);   // si la carga total < 90 % del objetivo: alargar *_END/*_LONG dentro de los límites
  return validateOrRepair(plan, ctx);                              // reparación local: intercambiar 2 días, máx. 50 iteraciones
}
```

Es determinista: mismo input ⇒ mismo output (orden estable, desempates por fecha y por `typeCode`). Complejidad baja (≤ 15 sesiones × 7 días × pocas ventanas).

### 10.5 Plantillas de referencia (el motor no las copia: son casos de test esperados)

**70.3 · build · 10 h · lunes de descanso, clases por la mañana entre semana**

| Día | Sesión 1 | Sesión 2 | hardPoints |
|---|---|---|---|
| Lun | Descanso | — | 0 |
| Mar | `BK_THR` 75' | `SW_CSS` 50' | 1.5 |
| Mié | `RN_EASY` 45' + strides | `SW_END` 45' | 0 |
| Jue | `RN_THR` 55' | `ST_MAINT` 30' | 1.25 |
| Vie | `SW_TECH` 40' o descanso | — | 0 |
| Sáb | `BRICK`: `BK_RP70` 2:30 + carrera 30' | — | 1.5 |
| Dom | `RN_LONG` 1:30 Z2 (`BIG_WEEKEND`) | — | 1 |

**Olímpico · base · 8 h**

| Día | Sesión 1 | Sesión 2 | hardPoints |
|---|---|---|---|
| Lun | Descanso | — | 0 |
| Mar | `RN_TEMPO` 45' | `SW_TECH` 40' | 1 |
| Mié | `BK_END` 60' | `ST_HEAVY` 40' | 0.5 |
| Jue | `BK_TEMPO` 60' | `SW_END` 45' | 1 |
| Vie | `RN_EASY` 35' | — | 0 |
| Sáb | `BK_LONG` 2:00 Z2 (+10' de carrera opcional) | — | 0.5 (escalado §10.1) |
| Dom | `RN_LONG` 70' Z2 | — | 0.5 (escalado §10.1) |

Caso de test: gracias al escalado de §10.1, el sábado y el domingo **no** son días duros en esta semana de base de olímpico, así que no hace falta `BIG_WEEKEND`. Si las entradas suben la bici a ≥ 2:30 **y** la carrera a ≥ 75', ambos días cuentan 1 punto y se viola `L02` (en olímpico no hay `BIG_WEEKEND`). Salida esperada: se acorta la sesión de menor prioridad para olímpico (`BK_LONG`, prioridad 3, frente a `RN_LONG`, prioridad 2) hasta 2:20, de modo que cuenta 0.5, y se registra el `reasonCode` `HARD_DAYS_ADJACENT`.

---

## 11. Re-planificación ante imprevistos

### 11.1 Principios generales

1. **No recuperar a la fuerza.** Nunca se suma volumen perdido a otro día si eso crea dos días duros seguidos o un día con más de 1.2 × su carga planificada. [C entre entrenadores: [Tri247](https://www.tri247.com/guides/stay-on-track-after-missing-workout), [running.COACH 2025](https://blog.runningcoach.me/en/2025/08/08/missed-a-workout-how-to-deal-with-deviations-from-your-plan/)]
2. **Proteger lo clave, sacrificar lo accesorio** (prioridades de §9).
3. **Horizonte:** solo se re-planifican los días restantes de la semana en curso. La semana siguiente se regenera el domingo a las 20:00 (hora local) con los datos nuevos. El macrociclo solo se recalcula ante ausencias de ≥ 14 días, una lesión o enfermedad de más de 7 días, o un cambio de carreras.
4. **Seguridad por encima del rendimiento:** las reglas de lesión y enfermedad no se pueden anular, ni siquiera desde la IA.
5. **Explicabilidad:** cada cambio genera un `PlanDiff` con su `reasonCode` y un texto corto para la notificación.
6. **Cumplimiento** (como en TrainingPeaks): verde si la carga real está entre el 80 y el 120 % de la planificada, amarillo entre el 50-79 % o el 121-150 %, naranja por debajo del 50 % o por encima del 150 %, y rojo si no se hizo. Una sesión cuenta como hecha si es del mismo deporte, el mismo día (±1 si el usuario la mueve) y con una duración de ±50 %. [H]

### 11.2 Sesión no realizada (missed)

```ts
function onMissed(s: PlannedSession, st: State): PlanDiff {
  if (s.priority >= 5) return drop(s, 'MISSED_LOW_PRIORITY');                 // M2: las suaves no se recuperan
  if (inRaceWeek(s) || inRecoveryWeek(s)) return drop(s, 'MISSED_NO_CARRY');  // M8
  const window = s.cls === 'LONG' || s.cls === 'BRICK' ? 2 : 3;               // M3: largas ±1-2 días, intervalos ±2-3
  for (const d of nextDays(s.date, window)) {
    // intercambiar con una sesión suave de ese día en lugar de añadir encima
    const swapTarget = st.plan.sessionsOn(d).find(x => x.priority >= 5);
    const candidate = swapTarget ? st.plan.replace(swapTarget, s.movedTo(d)) : st.plan.add(s.movedTo(d));
    if (hardRulesOk(candidate) && !createsBackToBackHard(candidate)) return candidate.diff('MISSED_MOVED');
  }
  const shorter = shrink(s, 0.6);                                              // M4: versión al 60 %
  if (shorter && placeIntoEasySlot(shorter)) return diff('MISSED_SHORTENED');
  if (s.cls === 'LONG' && missedLongTwoWeeksInARow(st)) flag('LONG_MISSED_TWICE'); // aviso a la IA y al usuario
  return drop(s, 'MISSED_DROPPED');
}
```

Ausencias largas sin enfermedad ni lesión [H, consistente con [Active](https://www.active.com/triathlon/articles/ask-a-coach-what-should-i-do-if-i-miss-a-workout)]:

| Días sin entrenar | Acción |
|---|---|
| 1-2 | Nada (seguir el plan. Si la sesión perdida era clave, aplicar M3) |
| 3-6 | El primer día de vuelta es EASY. El resto de la semana, al 80 % del volumen, con 1 QUALITY como mucho |
| 7-13 | La semana de vuelta es tipo recuperación (70-80 %). La intensidad solo después de 3 sesiones suaves toleradas. La fase no cambia |
| ≥ 14 | Recalcular el PMC y el macrociclo (§5.2). Si la carrera A está a menos de 6 semanas, comprimir el build y avisar. Aplicar también la regla del 10 % de Frandsen respecto a los últimos 30 días |

### 11.3 Cambio de disponibilidad (calendario)
- Si una ventana desaparece, se re-coloca la sesión con el algoritmo de §10.4 **solo en los días restantes**. Si no cabe, se acorta (75 % → 50 %) o se descarta según su prioridad.
- Si aparece una ventana nueva, **no se añade carga automáticamente**. Se sugiere mover ahí una sesión pendiente si eso mejora la penalización blanda.

### 11.4 Otro deporte no planificado (pádel, fútbol…)

Datos:
- Pádel amateur: FC media ≈ 130 lpm, pico ≈ 155, ≈ 90 % del tiempo en zona aeróbica ([estudio de carga interna en pádel amateur](https://portalcientifico.upsa.es/documentos/5da9982e2999527bba1802ef)). Con jugadores de nivel nacional, la FC y el lactato son comparables a los del tenis ([Frontiers 2025](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2025.1540424/pdf)). [E]
- Fútbol en competición: ≈ 88 % de la FCmax de media (sub-20) ([RBEFE](https://revistas.usp.br/rbefe/article/view/170067)). Daño muscular y fatiga neuromuscular de hasta **72-96 h** después de un partido ([Frontiers Physiol 2019](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2019.00689/pdf)). [E, sobre todo en élite]

**Tabla de estimación** (si no hay datos de FC de Garmin; si los hay, se usa hrTSS) [H]:

| Deporte | RPE típico | IF estimado | Carga/h | Clase | `neuromuscularLoad` (0-3) | Restricción posterior |
|---|---|---|---|---|---|---|
| Pádel recreativo (dobles) | 5-7 | 0.70-0.80 | 55 | ENDURANCE (OTHER_HARD si dura > 90' o RPE ≥ 8) | 2 (cambios de dirección; gemelo, Aquiles, hombro) | +24 h: sin QUALITY ni LONG de carrera |
| Fútbol 11 (partido) | 7-9 | 0.85-0.90 | 78 | OTHER_HARD (1.5) | 3 (sprints, contacto, excéntrico) | +24 h: sin carrera (natación o bici en Z1-Z2 sí). +48 h: sin QUALITY ni LONG de carrera. +72 h: aviso si hay QUALITY de carrera |
| Fútbol 7 / sala | 7-8 | 0.82-0.88 | 72 | OTHER_HARD (1) | 3 | Igual que fútbol 11, pero 48 h |
| Tenis | 5-7 | 0.70-0.80 | 55 | ENDURANCE / OTHER_HARD | 2 | +24 h: sin QUALITY de carrera |
| Baloncesto | 7-8 | 0.80-0.88 | 70 | OTHER_HARD (1) | 3 (saltos) | 48 h sin QUALITY ni LONG de carrera |
| Clase HIIT / crossfit | 7-9 | 0.82-0.90 | 72 | OTHER_HARD (1) | 2-3 | 24-48 h sin QUALITY de piernas |
| Senderismo / montaña | 3-5 | 0.60-0.70 | 45 (+10 por cada 500 m D+) | ENDURANCE (LONG si dura > 3 h) | 2 si hay bajadas largas | +24 h: sin QUALITY de carrera |
| Escalada / boulder | 4-6 | 0.55-0.65 | 35 | ENDURANCE | 1 (tren superior) | +24 h: natación suave |
| Surf / remo / kayak | 4-6 | 0.60-0.70 | 45 | ENDURANCE | 1 (hombro) | Natación: sin palas en 24 h |
| Esquí | 4-6 | 0.60-0.70 | 45 | ENDURANCE | 2 (cuádriceps) | +24 h: sin QUALITY de carrera |

Ajuste por RPE declarado: `IF = clamp(RPE_TO_IF[rpe], IF_min_del_deporte − 0.05, IF_max + 0.05)`.

**Reglas** [H]:

```ts
function onUnplannedActivity(a: Activity, st: State): PlanDiff {
  const load = estimateLoad(a);                          // §3: FC > RPE > tabla
  const cls = classifyOther(a);                          // ENDURANCE | OTHER_HARD
  const nm = NEURO_LOAD[a.kind] ?? 1;
  // U2: el mismo día, si había sesiones planificadas pendientes
  for (const s of st.plan.pendingOn(a.date)) {
    if (s.cls === 'QUALITY' || s.cls === 'LONG' || s.cls === 'BRICK') {
      // se intenta mover con la lógica de missed (M3). Si no se puede: convertir a EASY ≤ 45' (mejor natación) o descartar
      moveOrDowngrade(s, 'OTHER_SPORT_SAME_DAY');
    } else if (dayLoad(a.date) + s.plannedLoad > 1.2 * plannedDayLoad(a.date)) drop(s, 'OTHER_SPORT_LOAD_CAP');
  }
  // U3: bloqueos posteriores según neuromuscularLoad
  applyLockouts(a, nm);                                  // ver la tabla: sin QUALITY o LONG de carrera durante 24/48/72 h
  // U4: control de la carga semanal
  const projected = st.week.doneLoad + load + st.week.pendingLoad;
  if (projected > 1.10 * st.week.targetLoad) dropLowestPriorityUntil(1.05 * st.week.targetLoad, { minPriority: 5 });
  if (projectedTSBmin(st) < -25) dropLowestPriorityUntilTSB(-25, { minPriority: 3 });
  return diff('OTHER_SPORT_REPLAN');
}
```

- **U5 · Deporte recurrente** (por ejemplo, pádel todos los miércoles o fútbol los domingos): el usuario lo marca como fijo. Pasa a ser un bloque `OTHER_*` de la plantilla, cuenta para `L08` (días duros) y para la carga semanal, y **reduce en 1 el número de QUALITY** de la semana si es OTHER_HARD. El reparto por deportes de §7 se calcula sobre las horas que quedan.
- **U6 · Taper o semana de carrera:** aviso de riesgo de lesión ("¿Seguro? Faltan 5 días para tu carrera A"), sin bloqueo.
- **U7 · Actividad planificada hecha mucho más dura** (cumplimiento > 150 % o una clase superior a la prevista): se trata como no planificada en la parte que excede.

### 11.5 Lesiones por zona del cuerpo

> **Aviso de seguridad (se muestra siempre en el flujo de lesión):** «Esto es una ayuda para organizar tu entrenamiento, no un diagnóstico. Si el dolor es intenso, va a más, no mejora en 7-10 días o aparece alguna señal de alarma, para y consulta a un médico o fisioterapeuta. No entrenes con dolor que te haga cojear o cambiar el gesto.»

**Triaje común** [H, conservador]:

| Estado | Condición | Acción del motor |
|---|---|---|
| **ROJO** | Cualquier señal de alarma de la tabla por zona, dolor ≥ 7/10, inicio súbito con chasquido, hinchazón visible, no poder apoyar, cojera, dolor nocturno o en reposo, hormigueo o pérdida de fuerza | Bloquear **todos** los deportes que carguen la zona y toda la intensidad. Solo se permite descanso o movilidad de zonas no afectadas. Mostrar "consulta a un profesional". **La vuelta no es automática**: el usuario tiene que confirmar el alta o la mejoría |
| **ÁMBAR** | Dolor de 4-6/10 al entrenar o en la vida diaria, o dolor que empeora a la mañana siguiente | Parar el deporte afectado ≥ 3 días. Sustituirlo por deportes permitidos **solo en EASY/ENDURANCE**. Reevaluar cada día con un check-in (dolor 0-10). Si pasan 7 días sin mejorar, recomendación profesional destacada y progresión congelada |
| **VERDE** | Dolor ≤ 3/10 durante la actividad, que no empeora a la mañana siguiente y sin señales de alarma | Mantener el deporte con volumen −30 % y sin QUALITY de ese deporte 1 semana. Check-in diario. Los deportes permitidos siguen normales |

Referencia: el modelo de monitorización del dolor de Silbernagel para tendinopatía aquilea admite hasta 5/10 con supervisión profesional. La app usa ≤ 3/10 por ser una herramienta sin supervisión. [E/H]

**Tabla por zona** [H; principios generales de fisioterapia deportiva, sin diagnóstico]:

| Zona | Suele tolerarse (si no duele) | Evitar | Notas de sustitución | Señales de alarma → profesional o urgencias |
|---|---|---|---|---|
| **Rodilla** (anterior, cintilla iliotibial) | Natación con pull buoy, aquajogging, bici suave (cadencia alta, desarrollo blando) | Carrera (sobre todo bajadas), braza (patada), sentadilla profunda | Carrera → aquajogging 1:1 en tiempo o bici 1:1.3 | Hinchazón, bloqueo, fallos o inestabilidad, lesión por torsión o golpe |
| **Tobillo** (esguince) | Natación con pull buoy, fuerza de tren superior y core; bici cuando se pueda apoyar sin dolor | Carrera, pádel, fútbol, cambios de dirección | Carrera → bici o aquajogging | No poder dar 4 pasos apoyando, dolor sobre el hueso (maléolos o base del 5.º metatarsiano), deformidad |
| **Aquiles** | Natación (patada suave, sin impulso fuerte en la pared), bici con carga moderada (sentado, sin escalar de pie) | Series, cuestas, sprints, pádel, fútbol, ir descalzo | Carrera → bici 1:1.3 o natación | Chasquido o "patada" súbita (posible rotura) → urgencias. Rigidez matinal que va a más, bulto doloroso |
| **Gemelo / sóleo** | Natación con pull buoy; bici suave tras 3-5 días si no duele | Carrera hasta poder caminar rápido y hacer 10 saltos a una pierna sin dolor | Carrera → natación o bici | Dolor súbito con hematoma. **Pantorrilla hinchada, caliente o enrojecida (posible trombosis) → urgencias** |
| **Espinilla** (periostitis o posible fractura por estrés) | Natación, bici, aquajogging | Carrera, saltos, pádel y fútbol | Carrera → aquajogging 1:1 | **Dolor localizado en un punto del hueso, dolor en reposo o por la noche** → posible fractura por estrés: médico; sin carrera |
| **Cadera / ingle** | Natación con pull buoy (sin patada fuerte ni braza), bici en posición menos agresiva si no duele | Carrera, sprints, braza. Aquajogging con precaución (puede irritar los flexores) | Carrera → bici o natación | **Dolor inguinal profundo al cargar peso (posible fractura por estrés del cuello del fémur) → médico urgente**; dolor nocturno |
| **Zona lumbar** | Caminar, crol suave, bici en posición erguida (sin acoples), core suave | Acoples aero largos, peso muerto pesado, mariposa o braza en hiperextensión; correr si aumenta el dolor | Bici con acoples → bici erguida o rodillo | **Dolor que baja por debajo de la rodilla con hormigueo o debilidad, pérdida de control de esfínteres o anestesia en la zona genital → urgencias**; fiebre; tras una caída |
| **Hombro** | Carrera, bici (sin acoples si duele), patada con aletas (brazos pegados al cuerpo), fuerza de tren inferior | Volumen de crol, palas, pádel o tenis, press por encima de la cabeza | Natación → bici o carrera de igual tiempo (aplicando la regla de Frandsen a la carrera) | Pérdida de fuerza, sensación de luxación, dolor nocturno persistente, tras una caída |
| **Fascia plantar / pie** | Natación, bici (si la presión en el pedal no duele), aquajogging | Carrera, ir descalzo, saltos | Carrera → aquajogging o natación | Dolor en un punto de un metatarsiano (posible fractura por estrés), hinchazón del dorso del pie |
| **Isquiotibial** | Natación (patada suave), bici suave si no duele | Sprints, cuestas, series de carrera | Carrera → natación o bici Z1-Z2 | Dolor súbito con chasquido o hematoma |
| **Muñeca / codo** (típico del pádel) | Carrera, bici (si el apoyo en el manillar se tolera) | Pádel o tenis, palas, fuerza de agarre | — | Deformidad, pérdida de fuerza, hormigueo |

Fuentes sobre el entrenamiento cruzado: el aquajogging es el sustituto más parecido a correr y puede mantener la forma de carrera unas 4-6 semanas ([Outside](https://www.outsideonline.com/running/training/injury-prevention/aqua-jogging-for-injured-runners/)). Puede agravar lesiones del flexor de cadera, y para Aquiles y espinilla la reintroducción del impacto es crítica ([RunnersConnect](https://runnersconnect.net/aqua-jogging-vs-elliptical/)). [E]

**Conversión al sustituir** [H]: carrera → aquajogging 1:1 en tiempo (misma zona por RPE, no por FC, porque en el agua la FC es menor); carrera → bici 1:1.3 en tiempo; carrera → elíptica 1:1; natación → bici o carrera 1:1. Al sustituir no se mantiene la QUALITY del deporte afectado en el sustituto si el triaje es ÁMBAR.

**Vuelta a correr** (tras ÁMBAR o ROJO con el alta del usuario) [H, criterios clínicos habituales]:
1. Requisitos: caminar 30' sin dolor, 10 saltos a una pierna sin dolor y dolor ≤ 2/10 al día siguiente.
2. Caminar y correr alternando: 1' corriendo + 1' andando × 10, en días alternos. Si a las 24 h el dolor sigue ≤ 2/10, avanzar a 2:1, 4:1 y luego 10' seguidos...
3. Volumen inicial del 30-50 % del previo a la lesión. Después, la regla del 10 % sobre la sesión más larga **posterior a la lesión** (Frandsen se aplica sobre la ventana de 30 días real, que incluye la lesión). La intensidad, a partir de ≥ 2 semanas corriendo sin síntomas.

### 11.6 Enfermedad

- **"Neck check"** (triaje, no permiso): con síntomas **solo por encima del cuello** (rinorrea, congestión, estornudos, dolor de garganta leve) y **sin fiebre**, se permite entrenar suave. Con síntomas **por debajo del cuello** (tos de pecho, opresión, dolor muscular generalizado, vómitos o diarrea) o con **fiebre**, nada de ejercicio ([Harvard/MEEI](https://face.meei.harvard.edu/common-cold-and-exercise), [guía clínica de 2026](https://nextclinic.com.au/blog/can-you-exercise-with-a-cold-the-neck-check-rule)). [H] El consenso del COI de 2022 recuerda que esta regla **no tiene base científica** y propone una vuelta gradual tras resolverse los síntomas ([BJSM 2022](https://bjsm.bmj.com/content/early/2022/07/21/bjsports-2022-105759)). Las infecciones respiratorias de los deportistas duran unos 7 días de media ([Snyders et al. 2022](https://bjsm.bmj.com/content/early/2021/12/15/bjsports-2021-104719)). [C]
- El riesgo principal es la **miocarditis**. Tras una miocarditis sospechada o confirmada, sin deporte intenso durante 3-6 meses y con evaluación médica ([PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11475062/), [World Triathlon](https://triathlon.org/uploads/docs/RETURN_TO_PLAY_AFTER_COVID_20220915.pdf)). [C]

**Reglas del motor:**

| ID | Condición | Acción |
|---|---|---|
| `IL1` | Solo síntomas por encima del cuello, sin fiebre | Hoy: sesiones ≤ EASY, ≤ Z2 y ≤ 50-60 % de la duración planificada. Sin QUALITY ni LONG. Si empeora durante la sesión, parar. Reevaluar al día siguiente [H] |
| `IL2` | Síntomas por debajo del cuello o fiebre ≥ 37.8 °C (o el usuario dice "tengo fiebre") | **Ningún entrenamiento**. Se cancela todo hasta 24 h sin fiebre (sin antitérmicos) y sin síntomas por debajo del cuello [H, umbral conservador; las fuentes dan entre 38 y 38.3 °C] |
| `IL3` | Gastrointestinal (vómitos o diarrea) | Sin entrenamiento hasta ≥ 24 h sin síntomas. Primero, hidratación. Después, como `IL4` |
| `IL4` | Vuelta tras `IL2`/`IL3` | Tantos días de vuelta progresiva como días de enfermedad (mínimo 2, máximo 10): fase 1 (≈ 1/3 de los días) al 50 % del volumen en Z1-Z2; fase 2 al 75 % en Z1-Z2; fase 3 con la intensidad recuperada si la FC de reposo está a ≤ 3 lpm de la línea base y la readiness ≥ 50 [H] |
| `IL5` | **Señales cardiacas**: dolor torácico, palpitaciones, falta de aire desproporcionada, mareo o síncope, FC anormalmente alta a ritmo suave | **Parar todo + mensaje: "consulta a un médico, idealmente un cardiólogo, antes de volver a entrenar".** Bloqueo hasta que el usuario confirme la valoración médica [C] |
| `IL6` | Enfermedad de más de 7 días | Recalcular el PMC y avisar si la carrera A está a menos de 4 semanas. La semana de vuelta cuenta como recuperación (reinicia el ciclo 3:1) |
| `IL7` | Gripe o COVID confirmados | `IL2` + `IL4`, con un mínimo de 7 días de vuelta progresiva y el aviso `IL5` visible [H, según la línea de World Triathlon] |

### 11.7 Mal sueño, estrés alto o pico de trabajo

Evidencia: la privación de sueño tiene un efecto negativo moderado sobre el rendimiento de resistencia, mayor en esfuerzos de más de 30 minutos, y sube el esfuerzo percibido ([metaanálisis de 2022](https://lida.sport-iat.de/ta/Record/4082963?lng=en); [revisión de 2025 con 45 estudios](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11996801/)). **Ninguna fuente fija un porcentaje de reducción**: los números de abajo son [H].

| ID | Condición | Acción |
|---|---|---|
| `SL1` | 1 noche con < 6 h de sueño o `sleepScore` < 60 | Si hoy toca una QUALITY: se mantiene si la readiness ≥ 50 y el usuario dice estar bien; si no, se reduce el trabajo de los intervalos un 30 % o se **intercambia** con el siguiente día EASY (si las reglas duras lo permiten). Las sesiones EASY no cambian |
| `SL2` | ≥ 2 noches seguidas con < 6 h | QUALITY → EASY. Volumen del día −20 %. LONG −25 % |
| `SL3` | Media de 7 días < 6.5 h | Volumen semanal −15 %, QUALITY ≤ 1-2. Rampa −2 |
| `ST1` | Estrés subjetivo ≥ 4/5 o estrés medio de Garmin > 50 durante ≥ 2 días | Volumen −20 % y QUALITY −1 en lo que queda de semana |
| `ST2` | El usuario declara "semana de pico de trabajo o exámenes" | Opción A (por defecto): volumen semanal −30-40 %, conservando como mucho 1 LONG y 1 QUALITY (las de prioridad 1-2). Opción B: si la recuperación prevista cae a ≤ 2 semanas, **adelantarla** a esta semana y reiniciar el 3:1. La rampa baja 2 puntos durante el periodo declarado (Friel) |
| `ST3` | Viaje de trabajo o turnos | §11.9 |

### 11.8 Ajustes por HRV, FC de reposo y readiness

Datos de Garmin (son enumeraciones; no inventamos umbrales nuevos encima):
- **Training Readiness:** 95-100 Prime, 75-94 High, 50-74 Moderate, 25-49 Low, 1-24 Poor. Se calcula con el sueño, el tiempo de recuperación, el estado de la HRV, la carga aguda y el historial de sueño y estrés ([manual de Garmin](https://www8.garmin.com/manuals/webhelp/GUID-31D23DBB-57C2-4DF7-A0C9-8D1A00AB4BE7/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html)). [C]
- **HRV Status:** *Balanced* (la media de 7 días está dentro de la línea base), *Unbalanced* (por encima o por debajo), *Low* (muy por debajo de la línea base), *Poor* (muy por debajo de la norma para la edad). Necesita unas 3 semanas de datos ([manual de Garmin](https://www8.garmin.com/manuals/webhelp/GUID-4462687B-8DF5-4719-872E-E16754F9D4B0/EN-US/GUID-5247CEC7-AF06-44FB-B6AD-87C53D4F7941.html)). [C]
- **FC de reposo:** unos 5 lpm por encima de la media suelen indicar necesidad de recuperación. Si se mantiene semanas, puede apuntar a sobreentrenamiento o enfermedad. No hay que decidir por una sola lectura ([TP](https://www.trainingpeaks.com/blog/the-4-signs-of-overtraining)). [E]
- **Entrenamiento guiado por HRV:** se entrena duro si la media móvil de 7 días del RMSSD (o del lnRMSSD) está dentro del *smallest worthwhile change* (SWC) individual, y suave si está fuera ([Jyväskylä](https://jyx.jyu.fi/handle/123456789/45036)). La ventaja frente a un plan fijo está sobre todo en que **hay menos personas que empeoran** ([TP](https://trainingpeaks.com/blog/new-study-widens-hrv-evidence-for-more-athletes)). [E]

**Semáforo combinado** (se calcula cada mañana tras sincronizar; si falta un dato, se ignora esa señal) [H]:

```ts
type Readiness = 'GREEN' | 'GREEN_NOTE' | 'AMBER' | 'RED';
function readiness(w: DailyWellness, prev: DailyWellness | undefined, base: Baselines): Readiness {
  const dRHR = w.restingHr != null ? w.restingHr - base.rhrMedian30 : 0;      // contra la mediana de 30 días
  const dRHRprev = prev?.restingHr != null ? prev.restingHr - base.rhrMedian30 : 0;
  const ln7 = base.lnRmssdRoll7;                                              // media móvil de 7 días de ln(RMSSD nocturno)
  const below = base.lnRmssd60 && ln7 != null ? ln7 < base.lnRmssd60.mean - 0.5 * base.lnRmssd60.sd : false; // fuera del SWC por abajo
  const red =
    (w.trainingReadiness ?? 100) < 25 ||
    w.hrvStatus === 'low' || w.hrvStatus === 'poor' ||
    dRHR >= 8 || (dRHR >= 5 && dRHRprev >= 5) ||
    (w.subjective?.fatigue ?? 0) >= 5 || base.activeIllness;
  if (red) return 'RED';
  const amberSignals = [
    (w.trainingReadiness ?? 100) < 50,
    w.hrvStatus === 'unbalanced' && below,                                    // desequilibrio por debajo
    !w.hrvStatus && below,                                                    // si no hay estado de Garmin, se usa el SWC propio
    dRHR >= 5,
    (w.sleepMinutes ?? 480) < 360 || (w.sleepScore ?? 100) < 60,
    (w.subjective?.fatigue ?? 0) >= 4 || (w.subjective?.soreness ?? 0) >= 4,
  ].filter(Boolean).length;
  return amberSignals >= 2 ? 'AMBER' : amberSignals === 1 ? 'GREEN_NOTE' : 'GREEN';
}
// Notas: 'poor' es una comparación con la norma por edad. Si un usuario está siempre en 'poor' (≥ 14 días),
// deja de contar como RED y pasa a ser una señal AMBER (si no, el semáforo quedaría bloqueado para siempre). [H]
```

| Semáforo | Acción sobre el día | Acción acumulada |
|---|---|---|
| GREEN | Según el plan | — |
| GREEN + nota (1 señal) | Según el plan. Notificación suave: "Hoy tu HRV está algo baja; si te notas cansado, puedes cambiarla" (con botón de 1 toque para aplicar el cambio de AMBER) | — |
| AMBER (≥ 2 señales) | QUALITY: trabajo de los intervalos −25-50 % **o** intercambio con un EASY de los 2 días siguientes. LONG: −20 % y solo Z1-Z2. EASY: sin cambio | 3 días AMBER en 5 → semana −15 % |
| RED | Hoy: descanso o EASY ≤ 45' en Z1 (mejor natación o bici). Se cancela cualquier QUALITY, LONG o BRICK (se intenta moverla con M3) | ≥ 3 días RED en 7 → mini-bloque de 3 días suaves y check-in ("¿estás enfermo o lesionado?") |

Reglas adicionales [H]:
- **Nunca se sube la intensidad automáticamente** por una readiness alta. Como mucho, se ofrece **adelantar** una QUALITY de la semana si cumple las reglas duras.
- *Unbalanced* por **encima** de la línea base no penaliza por sí solo (algunos atletas muestran HRV alta con fatiga, por saturación parasimpática). Solo se tiene en cuenta si va con FC de reposo alta o fatiga subjetiva ≥ 4.
- Antifatiga de notificaciones: como mucho 1 notificación de readiness al día, a la hora de despertar más 30'.

### 11.9 Viajes

| ID | Condición | Acción |
|---|---|---|
| `T1` | Día de viaje (vuelo > 3 h o coche > 4 h) | Descanso o EASY ≤ 45' (mejor estirar las piernas al llegar). Sin QUALITY ni LONG. La sesión clave afectada se mueve con M3 [H] |
| `T2` | Desfase de ≥ 3 husos horarios | Días de adaptación ≈ 1 por huso hacia el **este** y 0.5 por huso hacia el **oeste** (regla práctica; la evidencia viene sobre todo de población no deportista) ([Netball/guía práctica](https://netball.sport/wp-content/uploads/2024/05/Practical-tips-to-manage-travel-fatigue-and-jet-lag-in-athletes.pdf), [Aspetar](https://www.aspetar.com/journal/viewarticle.aspx?id=474)). Durante la primera mitad de la adaptación: sin QUALITY y con el volumen −20 %. Las sesiones, de día y con luz natural. Con < 3 husos, no hay ajuste [E/H] |
| `T3` | Sin bici | Bici → (a) bici estática del gimnasio o del hotel (misma duración y zona por RPE o FC); (b) si no hay, **un 50 % del tiempo** en carrera EASY respetando §6.3 (Frandsen y +15 % de minutos semanales), y el resto se descarta; (c) si no, descartar. **La carga de bici nunca se transfiere por completo a la carrera** [H] |
| `T4` | Sin piscina | Natación → fuerza con gomas o movilidad (30'), o aguas abiertas solo si se puede hacer acompañado y con seguridad [H] |
| `T5` | Solo hay tiempo para una sesión al día | Mantener la sesión de prioridad más alta de ese día [H] |
| `T6` | Altitud > 1500 m (por ejemplo, Sierra Nevada) | Los 2-3 primeros días, sin QUALITY. Usar FC o RPE en lugar de ritmo o potencia [H] |
| `T7` | Calor (temperatura prevista > 30 °C en la ventana de la sesión; frecuente en verano en España) | Proponer adelantar la sesión a primera hora. Las QUALITY de carrera, por FC o RPE en lugar de ritmo. Aviso de hidratación (§12) [H] |

---

## 12. Nutrición e hidratación: consejos para la app (no es consejo médico)

> **Aviso:** son pautas generales para deportistas sanos. No sustituyen a un dietista-nutricionista ni al médico. Si tienes diabetes, problemas digestivos, antecedentes de trastornos de la conducta alimentaria u otra condición médica, consulta a un profesional. La app **no** calcula dietas ni déficits calóricos.

Base: posicionamiento conjunto ACSM/AND/DC de 2016 (Thomas, Erdman & Burke, *MSSE* 48(3):543-568). Recuperación con 1.0-1.2 g/kg/h de hidratos durante las primeras horas y 0.25-0.3 g/kg de proteína ([resumen](https://www.myhealthcareer.com.au/dietetics/joint-position-statement-sport-nutritions); [ISSN nutrient timing](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5596471/)). Hidratos durante el ejercicio: 30-60 g/h en sesiones de 1-3 h, y hasta 90 g/h (mezcla de glucosa y fructosa) en más de 2.5-3 h. La evidencia de 2024-2026 apoya hasta 120 g/h en deportistas entrenados que han entrenado el intestino. Un único tipo de azúcar se absorbe a ≈ 60 g/h como máximo, y en triatletas de larga distancia el malestar gastrointestinal es muy frecuente ([Universidad de Birmingham 2026](https://www.birmingham.ac.uk/news/2026/fuelling-endurance-sport-the-carbohydrate-conundrum); [revisión de 2026](https://www.fisiologiadelejercicio.com/wp-content/uploads/2026/03/From-Metabolism-to-Medals.pdf); [TrainRight](https://trainright.com/how-many-carbohydrates-per-hour-on-the-bike/)). [C hasta 90 g/h; E para 90-120 g/h]

### 12.1 Por sesión (se muestra en la tarjeta de la sesión)

| Sesión | Antes | Durante | Después | Etiqueta |
|---|---|---|---|---|
| < 60' EASY | Comida normal; en ayunas también vale si te sienta bien (solo EASY) | Agua | Comida normal | [C/H] |
| < 60' QUALITY | Algo de hidratos 1-2 h antes (≈ 1 g/kg, por ejemplo tostada con miel o un plátano) | Agua (enjuague con bebida de hidratos opcional) | Comida con hidratos y 20-40 g de proteína en 1-2 h | [C] |
| 60-90' | 1-2 g/kg de hidratos 1-3 h antes | 0-30 g/h + 400-800 ml/h de líquido según el calor | Comida normal con proteína | [C/H] |
| 90'-2.5 h | 1-4 g/kg 1-4 h antes | **30-60 g/h** | Si hay otra sesión en < 8 h: 1.0-1.2 g/kg/h durante 4 h + 0.3 g/kg de proteína. Si no, comida normal en 1-2 h | [C] |
| > 2.5 h (bici larga, brick largo) | 1-4 g/kg 1-4 h antes | **60-90 g/h** (glucosa + fructosa). Hasta 90-120 g/h solo si ya lo has entrenado | Igual que arriba | [C]/[E] |
| Simulación de carrera (build y peak) | Igual que el día de carrera | **Practicar el plan de carrera** (marcas, cantidades, horarios) | — | [C] |
| 36-48 h antes de un 70.3 o IM | Carga de hidratos: 10-12 g/kg/día | — | — | [C] |

Fórmula de la pista: `carbsPerHour = durationMin < 60 ? 0 : durationMin < 90 ? '0-30' : durationMin <= 150 ? '30-60' : '60-90'`. Con `cls ∈ {QUALITY, BRICK}` y duración ≥ 75', se sube un tramo.

### 12.2 Diario (orientativo, en g/kg/día) [C]

| Día | Hidratos | Proteína |
|---|---|---|
| Ligero o descanso (baja intensidad, técnica) | 3-5 | 1.2-2.0 (repartida en 4-5 tomas de 0.3 g/kg) |
| Moderado (≈ 1 h) | 5-7 | 1.2-2.0 |
| Alto (1-3 h a intensidad moderada o alta) | 6-10 | 1.2-2.0 |
| Muy alto (> 4-5 h) | 8-12 | 1.2-2.0 |

El motor calcula el tipo de día con la carga y la duración planificadas y, si hay `weightKg`, muestra **rangos** en gramos. Sin peso, muestra solo el texto cualitativo.

### 12.3 Hidratación, sodio y cafeína
- Objetivo: no perder más del 2 % del peso corporal en la sesión. Pesarse antes y después de sesiones largas o con calor para conocer la tasa de sudor (ACSM). [C]
- Sodio en sesiones de más de 2 h o con calor: 300-600 mg/h como punto de partida; la variación individual es grande. [H]
- Cafeína: 3-6 mg/kg unos 60' antes de sesiones clave o de la competición, si se tolera. Evitarla por la tarde si perjudica el sueño (ISSN). [C]
- Nunca practicar algo nuevo el día de la carrera (pista fija en la semana de carrera). [C]

---

## 13. Pseudocódigo del flujo semanal completo

```ts
// Generación semanal (domingo a las 20:00 o a petición)
function generateWeek(athlete: AthleteProfile, races: Race[], history: Day[], avail: DayAvailability[], today: Date): WeekPlan {
  const pmc = computePMC(history);                                  // §4.1
  const macro = buildMacrocycle(today, nextA(races), ctxFrom(pmc));  // §5.2
  const wk = macro.weekOf(today);                                   // { phase, subphase, isRecovery, indexInBlock, taperFactor? }
  const Hpeak = peakHours(athlete, nextA(races).distance, avail);    // §6.2
  let H = Hpeak * PHASE_VOLUME[wk.subphase][distance];             // §6.2
  if (wk.isRecovery) H *= RECOVERY_FACTOR[athlete.cadence];        // §5.5
  if (wk.taperFactor) H = avgLast3BuildHours(history) * wk.taperFactor; // §5.4
  H *= lifeStressFactor(activeEvents);                             // §11.7
  // límite por rampa: la carga prevista no puede dar ΔCTL > rampTarget
  const rampTarget = rampFor(pmc.ctl, athlete.level, activeEvents);   // §4.2
  const maxLoad = 7 * (pmc.ctl + rampTarget / (1 - Math.exp(-7 / 42)));
  const split = sportSplit(wk.phase, distance, athlete.limiter, fixedOtherSports); // §7
  let sessions = allocateSessions(H, split, wk, athlete);          // §8 + §9 (tipos según la fase)
  sessions = capByLoad(sessions, maxLoad);                         // recorta las *_END y luego las LONG, hasta que load ≤ maxLoad
  sessions = applyRunGuards(sessions, history);                    // §6.3 (Frandsen, +15 % de minutos)
  sessions = applyActiveRestrictions(sessions, activeEvents);      // lesión, enfermedad, viaje (§11)
  const plan = placeWeek(sessions, avail, ctx);                    // §10.4
  plan.warnings.push(...projectTSB(plan, pmc).violations);          // L11
  return plan;
}

// Re-planificación por evento
function onEvent(e: PlanEvent, st: State): PlanDiff {
  const before = st.plan;
  const after = (() => { switch (e.type) {
    case 'missed': return onMissed(st.session(e.sessionId), st);           // §11.2
    case 'unplanned_activity': return onUnplannedActivity(e.activity, st); // §11.4
    case 'injury': return onInjury(e, st);                                 // §11.5
    case 'illness': return onIllness(e, st);                               // §11.6
    case 'life_stress': return onLifeStress(e, st);                        // §11.7
    case 'travel': return onTravel(e, st);                                 // §11.9
    case 'availability_change': return onAvailability(e, st);              // §11.3
  }})();
  const v = validate(after, st);                                           // reglas duras de §10.2 + seguridad
  const fixed = v.ok ? after : repairByDropping(after, v, { order: 'priorityDesc' });
  return diff(before, fixed);                                              // incluye reasonCodes y texto de la notificación
}

// Diario, tras sincronizar con Garmin (≈ 07:00 o al abrir la app)
function onMorningSync(w: DailyWellness, st: State) {
  const r = readiness(w, st.baselines);                                    // §11.8
  if (r !== 'GREEN') applyReadiness(r, st.plan.today(), st);               // AMBER o RED
  matchYesterdayActivities(st);                                            // cumplimiento + missed + no planificadas
}
```

### 13.1 Constantes (extracto de `rules.config.ts`)

```ts
export const RULES = {
  version: '2026.10-r1',
  pmc: { ctlTau: 42, atlTau: 7, tsbFloor: -30, tsbWarn: -20 },                                  // [C]
  ramp: { table: [{ maxCtl: 45, low: 3, mod: 6 }, { maxCtl: 70, low: 4, mod: 7 }, { maxCtl: Infinity, low: 5, mod: 8 }], hardCap: 8, lifeStressPenalty: 2 }, // [C]/[H]
  recovery: { cadenceDefault: '3:1', cadenceMasters: '2:1', mastersAge: 50, factor31: 0.60, factor21: 0.65 }, // [H]
  run: { singleSessionSpikeMax: 1.10, lookbackDays: 30, minFloorKm: 5, weeklyMinutesMaxGrowth: 1.15 },  // [E]/[H]
  bike: { longGrowthMax: 1.15, indoorLongCapMin: 150 },                                            // [H]
  tid: { minLowShare: 0.75 },                                                                     // [H]
  hardPoints: { QUALITY: 1, LONG: 1, LONG_SHORT: 0.5, BRICK: 1.5, SWIM_QUALITY: 0.5, ST_HEAVY: 0.5, ST_MAINT: 0.25, OTHER_ENDURANCE: 0.5, OTHER_HARD: 1, OTHER_HARD_FOOTBALL: 1.5, RACE: 3 },
  longScaling: { runFullMin: 75, runFullIF: 0.80, bikeFullMin: 150, bikeFullIF: 0.75 },        // [H]
  readiness: { trRed: 25, trAmber: 50, rhrAmber: 5, rhrRed: 8, hrvSwcSd: 0.5, sleepAmberMin: 360, sleepScoreAmber: 60 }, // [E]/[H]
  illness: { feverC: 37.8, aboveNeckDurationFactor: 0.55, afebrileHoursBeforeReturn: 24 },        // [H]
  injury: { greenMaxPain: 3, amberMaxPain: 6, amberRestDays: 3, escalateAfterDays: 7 },            // [H]
  travel: { eastDaysPerZone: 1, westDaysPerZone: 0.5, minZonesToAdjust: 3 },                      // [E]
  missed: { moveWindowLongDays: 2, moveWindowQualityDays: 3, shrinkFactor: 0.6, dayLoadCapFactor: 1.2 }, // [H]
};
```

---

## 14. Códigos de razón (contrato con la UI y la IA)

| Código | Texto corto de la UI (es) |
|---|---|
| `PHASE_BASE` / `PHASE_BUILD` / … | "Semana de base: construimos el motor aeróbico" |
| `RECOVERY_WEEK` | "Semana de descarga: asimilamos el trabajo" |
| `TAPER` | "Reducimos volumen y mantenemos la chispa para llegar fresco" |
| `RAMP_CAPPED` | "Hemos limitado la carga para no subir demasiado rápido" |
| `TSB_WARN` / `TSB_BLOCK` | "Acumulas mucha fatiga; esta semana no subimos más" |
| `RUN_SPIKE_CAPPED` | "Tu tirada larga no supera en más de un 10 % la más larga del último mes" |
| `MISSED_MOVED` / `MISSED_SHORTENED` / `MISSED_DROPPED` / `MISSED_LOW_PRIORITY` | "Movimos tu sesión clave al jueves; no hace falta recuperar la suave" |
| `OTHER_SPORT_REPLAN` | "Tras el partido de fútbol, sin carrera de calidad hasta el sábado" |
| `INJURY_RED` / `INJURY_AMBER` / `INJURY_GREEN` | "Hemos cambiado la carrera por bici y natación. Si no mejora, consulta a un fisio" |
| `ILLNESS_ABOVE_NECK` / `ILLNESS_REST` / `ILLNESS_RETURN` / `CARDIAC_FLAG` | "Con fiebre, hoy toca descanso total" |
| `READINESS_AMBER` / `READINESS_RED` | "Tu HRV y tu FC en reposo indican fatiga: hoy suave" |
| `LIFE_STRESS` | "Semana de exámenes: dejamos solo lo esencial" |
| `TRAVEL_DAY` / `JETLAG` / `NO_BIKE` / `NO_POOL` | "Día de viaje: solo 30' para soltar piernas" |
| `SOCIAL_MATCH` | "Coincide con el rodaje de Pablo: ¿entrenáis juntos?" |
| `PLAN_TOO_SHORT` / `RACES_TOO_CLOSE` | "Faltan pocas semanas para un Ironman: revisa el objetivo" |

---

## 15. Contrato motor ↔ IA ("tu Claude")

- El motor expone `generateWeek`, `validate(plan)`, `explain(planDiff)`, `simulate(plan)` (PMC proyectado) y el catálogo de sesiones.
- La IA propone **parches JSON** (mover, sustituir, acortar o añadir sesiones del catálogo). El motor los valida y:
  - **No se pueden anular (`SAFETY`):** §11.5 ROJO/ÁMBAR, §11.6 (`IL2`, `IL3`, `IL5`), TSB < −30 y rampa > 8 sin "semana de concentración" activada por el usuario, regla de Frandsen, ningún QUALITY o LONG el día D−1 de una carrera A.
  - **Se pueden anular con justificación (`SOFT`):** preferencias S01-S10, reparto de deportes ±5 puntos, cadencia 3:1/2:1, taper dentro de los rangos [C].
- La IA recibe el contexto en un objeto compacto: fase, objetivos, PMC, semáforo, eventos activos y violaciones. Así razona sobre los mismos números que muestra la UI.
- El usuario siempre puede aceptar o rechazar un parche. Las decisiones quedan registradas (auditoría y aprendizaje futuro).

---

## 16. Invariantes para los tests (property-based)

1. Ningún plan generado tiene dos días con `hardPoints ≥ 1` seguidos, salvo un `BIG_WEEKEND` válido (`L02`).
2. Toda sesión de carrera cumple `distance ≤ 1.10 × max30d` (o el suelo de 5 km).
3. El ΔCTL proyectado en 7 días es ≤ `rampTarget`, y el TSB proyectado ≥ −30 todos los días.
4. En las semanas de taper, `hours/avgBuild3` está dentro del rango de §5.4 y el número de sesiones es ≥ 75-80 % del del build.
5. Con una lesión ROJA activa, no hay sesiones que carguen la zona afectada. Con fiebre activa, no hay ninguna sesión.
6. Ninguna re-planificación por un missed aumenta la carga de un día por encima de 1.2 × la planificada.
7. Determinismo: `generateWeek(x) === generateWeek(x)` (comparación profunda) para una semilla de entrada fija.
8. Tiempo en Z1+Z2 ≥ 75 % fuera de la semana de carrera.
9. En cualquier semana con más de 8 h, frecuencia ≥ 2 en cada deporte (salvo restricción activa).
10. Las plantillas de §10.5 se reproducen dentro de un margen de ±1 sesión y ±10 % de horas con sus entradas.

---

## 17. Lo que **no** sabemos todavía (riesgos)

- Las tablas exactas de *The Triathlete's Training Bible* (5.ª ed., 2024) no se han verificado. Las duraciones de fase y la curva de volumen son [H]. Hay que validarlas con 2-3 planes reales del usuario y de su compañero.
- **El hrTSS y el rTSS propios no darán los mismos números que TrainingPeaks o Garmin.** Es normal. Lo que importa es la coherencia interna del PMC. La pantalla de ayuda debe explicar que "tu carga no es la de Garmin".
- La carga de otros deportes (pádel, fútbol) es una estimación grosera. Con datos de FC del reloj, el hrTSS mejora mucho. Hay que pedir que graben esas actividades con el Garmin.
- Las cifras de reducción por sueño y estrés no tienen respaldo cuantitativo en la literatura. Empezamos conservadores y medimos la adherencia.
- Las bandas de Garmin pueden cambiar: se leen como enumeraciones de la API y se registran en el log con la versión.

---

## 18. Fuentes

**Periodización, zonas y carga**
- Friel, *Quick guide to setting zones* (TrainingPeaks): https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/
- Friel, *The CTL Ramp Rate*: https://www.goodreads.com/author_blog_posts/8386404-the-ctl-ramp-rate
- Friel, *Customizing the Build Period*: https://www.goodreads.com/author_blog_posts/5177450-aging-customizing-the-build-period
- TrainingPeaks, *What is base training*: https://trainingpeaks.com/blog/what-is-base-training
- Resumen de la periodización de Friel: https://www.coachray.nz/2021/10/18/joe-friels-bible-for-periodisation/
- TrainingPeaks, *Track triathlon training* (rampa, TSB, carga de carrera): https://www.trainingpeaks.com/blog/track-triathlon-training-trainingpeaks/
- TrainingPeaks, *NP, IF y TSS*: https://www.trainingpeaks.com/blog/normalized-power-intensity-factor-training-stress
- TrainingPeaks, *TSS vs hrTSS*: https://www.trainingpeaks.com/learn/articles/training-with-tss-vs-hrtss-whats-the-difference/
- TrainingPeaks, *Calculating swimming TSS*: https://www.trainingpeaks.com/learn/articles/calculating-swimming-tss-score/
- Roadman Cycling, guía de TSS: https://roadmancycling.com/blog/training-stress-score-tss-cycling-guide ; semana de recuperación: https://roadmancycling.com/glossary/recovery-week
- TrainerRoad, planes máster 2:1: https://www.trainerroad.com/blog/new-triathlon-and-masters-triathlon-plans/ ; Adaptive Training: https://support.trainerroad.com/hc/en-us/articles/4404060687387-Adaptive-Training-Overview
- Tri-Alliance, horas de entrenamiento: https://tri-alliance.com/tools/training-hours/
- Parciales de tiempo en el triatlón olímpico (JOHK): https://johk.pl/?p=2536
- Calculadora de zonas de CSS: https://www.myprocoach.net/?p=6575

**Intensidad**
- Stöggl & Sperlich 2015, TID: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4621419/
- Oliveira, Boppre & Fonseca 2024, *Sports Med*: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11329428/
- TID y rendimiento en medio Ironman (JSSM 2019): https://pmc.ncbi.nlm.nih.gov/articles/PMC6873141

**Taper**
- Metaanálisis de taper en deportistas de resistencia (PLOS ONE 2023): https://www.sponet.de/sponet/Record/4081751?lng=en
- Revisión sistemática del taper en triatlón: https://lida.sport-iat.de/ta/Record/4059196?lng=en
- Banister et al. 1999: https://coachsci.sdsu.edu/csa/vol71/banister.htm ; Zarkadas 1995 (Ironman): https://pubmed.ncbi.nlm.nih.gov/8629477/
- Precision Hydration, taper: https://www.precisionhydration.com/performance-advice/performance/how-to-taper-for-triathlon
- 220 Triathlon, taper en media distancia: https://www.220triathlon.com/training/long-distance/how-to-taper-for-middle-distance-triathlons
- Dave Scott, taper de Ironman: https://trainingpeaks.com/blog/dave-scotts-perfect-ironman-world-championship-taper

**Lesiones y progresión**
- Frandsen et al. 2025, BJSM (cohorte Garmin de 5205 corredores): https://pmc.ncbi.nlm.nih.gov/articles/PMC12421110 ; blog del BJSM: https://blogs.bmj.com/bjsm/?p=11751
- Aquajogging: https://www.outsideonline.com/running/training/injury-prevention/aqua-jogging-for-injured-runners/ ; https://runnersconnect.net/aqua-jogging-vs-elliptical/
- Fuerza: https://trainingpeaks.com/blog/heavy-lifting-for-endurance-athletes ; https://www.trainingpeaks.com/blog/year-round-strength-training-for-triathletes-part-3-heavy-weight-training-phase/
- Sesiones no realizadas: https://www.tri247.com/guides/stay-on-track-after-missing-workout ; https://blog.runningcoach.me/en/2025/08/08/missed-a-workout-how-to-deal-with-deviations-from-your-plan/ ; https://www.active.com/triathlon/articles/ask-a-coach-what-should-i-do-if-i-miss-a-workout
- Referencias clásicas citadas sin enlace verificado en esta investigación: Silbernagel et al. 2007 (*Am J Sports Med*), modelo de monitorización del dolor; Foster et al. 2001 (*J Strength Cond Res*), sRPE; Banister 1991, TRIMP.

**Otros deportes**
- Pádel amateur, carga interna por FC: https://portalcientifico.upsa.es/documentos/5da9982e2999527bba1802ef
- Pádel frente a tenis (Frontiers 2025): https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2025.1540424/pdf
- Fútbol, recuperación 72-96 h (Frontiers Physiol 2019): https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2019.00689/pdf
- Fútbol, TRIMP en partidos oficiales: https://revistas.usp.br/rbefe/article/view/170067

**Enfermedad, sueño, readiness y viajes**
- Consenso del COI de 2022 sobre enfermedad respiratoria aguda (BJSM): https://bjsm.bmj.com/content/early/2022/07/21/bjsports-2022-105759
- Snyders et al. 2022 (BJSM): https://bjsm.bmj.com/content/early/2021/12/15/bjsports-2021-104719
- Harvard/MEEI, resfriado y ejercicio: https://face.meei.harvard.edu/common-cold-and-exercise ; regla del cuello (2026): https://nextclinic.com.au/blog/can-you-exercise-with-a-cold-the-neck-check-rule
- World Triathlon, vuelta tras COVID: https://triathlon.org/uploads/docs/RETURN_TO_PLAY_AFTER_COVID_20220915.pdf
- Vuelta al deporte tras miocarditis: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11475062/
- Privación de sueño y rendimiento (2025): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11996801/ ; metaanálisis de 2022: https://lida.sport-iat.de/ta/Record/4082963?lng=en
- Garmin Training Readiness: https://www8.garmin.com/manuals/webhelp/GUID-31D23DBB-57C2-4DF7-A0C9-8D1A00AB4BE7/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html
- Garmin HRV Status: https://www8.garmin.com/manuals/webhelp/GUID-4462687B-8DF5-4719-872E-E16754F9D4B0/EN-US/GUID-5247CEC7-AF06-44FB-B6AD-87C53D4F7941.html
- Garmin Acute Load / Load ratio: https://www8.garmin.com/manuals-apac/webhelp/forerunner970/EN-SG/GUID-5EC24965-C82C-4FEA-8647-313C08B6F7C7-6714.html
- TrainingPeaks, señales de sobreentrenamiento (FC de reposo +5): https://www.trainingpeaks.com/blog/the-4-signs-of-overtraining
- Entrenamiento guiado por HRV (Jyväskylä): https://jyx.jyu.fi/handle/123456789/45036 ; TrainingPeaks: https://trainingpeaks.com/blog/new-study-widens-hrv-evidence-for-more-athletes
- Jet lag: https://netball.sport/wp-content/uploads/2024/05/Practical-tips-to-manage-travel-fatigue-and-jet-lag-in-athletes.pdf ; https://www.aspetar.com/journal/viewarticle.aspx?id=474

**Nutrición**
- Universidad de Birmingham 2026: https://www.birmingham.ac.uk/news/2026/fuelling-endurance-sport-the-carbohydrate-conundrum
- Revisión de 2026, *From Metabolism to Medals*: https://www.fisiologiadelejercicio.com/wp-content/uploads/2026/03/From-Metabolism-to-Medals.pdf
- ISSN, *nutrient timing*: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5596471/
- Resumen del posicionamiento conjunto ACSM/AND/DC 2016: https://www.myhealthcareer.com.au/dietetics/joint-position-statement-sport-nutritions
- TrainRight, hidratos por hora: https://trainright.com/how-many-carbohydrates-per-hour-on-the-bike/
