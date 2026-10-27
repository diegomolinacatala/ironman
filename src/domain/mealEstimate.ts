/**
 * Rough, offline meal estimate from a Spanish description ("pasta con atún,
 * plato grande"): a keyword table of common foods with typical portions.
 * Used when the AI (`meal` edge function) is unavailable. Always
 * `engine: 'rules'`, `confidence: 'low'`. Pure.
 */
import { timeToMinutes } from './dates';
import type { ISOTime, MealAnalysis, MealAnalysisInput, MealSlot } from './types';

interface Food {
  /** Matched against the lower-cased description; matched text is consumed. */
  re: RegExp;
  label: string;
  /** Countable foods ("2 huevos") vs. one portion of `grams`. */
  unit: 'count' | 'portion';
  /** Grams (portion) or default count (count). */
  amount: number;
  kcal: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
}

/** Per portion / per unit. Order matters: dishes before their ingredients. */
const FOODS: readonly Food[] = [
  { re: /tortilla( de patatas?)?/, label: 'Tortilla de patata', unit: 'portion', amount: 150, kcal: 300, carbsG: 25, proteinG: 10, fatG: 18 },
  { re: /pizza/, label: 'Pizza', unit: 'portion', amount: 300, kcal: 750, carbsG: 85, proteinG: 32, fatG: 30 },
  { re: /hamburguesa/, label: 'Hamburguesa', unit: 'count', amount: 1, kcal: 550, carbsG: 40, proteinG: 30, fatG: 28 },
  { re: /bocadillo|bocata/, label: 'Pan de bocadillo', unit: 'portion', amount: 120, kcal: 320, carbsG: 60, proteinG: 10, fatG: 4 },
  { re: /batido( de prote[ií]na)?|prote[ií]na en polvo|whey/, label: 'Batido de proteína', unit: 'count', amount: 1, kcal: 150, carbsG: 8, proteinG: 25, fatG: 2 },
  { re: /bebida isot[oó]nica|isot[oó]nic[oa]/, label: 'Bebida isotónica', unit: 'portion', amount: 500, kcal: 120, carbsG: 30, proteinG: 0, fatG: 0 },
  { re: /\bgel(es)?\b/, label: 'Gel', unit: 'count', amount: 1, kcal: 90, carbsG: 22, proteinG: 0, fatG: 0 },
  { re: /barrita/, label: 'Barrita', unit: 'count', amount: 1, kcal: 200, carbsG: 30, proteinG: 8, fatG: 6 },
  { re: /pasta|espagueti|macarr[oó]n|tallar[ií]n|lasa[ñn]a/, label: 'Pasta cocida', unit: 'portion', amount: 250, kcal: 350, carbsG: 70, proteinG: 12, fatG: 2 },
  { re: /arroz|paella|risotto/, label: 'Arroz cocido', unit: 'portion', amount: 200, kcal: 260, carbsG: 56, proteinG: 5, fatG: 1 },
  { re: /lentej|garbanzo|alubia|legumbre|fabada|cocido madrile/, label: 'Legumbres cocidas', unit: 'portion', amount: 250, kcal: 300, carbsG: 45, proteinG: 18, fatG: 4 },
  { re: /avena|porridge/, label: 'Copos de avena', unit: 'portion', amount: 60, kcal: 230, carbsG: 40, proteinG: 8, fatG: 4 },
  { re: /cereales|muesli|granola/, label: 'Cereales', unit: 'portion', amount: 50, kcal: 200, carbsG: 40, proteinG: 5, fatG: 3 },
  { re: /tostadas?/, label: 'Tostada', unit: 'count', amount: 2, kcal: 110, carbsG: 20, proteinG: 4, fatG: 2 },
  { re: /\bpan\b/, label: 'Pan', unit: 'portion', amount: 60, kcal: 160, carbsG: 30, proteinG: 5, fatG: 2 },
  { re: /patatas?/, label: 'Patata', unit: 'portion', amount: 200, kcal: 180, carbsG: 40, proteinG: 4, fatG: 0 },
  { re: /pollo|pavo/, label: 'Pollo', unit: 'portion', amount: 150, kcal: 250, carbsG: 0, proteinG: 45, fatG: 6 },
  { re: /ternera|carne|filete|cerdo|lomo|solomillo/, label: 'Carne', unit: 'portion', amount: 150, kcal: 300, carbsG: 0, proteinG: 38, fatG: 16 },
  { re: /salm[oó]n/, label: 'Salmón', unit: 'portion', amount: 150, kcal: 300, carbsG: 0, proteinG: 30, fatG: 19 },
  { re: /at[uú]n/, label: 'Atún', unit: 'portion', amount: 80, kcal: 120, carbsG: 0, proteinG: 20, fatG: 4 },
  { re: /pescado|merluza|bacalao|dorada|lubina|sardina|gambas?|calamar/, label: 'Pescado', unit: 'portion', amount: 150, kcal: 180, carbsG: 0, proteinG: 30, fatG: 6 },
  { re: /jam[oó]n/, label: 'Jamón', unit: 'portion', amount: 50, kcal: 120, carbsG: 0, proteinG: 15, fatG: 7 },
  { re: /queso/, label: 'Queso', unit: 'portion', amount: 40, kcal: 150, carbsG: 0, proteinG: 10, fatG: 12 },
  { re: /huevos?/, label: 'Huevo', unit: 'count', amount: 2, kcal: 75, carbsG: 1, proteinG: 6, fatG: 5 },
  { re: /yogur(es|t)?/, label: 'Yogur', unit: 'count', amount: 1, kcal: 100, carbsG: 6, proteinG: 8, fatG: 5 },
  { re: /leche/, label: 'Leche', unit: 'portion', amount: 250, kcal: 120, carbsG: 12, proteinG: 8, fatG: 4 },
  { re: /pl[aá]tanos?/, label: 'Plátano', unit: 'count', amount: 1, kcal: 105, carbsG: 27, proteinG: 1, fatG: 0 },
  { re: /fruta|manzanas?|naranjas?|peras?|kiwis?|fresas/, label: 'Fruta', unit: 'count', amount: 1, kcal: 80, carbsG: 20, proteinG: 1, fatG: 0 },
  { re: /ensalada/, label: 'Ensalada con aliño', unit: 'portion', amount: 200, kcal: 120, carbsG: 8, proteinG: 3, fatG: 9 },
  { re: /verdura|br[oó]coli|calabac[ií]n|pimiento|espinaca|tomate|jud[ií]as verdes|menestra/, label: 'Verduras', unit: 'portion', amount: 200, kcal: 60, carbsG: 10, proteinG: 3, fatG: 1 },
  { re: /nuec|almendra|frutos secos|cacahuet|anacardo/, label: 'Frutos secos', unit: 'portion', amount: 30, kcal: 190, carbsG: 4, proteinG: 5, fatG: 18 },
  { re: /croissant|cruas[aá]n|bollo|magdalena|donut|galletas?/, label: 'Bollería', unit: 'count', amount: 1, kcal: 250, carbsG: 28, proteinG: 5, fatG: 13 },
  { re: /cerveza|\bca[ñn]as?\b/, label: 'Cerveza', unit: 'count', amount: 1, kcal: 140, carbsG: 12, proteinG: 1, fatG: 0 },
  { re: /refresco|coca.?cola|zumo/, label: 'Refresco o zumo', unit: 'portion', amount: 330, kcal: 140, carbsG: 35, proteinG: 0, fatG: 0 },
];

const COUNT_WORDS: Readonly<Record<string, number>> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
const BIG_RE = /plato grande|grande|doble|mucho|bastante|abundante/;
const SMALL_RE = /peque[ñn]|poco|media raci[oó]n|medio plato|liger/;
const BIG_FACTOR = 1.4;
const SMALL_FACTOR = 0.6;
const DESCRIPTION_MAX = 80;

interface Matched {
  food: Food;
  /** Count (count foods) or portion factor (portion foods). */
  quantity: number;
}

/** Guesses the meal from the local time (Spanish meal times). */
export function mealSlotForTime(time: ISOTime): MealSlot {
  const minutes = timeToMinutes(time);
  if (!Number.isFinite(minutes)) return 'snack';
  if (minutes >= 5 * 60 && minutes < 11 * 60) return 'breakfast';
  if (minutes >= 13 * 60 && minutes < 16 * 60 + 30) return 'lunch';
  if (minutes >= 20 * 60) return 'dinner';
  return 'snack';
}

/** "antes de entrenar" / "durante" / "después de correr" override the time-based slot. */
function slotFromText(text: string): MealSlot | null {
  const sport = '(entrenar|entreno|correr|nadar|rodar|la bici|salir)';
  if (new RegExp(`antes de(l)? ${sport}`).test(text)) return 'pre';
  if (new RegExp(`(despu[eé]s|al volver) de(l)? ${sport}|recuperaci[oó]n`).test(text)) return 'post';
  if (new RegExp(`durante (el )?${sport}`).test(text)) return 'during';
  return null;
}

function countBefore(text: string, index: number): number | null {
  const match = /(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis)\s+$/.exec(text.slice(0, index));
  if (!match?.[1]) return null;
  const raw = match[1];
  return /^\d+$/.test(raw) ? Math.min(Number(raw), 12) : (COUNT_WORDS[raw] ?? null);
}

function matchFoods(text: string): Matched[] {
  const portionFactor = BIG_RE.test(text) ? BIG_FACTOR : SMALL_RE.test(text) ? SMALL_FACTOR : 1;
  let rest = text;
  const found: Matched[] = [];
  FOODS.forEach((food) => {
    const match = food.re.exec(rest);
    if (!match) return;
    const count = food.unit === 'count' ? (countBefore(rest, match.index) ?? food.amount) : portionFactor;
    found.push({ food, quantity: count });
    // Consume the match so "tortilla de patata" is not also counted as "patata".
    rest = `${rest.slice(0, match.index)}${' '.repeat(match[0].length)}${rest.slice(match.index + match[0].length)}`;
  });
  return found;
}

function itemText({ food, quantity }: Matched): string {
  if (food.unit === 'count') return `${food.label} · ${quantity} ${quantity === 1 ? 'ud' : 'uds'}`;
  const unit = /bebida|leche|refresco/i.test(food.label) ? 'ml' : 'g';
  return `${food.label} · ${Math.round((food.amount * quantity) / 10) * 10} ${unit}`;
}

function sum(matches: readonly Matched[], key: 'kcal' | 'carbsG' | 'proteinG' | 'fatG'): number {
  return Math.round(matches.reduce((total, m) => total + m.food[key] * m.quantity, 0));
}

function capitalize(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const short = clean.length > DESCRIPTION_MAX ? `${clean.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : clean;
  return short ? `${short.charAt(0).toUpperCase()}${short.slice(1)}` : short;
}

function tipFor(meal: MealSlot, carbsG: number, proteinG: number): string {
  if ((meal === 'lunch' || meal === 'dinner' || meal === 'post') && proteinG < 20) {
    return 'Añade algo de proteína (huevos, pollo, pescado, legumbres o yogur) para recuperar mejor.';
  }
  if (carbsG >= 80) return 'Buena carga de hidratos: ideal antes o después de una sesión larga.';
  return 'Estimación aproximada: revisa las cantidades si quieres afinar.';
}

const NO_DESCRIPTION_TIP = 'Añade una descripción (por ejemplo, «pasta con atún, plato grande») para estimar las calorías.';

function emptyAnalysis(meal: MealSlot, description: string, tip: string): MealAnalysis {
  return { meal, description, items: [], kcal: null, carbsG: null, proteinG: null, fatG: null, confidence: 'low', tip, engine: 'rules' };
}

/** Offline estimate: keyword table for text; a photo alone cannot be analysed locally. */
export function estimateMealLocally(input: MealAnalysisInput): MealAnalysis {
  const text = (input.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const meal = slotFromText(text) ?? mealSlotForTime(input.time);
  if (!text) {
    return emptyAnalysis(meal, input.imageBase64 ? 'Comida (sin analizar)' : 'Comida', NO_DESCRIPTION_TIP);
  }
  const matches = matchFoods(text);
  const description = capitalize(input.text ?? '');
  if (matches.length === 0) {
    return emptyAnalysis(meal, description, 'No he reconocido los alimentos: añade las cantidades a mano si quieres registrarlas.');
  }
  const carbsG = sum(matches, 'carbsG');
  const proteinG = sum(matches, 'proteinG');
  return {
    meal,
    description,
    items: matches.map(itemText),
    kcal: sum(matches, 'kcal'),
    carbsG,
    proteinG,
    fatG: sum(matches, 'fatG'),
    confidence: 'low',
    tip: tipFor(meal, carbsG, proteinG),
    engine: 'rules',
  };
}
