import { useLocalSearchParams } from 'expo-router';

import { SeasonView } from '@/features/season/SeasonView';
import { WeekView } from '@/features/week/WeekView';
import { parsePlanView } from '@/features/week/weekModel';

/**
 * Plan tab. `?view=general` shows the season overview (Plan → General); anything
 * else shows the week, picked with `?week=` (this week by default).
 */
export default function PlanScreen() {
  const params = useLocalSearchParams<{ week?: string; view?: string }>();
  return parsePlanView(params.view) === 'general' ? <SeasonView /> : <WeekView weekParam={params.week} />;
}
