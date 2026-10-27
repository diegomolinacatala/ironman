import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { mealLabel } from '@/domain/labels';
import type { ISODate, NutritionLog } from '@/domain/types';
import { MEAL_CAMERA_ROUTE } from '@/features/accessory/coachActions';
import { mealPhotoUri } from '@/integrations/camera/mealPhoto';
import { Icon, SectionHeader, Text, haptics, radius, space, useTheme } from '@/ui';

import { formatThousands, mealTotals, mealTotalsA11y, mealTotalsLine } from './todayModel';

const TILE_WIDTH = 116;
const THUMB_HEIGHT = 84;

function MealTile({ meal, onPress }: { meal: NutritionLog; onPress: () => void }) {
  const { colors } = useTheme();
  const uri = mealPhotoUri(meal.id);
  const kcal = meal.kcal != null ? `${formatThousands(meal.kcal)} kcal` : 'Sin kcal';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mealLabel(meal.meal)}: ${meal.description}. ${meal.kcal != null ? `${Math.round(meal.kcal)} kilocalorías` : 'Sin calorías'}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.placeholder, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name="food" size={22} color={colors.textMuted} />
        </View>
      )}
      <Text variant="caption" color="textMuted" numberOfLines={1}>
        {mealLabel(meal.meal)}
      </Text>
      <Text variant="bodyStrong" numberOfLines={1}>
        {kcal}
      </Text>
    </Pressable>
  );
}

function AddPhotoTile() {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Añadir una comida con una foto"
      onPress={() => {
        haptics.tap();
        router.push(MEAL_CAMERA_ROUTE);
      }}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.thumb, styles.placeholder, styles.add, { borderColor: colors.borderStrong }]}>
        <Icon name="camera" size={22} color={colors.text} />
        <Text variant="caption">+ Foto</Text>
      </View>
    </Pressable>
  );
}

/** Today's meals as photo tiles + day totals; "+ Foto" opens the camera analysis. */
export function MealsStrip({ date, meals }: { date: ISODate; meals: NutritionLog[] }) {
  const totals = mealTotals(meals);
  const line = mealTotalsLine(totals);
  const openDay = () => router.push(`/nutrition?date=${date}`);
  return (
    <View style={styles.root}>
      <SectionHeader title="Comidas de hoy" action={meals.length > 0 ? { label: 'Ver todo', onPress: openDay } : undefined} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
        <AddPhotoTile />
        {meals.map((meal) => (
          <MealTile key={meal.id} meal={meal} onPress={openDay} />
        ))}
      </ScrollView>
      {line ? (
        <Text variant="callout" accessibilityLabel={mealTotalsA11y(totals)}>
          {`Hoy llevas ${line}`}
        </Text>
      ) : meals.length === 0 ? (
        <Text variant="callout" color="textMuted">
          Haz una foto a lo que comes y te calculo calorías e hidratos.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  // Bleed to the screen edges so tiles scroll under the gutter.
  scroll: { marginHorizontal: -space.lg },
  row: { paddingHorizontal: space.lg, gap: space.md },
  tile: { width: TILE_WIDTH, gap: 2 },
  thumb: { width: TILE_WIDTH, height: THUMB_HEIGHT, borderRadius: radius.md, marginBottom: space.xs },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  add: { borderWidth: 1.5, borderStyle: 'dashed', gap: 2 },
});
