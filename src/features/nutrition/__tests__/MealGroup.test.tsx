import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import type { NutritionLog } from '@/domain/types';

import { MealGroup } from '../MealGroup';

jest.mock('@/integrations/camera/mealPhoto', () => ({
  mealPhotoUri: (id: string) => (id === 'with-photo' ? 'file:///meals/with-photo.jpg' : null),
}));

function log(id: string, description: string): NutritionLog {
  return {
    id,
    userId: 'me',
    date: '2026-10-27',
    meal: 'lunch',
    description,
    kcal: 640,
    carbsG: 95,
    proteinG: null,
    fatG: null,
    createdAt: `2026-10-27T12:0${id.length % 10}:00.000Z`,
  };
}

describe('MealGroup', () => {
  test('shows the stored photo next to the entries that have one', async () => {
    await render(
      <MealGroup
        group={{ slot: 'lunch', entries: [log('with-photo', 'Pasta con atún'), log('plain', 'Yogur')] }}
        deletingId={null}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByText('Comida')).toBeTruthy();
    expect(screen.getByText('Pasta con atún')).toBeTruthy();
    expect(screen.getAllByText('640 kcal · 95 g HC')).toHaveLength(2);
    expect(screen.getByTestId('meal-photo-with-photo').props.source).toEqual({ uri: 'file:///meals/with-photo.jpg' });
    expect(screen.queryByTestId('meal-photo-plain')).toBeNull();
  });
});
