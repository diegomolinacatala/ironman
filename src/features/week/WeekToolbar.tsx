import { router } from 'expo-router';

import type { ISODate } from '@/domain/types';
import { useActionSheet } from '@/features/workouts/actionSheet';
import { Button } from '@/ui';

export function WeekToolbar({ defaultDate }: { defaultDate: ISODate }) {
  const sheet = useActionSheet();
  return (
    <>
      <Button
        label="Añadir"
        icon="add"
        size="sm"
        variant="secondary"
        onPress={() =>
          sheet.open({
            title: 'Añadir a tu semana',
            actions: [
              { label: 'Entreno', icon: 'add', onPress: () => router.push(`/workout/edit?date=${defaultDate}`) },
              { label: 'Imprevisto', icon: 'eventAdd', onPress: () => router.push(`/event/edit?date=${defaultDate}`) },
            ],
          })
        }
        accessibilityHint="Añade un entreno o un imprevisto"
      />
      {sheet.element}
    </>
  );
}
