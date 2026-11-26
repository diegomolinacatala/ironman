/**
 * «Mis sitios» (pure, app only): the athlete's main city and the city they go back to at
 * weekends, each with its gear (bici de carretera, rodillo, piscina, gimnasio). The athlete is
 * at home every day except the weekend they said they go back («¿Este fin de semana vuelves a
 * Castellón?», `weekQuestions.ts`). On each day:
 * - no road bike and no trainer → no bike or brick that day (like «viaje sin bici»);
 * - only the trainer → bike sessions are on the rodillo;
 * - only the road bike → bike sessions are outside (never a rodillo session);
 * - no pool → no swim that day;
 * - no gym → strength with bands and body weight.
 * The restrictions feed the planner and the re-planner (`weekContext.ts`), like the ones of
 * the imprevistos (`restrictions.ts`).
 */
import { weekdayOf } from './dates';
import type { DayRestriction } from './restrictions';
import type { ISODate, PlaceGear, Profile, Sport, TrainingPlace, TrainingPlaces, WorkoutDraft } from './types';
import { isOutdoorSession } from './weather';
import { rodilloTitle } from './weatherIndoor';
import { answersFor } from './weekQuestions';

export const PLACE_NAME_MAX = 60;
export const NO_GEAR: PlaceGear = { roadBike: false, trainer: false, pool: false, gym: false };
export const GEAR_KEYS: readonly (keyof PlaceGear)[] = ['roadBike', 'trainer', 'pool', 'gym'];
export const GEAR_LABELS: Readonly<Record<keyof PlaceGear, string>> = {
  roadBike: 'Bici de carretera',
  trainer: 'Rodillo',
  pool: 'Piscina',
  gym: 'Gimnasio',
};

export type PlaceKey = 'home' | 'away';
export type BikeMode = 'outdoor' | 'indoor' | 'either' | 'none';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseGear(raw: unknown): PlaceGear {
  const r = isRecord(raw) ? raw : {};
  return { roadBike: r.roadBike === true, trainer: r.trainer === true, pool: r.pool === true, gym: r.gym === true };
}

function parsePlace(raw: unknown): TrainingPlace | null {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null;
  const name = raw.name.trim().slice(0, PLACE_NAME_MAX);
  return name ? { name, gear: parseGear(raw.gear) } : null;
}

/** `profiles.places` → TrainingPlaces; null without a usable main city (nothing set). */
export function parsePlaces(raw: unknown): TrainingPlaces | null {
  if (!isRecord(raw)) return null;
  const home = parsePlace(raw.home);
  return home ? { home, away: parsePlace(raw.away) } : null;
}

export function bikeModeOf(gear: PlaceGear): BikeMode {
  if (gear.roadBike && gear.trainer) return 'either';
  if (gear.roadBike) return 'outdoor';
  if (gear.trainer) return 'indoor';
  return 'none';
}

/** Where the athlete is on `date`: the other place on a weekend they said they go back, else home. */
export function placeKeyOn(profile: Pick<Profile, 'places' | 'weekQuestions'>, date: ISODate): PlaceKey {
  if (!profile.places?.away) return 'home';
  const weekday = weekdayOf(date);
  if (weekday !== 5 && weekday !== 6) return 'home';
  return answersFor(profile, date)?.awayWeekend === true ? 'away' : 'home';
}

/** The place of `date` (null when «Mis sitios» is not set). */
export function placeOn(profile: Pick<Profile, 'places' | 'weekQuestions'>, date: ISODate): TrainingPlace | null {
  const places = profile.places;
  if (!places) return null;
  return placeKeyOn(profile, date) === 'away' && places.away ? places.away : places.home;
}

/** Restriction of the place of `date` (null when nothing is limited there or no places are set). */
export function placeRestrictionOn(profile: Pick<Profile, 'places' | 'weekQuestions'>, date: ISODate): Partial<DayRestriction> | null {
  const place = placeOn(profile, date);
  if (!place) return null;
  const blocked: Sport[] = [];
  const codes: string[] = [];
  const notes: string[] = [];
  if (bikeModeOf(place.gear) === 'none') {
    blocked.push('bike', 'brick');
    codes.push('PLACE_NO_BIKE');
    notes.push(`En ${place.name} no tienes bici ni rodillo: esos días van sin bici.`);
  }
  if (!place.gear.pool) {
    blocked.push('swim');
    codes.push('PLACE_NO_POOL');
    notes.push(`En ${place.name} no tienes piscina: esos días van sin natación.`);
  }
  return blocked.length > 0 ? { blockedSports: blocked, codes, notes } : null;
}

/** The bike of `date` (null = no places set: anything goes). */
export function bikeModeOn(profile: Pick<Profile, 'places' | 'weekQuestions'>, date: ISODate): BikeMode | null {
  const place = placeOn(profile, date);
  return place ? bikeModeOf(place.gear) : null;
}

const RODILLO_PREFIX = /^rodillo\s*[·:-]\s*/i;

function withSentence(text: string | null | undefined, sentence: string): string {
  const base = (text ?? '').trim();
  if (base.includes(sentence)) return base;
  return `${base}${base ? ' ' : ''}${sentence}`.slice(0, 1000);
}

/**
 * A planned session fitted to the gear of the place of its day: on the rodillo where there is
 * only the trainer, outside where there is only the road bike, strength without a gym with
 * bands. Unchanged when no places are set or nothing needs to change.
 */
export function adaptDraftToPlace<T extends Pick<WorkoutDraft, 'date' | 'sport' | 'title' | 'description'>>(draft: T, profile: Pick<Profile, 'places' | 'weekQuestions'>): T {
  const place = placeOn(profile, draft.date);
  if (!place) return draft;
  if (draft.sport === 'bike' || draft.sport === 'brick') {
    const mode = bikeModeOf(place.gear);
    if (mode === 'indoor' && isOutdoorSession(draft)) {
      return { ...draft, title: rodilloTitle(draft.title), description: withSentence(draft.description, `En rodillo: en ${place.name} no tienes la bici de carretera.`) };
    }
    if (mode === 'outdoor' && !isOutdoorSession(draft)) {
      const title = draft.title.replace(RODILLO_PREFIX, '').trim() || 'Salida en bici';
      return { ...draft, title, description: withSentence(draft.description, `Por fuera: en ${place.name} tienes la bici de carretera y no el rodillo.`) };
    }
    return draft;
  }
  if (draft.sport === 'strength' && !place.gear.gym) {
    return { ...draft, description: withSentence(draft.description, `Sin gimnasio en ${place.name}: con gomas y peso corporal.`) };
  }
  return draft;
}

/** «Valencia: bici de carretera, piscina» for the settings rows. */
export function placeSummary(place: TrainingPlace): string {
  const gear = GEAR_KEYS.filter((k) => place.gear[k]).map((k) => GEAR_LABELS[k].toLowerCase());
  return gear.length > 0 ? `${place.name}: ${gear.join(', ')}` : `${place.name}: sin material`;
}

/** Subtitle of the «Mis sitios» row in Tú. */
export function placesSubtitle(places: TrainingPlaces | null | undefined): string {
  if (!places) return 'Dónde entrenas y qué tienes en cada sitio';
  return places.away ? `${places.home.name} y ${places.away.name}` : places.home.name;
}
