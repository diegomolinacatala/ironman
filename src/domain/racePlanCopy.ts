/**
 * Spanish copy of the race plan ("Plan de carrera"): swim keys, bike and run
 * phase advice, fueling and the transition checklist. Pure; numbers are passed
 * in already formatted by racePlan.ts.
 */
import type { RaceFamily, TriFamily } from './raceDay';

/** Sprint and olympic start hard to find space; half and full start under control. */
export function isShortRace(family: RaceFamily): boolean {
  return family === 'sprint' || family === 'olympic' || family === 'run_5k' || family === 'run_10k';
}

export function swimKeys(family: TriFamily): { label: string; text: string }[] {
  if (isShortRace(family)) {
    return [
      { label: 'Salida', text: 'Sal fuerte los primeros 100–200 m para coger sitio y luego asienta tu ritmo.' },
      { label: 'Orientación', text: 'Levanta la vista cada 6–8 brazadas para no desviarte.' },
      { label: 'Rebufo', text: 'Busca unos pies de tu ritmo y nada pegado a ellos: ahorras fuerzas.' },
    ];
  }
  return [
    { label: 'Salida', text: 'Sal controlado: los primeros 200 m deciden si fluyes o te ahogas.' },
    { label: 'Orientación', text: 'Levanta la vista cada 6–8 brazadas y busca unos pies de tu ritmo.' },
    { label: 'Últimos 200 m', text: 'Patada suave para despertar las piernas antes de la transición.' },
  ];
}

/** Length of the "first" and "last" bike blocks, minutes (a sprint bike lasts ~35'). */
export const BIKE_EDGE_MIN: Readonly<Record<TriFamily, number>> = { sprint: 5, olympic: 10, half: 20, full: 20 };

export const BIKE_COPY = {
  firstPower: 'Un poco por debajo del objetivo: deja que baje el pulso de la natación.',
  firstHr: 'Deja que baje el pulso de la natación antes de apretar.',
  firstRpe: 'Más suave de lo que te pide el cuerpo: el pulso aún viene alto de nadar.',
  mainPower: (uphill: string) => `Constante. En las subidas no pases de ${uphill}; en las bajadas sigue pedaleando suave.`,
  mainHr: (cap: string) => `Sin pasar de ${cap}. En las subidas, mete desarrollo antes que pulso.`,
  mainRpe: 'Firme y sostenido; en las subidas, no te pases.',
  lastLong: 'Baja un 5 % y sube la cadencia para soltar las piernas antes de correr.',
  lastShort: 'Mantén y sube la cadencia en el último kilómetro para llegar con piernas a correr.',
} as const;

export const RUN_COPY = {
  firstTri: 'Más lento de lo que te piden las piernas: vienen de la bici y engañan.',
  firstRun: 'Sin salir a lo loco aunque te encuentres fresco.',
  middle: 'Tu ritmo de carrera: constante, kilómetro a kilómetro.',
  middleFull: 'Tu ritmo de carrera. Camina 10–15 s en cada avituallamiento para beber y comer.',
  endShort: 'Aprieta si te quedan piernas: aquí se gana el tiempo.',
  endLong: 'Si vas bien, aprieta; si no, mantén el ritmo y no mires el reloj.',
  hrNote: (hr: string) => `FC ${hr}: si se dispara en los primeros kilómetros, frena.`,
} as const;

export function fuelBefore(family: RaceFamily): string {
  if (family === 'sprint' || family === 'run_5k' || family === 'run_10k') {
    return "Desayuno ligero 2–3 h antes, rico en hidratos. Un gel 10–15' antes de la salida es opcional.";
  }
  return "Desayuno 3 h antes con 2–3 g de hidratos por kilo (pan, arroz, plátano), poca fibra y poca grasa. Un gel 15' antes de la salida.";
}

export function fuelNotes(input: { family: RaceFamily; beginner: boolean; highCarbs: boolean }): string[] {
  const notes = ['Nada nuevo el día de la carrera: las mismas marcas y cantidades que en tus entrenos.'];
  if (input.highCarbs && input.beginner) {
    notes.push('Si no has entrenado tomar tanto, quédate en 60 g/h y pruébalo antes en tus tiradas largas.');
  }
  if (input.family === 'sprint' || input.family === 'run_5k' || input.family === 'run_10k') {
    notes.push('Con agua basta; si hace calor, un bidón de bebida isotónica.');
  } else {
    notes.push('Si hace calor, bebe hacia la parte alta del rango y añade sal.');
  }
  return notes;
}

export function transitionChecklist(family: TriFamily): { t1: string[]; t2: string[] } {
  const long = family === 'half' || family === 'full';
  return {
    t1: [
      'Baja el neopreno hasta la cintura mientras corres a la transición.',
      'Casco abrochado antes de tocar la bici.',
      'Gafas y dorsal; zapatillas ya enganchadas solo si lo has practicado.',
      'Monta pasada la línea de montaje.',
    ],
    t2: [
      'Baja antes de la línea de desmontaje.',
      'Cuelga la bici y quítate el casco después, nunca antes.',
      long ? 'Zapatillas, gorra, dorsal delante y los geles de la carrera.' : 'Zapatillas con cordones elásticos, gorra y dorsal delante.',
    ],
  };
}

/** "tu FTP y tu ritmo umbral" → "Añade tu FTP y tu ritmo umbral en Tú › Perfil…". */
export function missingHintText(items: readonly string[]): string | null {
  if (items.length === 0) return null;
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
  return `Añade ${list} en Tú › Perfil para tener números en cada sector.`;
}
