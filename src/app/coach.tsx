import { Redirect, useLocalSearchParams } from 'expo-router';

import { coachRedirectHref, type CoachRouteParams } from '@/features/coach/requests';

/**
 * v2: the coach lives in the full-screen voice conversation (`/talk`). Old links
 * (`/coach?mode&weekStart&lifeEventId&message`, notifications, other screens)
 * land there with the same params, which only prefill: nothing is sent without a tap.
 */
export default function CoachScreen() {
  const params = useLocalSearchParams<CoachRouteParams>();
  return <Redirect href={coachRedirectHref(params)} />;
}
