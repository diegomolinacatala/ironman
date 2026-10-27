import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { mealLabel } from '@/domain/labels';
import { MEAL_SLOTS, type MealAnalysis } from '@/domain/types';
import type { NutritionFormState } from '@/features/nutrition/nutritionModel';
import { FadeIn } from '@/features/talk/motion';
import { Card, Chip, Icon, Text, TextField, fonts, haptics, radius, space, useTheme, type IconName } from '@/ui';

import { MACRO_FIELDS, confidenceHint, macroStep, stepMacro, type MacroField } from './mealForm';

function StepButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.step, { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceAlt }]}>
      <Icon name={icon} size={16} color={colors.text} />
    </Pressable>
  );
}

function MacroInput({ field, value, onChange }: { field: MacroField; value: string; onChange: (text: string) => void }) {
  const { colors } = useTheme();
  const step = macroStep(field.key);
  const unitText = field.unit === 'g' ? `${step} g` : `${step} kcal`;
  return (
    <View style={[styles.macro, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="overline" color="textMuted">
        {`${field.label} · ${field.unit}`}
      </Text>
      <View style={styles.macroRow}>
        <StepButton icon="chevronLeft" label={`Restar ${unitText} de ${field.label}`} onPress={() => onChange(stepMacro(value, -step, field.max))} />
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.accentInk}
          accessibilityLabel={`${field.label} en ${field.unit === 'g' ? 'gramos' : 'kilocalorías'}`}
          maxLength={5}
          maxFontSizeMultiplier={1.3}
          style={[styles.macroInput, { color: colors.text }]}
        />
        <StepButton icon="chevronRight" label={`Sumar ${unitText} de ${field.label}`} onPress={() => onChange(stepMacro(value, step, field.max))} />
      </View>
    </View>
  );
}

function Hint({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.hint}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <Text variant="caption" color="textMuted" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

export interface MealResultFormProps {
  form: NutritionFormState;
  analysis: MealAnalysis | null;
  /** Shown when the analysis failed and the form is for manual entry. */
  manualReason: string | null;
  onChange: (patch: Partial<NutritionFormState>) => void;
}

/** Editable estimate: description, what was recognised, macros, meal slot and a tip. */
export function MealResultForm({ form, analysis, manualReason, onChange }: MealResultFormProps) {
  const { colors } = useTheme();
  const confidence = analysis ? confidenceHint(analysis.confidence) : null;
  return (
    <View style={styles.root}>
      {manualReason ? <Hint icon="info" text={manualReason} /> : null}
      <FadeIn index={0}>
        <TextField
          label="Descripción"
          value={form.description}
          onChangeText={(description) => onChange({ description })}
          placeholder="Pasta con atún y tomate"
          multiline
          maxLength={1000}
        />
      </FadeIn>
      {analysis && analysis.items.length > 0 ? (
        <FadeIn index={1} style={styles.items}>
          <Text variant="overline" color="textMuted">
            Lo que veo
          </Text>
          {analysis.items.map((item) => (
            <Text key={item} variant="callout">
              {`· ${item}`}
            </Text>
          ))}
        </FadeIn>
      ) : null}
      <FadeIn index={2} style={styles.grid}>
        {MACRO_FIELDS.map((field) => (
          <MacroInput key={field.key} field={field} value={form[field.key]} onChange={(text) => onChange({ [field.key]: text })} />
        ))}
      </FadeIn>
      {confidence ? <Hint icon="warning" text={confidence} /> : null}
      <FadeIn index={3} style={styles.items}>
        <Text variant="overline" color="textMuted">
          ¿Qué comida es?
        </Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {MEAL_SLOTS.map((slot) => (
            <Chip key={slot} label={mealLabel(slot)} selected={form.meal === slot} onPress={() => onChange({ meal: slot })} />
          ))}
        </View>
      </FadeIn>
      {analysis?.tip ? (
        <Card variant="tinted" tint={colors.surfaceAlt} padding="md">
          <View style={styles.hint}>
            <Icon name="lightbulb" size={18} color={colors.accentInk} />
            <Text variant="callout" style={styles.flex}>
              {analysis.tip}
            </Text>
          </View>
        </Card>
      ) : null}
      {analysis?.engine === 'rules' ? (
        <Text variant="caption" color="textFaint">
          Estimación automática (sin IA)
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.lg },
  items: { gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  macro: { flexGrow: 1, flexBasis: '45%', gap: space.xs, padding: space.sm, borderRadius: radius.md, borderWidth: 1 },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  macroInput: { flex: 1, minHeight: 44, textAlign: 'center', fontFamily: fonts.displayItalic, fontSize: 26, paddingVertical: 4 },
  step: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
});
