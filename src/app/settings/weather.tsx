import { WeatherPlaceSettings } from '@/features/weather/WeatherPlaceSettings';
import { Screen } from '@/ui';

/** "Tu ciudad para el tiempo" (Tú › Entrenamiento; also from the Plan hint). */
export default function WeatherPlaceScreen() {
  return (
    <Screen inSheet>
      <WeatherPlaceSettings />
    </Screen>
  );
}
