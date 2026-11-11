import { router } from 'expo-router';

import { Segmented } from '@/ui';

import { PLAN_VIEW_OPTIONS, type PlanView } from './weekModel';

/** "Semana | General" under the Plan title; the choice lives in the URL (`?view=`), so links and back work. */
export function PlanViewSwitch({ value }: { value: PlanView }) {
  return (
    <Segmented<PlanView>
      accessibilityLabel="Vista del plan"
      options={PLAN_VIEW_OPTIONS}
      value={value}
      onChange={(view) => {
        if (view !== value) router.setParams({ view });
      }}
    />
  );
}
