/**
 * The athlete's watch (Garmin | COROS) as the screens read it (pure). Null or
 * absent means not chosen yet, which the app treats as Garmin (where it started).
 */
import type { Profile, WatchBrand } from '@/domain/types';

export const WATCH_BRAND_OPTIONS: { value: WatchBrand; label: string }[] = [
  { value: 'garmin', label: 'Garmin' },
  { value: 'coros', label: 'COROS' },
];

/** The chosen watch, Garmin when none was chosen (or the value is unknown). */
export function watchBrandOf(profile: Pick<Profile, 'watchBrand'> | null | undefined): WatchBrand {
  return profile?.watchBrand === 'coros' ? 'coros' : 'garmin';
}

/** "Garmin" / "COROS" (COROS always in capitals). */
export function watchName(brand: WatchBrand): string {
  return brand === 'coros' ? 'COROS' : 'Garmin';
}

/** One line under "Tu reloj": how that watch reaches Road to Ironman. */
export function watchBrandHint(brand: WatchBrand): string {
  return brand === 'coros'
    ? 'Por Apple Salud y tu Claude: entrenos, sueño y recuperación.'
    : 'Con tu clave de Garmin Connect: sueño, VFC y entrenos, solos.';
}
