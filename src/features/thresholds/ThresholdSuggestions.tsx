import type { ISODate } from '@/domain/types';

import { ThresholdSuggestionCard } from './ThresholdSuggestionCard';
import { useThresholdSuggestions } from './useThresholdSuggestions';

/** The first pending threshold suggestion (one at a time, to stay calm), or nothing. */
export function ThresholdSuggestions({ today }: { today: ISODate }) {
  const { suggestions, accept, snooze, busy, error } = useThresholdSuggestions(today);
  const first = suggestions[0];
  if (!first) return null;
  return (
    <ThresholdSuggestionCard
      key={first.field}
      suggestion={first}
      onAccept={() => void accept(first)}
      onSnooze={() => snooze(first)}
      busy={busy}
      error={error}
    />
  );
}
