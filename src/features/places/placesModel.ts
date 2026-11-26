import { NO_GEAR } from '@/domain/places';
import type { PlaceGear, Profile, ProfilePatch, TrainingPlaces, WeekQuestions } from '@/domain/types';

/** The «Mis sitios» form: both cities (empty name = not set) and the week questions switch. */
export interface PlacesForm {
  homeName: string;
  homeGear: PlaceGear;
  awayName: string;
  awayGear: PlaceGear;
  questions: boolean;
}

export function placesForm(profile: Pick<Profile, 'places' | 'weekQuestions'>): PlacesForm {
  const p = profile.places;
  return {
    homeName: p?.home.name ?? '',
    homeGear: p?.home.gear ?? NO_GEAR,
    awayName: p?.away?.name ?? '',
    awayGear: p?.away?.gear ?? NO_GEAR,
    questions: profile.weekQuestions?.enabled === true,
  };
}

export function toggleGear(gear: PlaceGear, key: keyof PlaceGear): PlaceGear {
  return { ...gear, [key]: !gear[key] };
}

/** Problem to show before saving, or null. */
export function placesFormError(form: PlacesForm): string | null {
  if (!form.homeName.trim() && form.awayName.trim()) return 'Pon primero tu ciudad principal.';
  if (form.homeName.trim() && form.homeName.trim().toLowerCase() === form.awayName.trim().toLowerCase()) return 'Tus dos sitios tienen el mismo nombre.';
  return null;
}

function placesOf(form: PlacesForm): TrainingPlaces | null {
  const home = form.homeName.trim();
  if (!home) return null;
  const away = form.awayName.trim();
  return { home: { name: home, gear: form.homeGear }, away: away ? { name: away, gear: form.awayGear } : null };
}

/** The profile patch of the form: places (null = cleared) and the switch (answers kept). */
export function placesPatch(form: PlacesForm, current: WeekQuestions | null | undefined): ProfilePatch {
  const questions = current || form.questions ? { weekQuestions: { enabled: form.questions, weeks: current?.weeks ?? [] } } : {};
  return { places: placesOf(form), ...questions };
}
