import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { mealLabel } from '@/domain/labels';
import { MEAL_SLOTS, type ISODate, type MealSlot, type NutritionDraft } from '@/domain/types';
import { Button, Card, Chip, ErrorNotice, Text, TextField, space } from '@/ui';

import { defaultSlot, emptyNutritionForm, validateNutritionForm, type NutritionFormState } from './nutritionModel';

export interface NutritionEntryFormProps {
  date: ISODate;
  saving: boolean;
  /** Resolves true when saved (the form then resets). */
  onSubmit: (draft: NutritionDraft) => Promise<boolean>;
}

type MacroKey = 'kcal' | 'carbsG' | 'proteinG' | 'fatG';
const MACROS: readonly { key: MacroKey; label: string; placeholder: string }[] = [
  { key: 'kcal', label: 'kcal', placeholder: '450' },
  { key: 'carbsG', label: 'Hidratos (g)', placeholder: '60' },
  { key: 'proteinG', label: 'Proteína (g)', placeholder: '25' },
  { key: 'fatG', label: 'Grasa (g)', placeholder: '12' },
];

/** Inline "add entry" form: slot chips, description, optional macros. */
export function NutritionEntryForm({ date, saving, onSubmit }: NutritionEntryFormProps) {
  const [form, setForm] = useState<NutritionFormState>(() => emptyNutritionForm(defaultSlot(new Date().getHours())));
  const [showMacros, setShowMacros] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof NutritionFormState>(key: K, value: NutritionFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    const result = validateNutritionForm(form, date);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (await onSubmit(result.draft)) setForm(emptyNutritionForm(form.meal));
  };

  return (
    <Card variant="flat" padding="lg" style={styles.card}>
      <Text variant="overline" color="textMuted">
        Añadir
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {MEAL_SLOTS.map((slot: MealSlot) => (
          <Chip key={slot} label={mealLabel(slot)} selected={form.meal === slot} onPress={() => set('meal', slot)} />
        ))}
      </ScrollView>
      <TextField
        value={form.description}
        onChangeText={(v) => set('description', v)}
        placeholder="Avena con plátano y café…"
        accessibilityLabel="Qué has comido"
        maxLength={200}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {showMacros ? (
        <View style={styles.macros}>
          {MACROS.map((m) => (
            <View key={m.key} style={styles.macro}>
              <TextField
                label={m.label}
                value={form[m.key]}
                onChangeText={(v) => set(m.key, v)}
                placeholder={m.placeholder}
                accessibilityLabel={m.label}
                keyboardType="decimal-pad"
                maxLength={6}
              />
            </View>
          ))}
        </View>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
      <View style={styles.actions}>
        <Button
          label={showMacros ? 'Ocultar macros' : 'Añadir macros'}
          variant="ghost"
          size="sm"
          onPress={() => setShowMacros((v) => !v)}
        />
        <Button label="Guardar" icon="add" size="sm" loading={saving} onPress={() => void submit()} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  chips: { gap: space.xs },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  macro: { flexBasis: '47%', flexGrow: 1 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
