import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { SeasonWeek } from '@/domain/season';
import type { WeekPlanKind } from '@/domain/types';
import { FormLabel } from '@/features/workouts/FormLabel';
import { SheetModal } from '@/features/workouts/SheetModal';
import { Button, ErrorNotice, Icon, Segmented, Stepper, Text, TextField, haptics, radius, space, useTheme } from '@/ui';

import {
  ADJUST_OPTIONS,
  MINUTES_MAX,
  MINUTES_STEP,
  NOTE_MAX,
  autoMinutes,
  initialAdjustForm,
  stepMinutes,
  toWeekPlanDraft,
  type AdjustContext,
  type AdjustForm,
  type AdjustOption,
  type HoursMode,
} from './adjustModel';
import { formatSeasonHours, spokenHours, weekCaption } from './seasonModel';
import { useAdjustWeek } from './useAdjustWeek';

/** One opening of the sheet: a new `key` starts a fresh form even for the same week. */
export interface AdjustRequest {
  week: SeasonWeek;
  key: number;
}

export interface AdjustWeekSheetProps {
  request: AdjustRequest | null;
  context: AdjustContext | null;
  onClose: () => void;
}

const HOURS_OPTIONS: { value: HoursMode; label: string }[] = [
  { value: 'auto', label: 'Según el plan' },
  { value: 'custom', label: 'Elegir horas' },
];

/** Keeps the last request on screen while the sheet slides away. */
function useLastRequest(request: AdjustRequest | null): AdjustRequest | null {
  const [last, setLast] = useState(request);
  if (request !== null && request !== last) setLast(request);
  return request ?? last;
}

/** "Ajustar semana": Carga / Más volumen / Descarga / Semana libre, optional hours and a note. */
export function AdjustWeekSheet({ request, context, onClose }: AdjustWeekSheetProps) {
  const shown = useLastRequest(request);
  if (!shown || !context) return null;
  return <AdjustWeekModal key={shown.key} visible={request !== null} week={shown.week} context={context} onClose={onClose} />;
}

interface AdjustWeekModalProps {
  visible: boolean;
  week: SeasonWeek;
  context: AdjustContext;
  onClose: () => void;
}

function AdjustWeekModal({ visible, week, context, onClose }: AdjustWeekModalProps) {
  const [form, setForm] = useState<AdjustForm>(() => initialAdjustForm(week));
  const actions = useAdjustWeek();
  const minutesByKind = useMemo(
    () => Object.fromEntries(ADJUST_OPTIONS.map((o) => [o.kind, autoMinutes(week.weekStart, o.kind, context)])) as Record<WeekPlanKind, number>,
    [week.weekStart, context],
  );
  const update = (patch: Partial<AdjustForm>) => setForm((prev) => ({ ...prev, ...patch }));
  const close = () => {
    actions.clearError();
    onClose();
  };
  const save = async () => {
    if (await actions.save(toWeekPlanDraft(form, week.weekStart))) onClose();
  };
  const remove = async () => {
    if (await actions.remove(week.weekStart)) onClose();
  };

  const footer = (
    <View style={styles.footer}>
      <Button label="Guardar" icon="check" size="lg" fullWidth loading={actions.saving} disabled={actions.removing} onPress={() => void save()} />
      {week.plan ? (
        <Button
          label="Quitar ajuste"
          icon="undo"
          variant="secondary"
          fullWidth
          loading={actions.removing}
          disabled={actions.saving}
          onPress={() => void remove()}
          accessibilityHint="La semana vuelve a lo que marca tu plan"
        />
      ) : null}
    </View>
  );

  return (
    <SheetModal visible={visible} onClose={close} overline={weekCaption(week)} title="Ajustar semana" footer={footer}>
      <KindOptions value={form.kind} minutes={form.hoursMode === 'auto' ? minutesByKind : null} onChange={(kind) => update({ kind })} />
      <HoursField form={form} auto={minutesByKind[form.kind]} onChange={update} />
      <TextField
        label="Nota (opcional)"
        value={form.note}
        onChangeText={(note) => update({ note })}
        placeholder="Viaje a Londres: solo carrera"
        multiline
        maxLength={NOTE_MAX}
        hint={`${form.note.length}/${NOTE_MAX}`}
      />
      {actions.error ? <ErrorNotice message={actions.error} /> : null}
    </SheetModal>
  );
}

interface KindOptionsProps {
  value: WeekPlanKind;
  /** Hours the plan gives each option; null while the athlete sets the hours. */
  minutes: Record<WeekPlanKind, number> | null;
  onChange: (kind: WeekPlanKind) => void;
}

function KindOptions({ value, minutes, onChange }: KindOptionsProps) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Tipo de semana" style={styles.options}>
      {ADJUST_OPTIONS.map((option) => (
        <KindOption
          key={option.kind}
          option={option}
          selected={option.kind === value}
          minutes={minutes ? minutes[option.kind] : null}
          onPress={() => onChange(option.kind)}
        />
      ))}
    </View>
  );
}

interface KindOptionProps {
  option: AdjustOption;
  selected: boolean;
  minutes: number | null;
  onPress: () => void;
}

function KindOption({ option, selected, minutes, onPress }: KindOptionProps) {
  const { colors } = useTheme();
  const spoken = minutes === null ? option.label : `${option.label}, ${spokenHours(minutes)}`;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${spoken}. ${option.help}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: selected ? colors.accentInk : colors.border,
          backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfacePressed : colors.surface,
        },
      ]}>
      <View style={[styles.tile, { backgroundColor: selected ? colors.surface : colors.surfaceAlt }]}>
        <Icon name={option.icon} size={18} color={selected ? colors.onAccentSoft : colors.textMuted} />
      </View>
      <View style={styles.optionText}>
        <Text variant="bodyStrong" color={selected ? 'onAccentSoft' : 'text'}>
          {option.label}
        </Text>
        <Text variant="caption" color="textMuted">
          {option.help}
        </Text>
      </View>
      <View style={styles.optionEnd}>
        {minutes !== null ? (
          <Text variant="callout" color={selected ? 'onAccentSoft' : 'textMuted'} style={styles.tabular}>
            {formatSeasonHours(minutes)}
          </Text>
        ) : null}
        <Icon name={selected ? 'checkCircle' : 'check'} size={18} color={selected ? colors.accentInk : 'transparent'} />
      </View>
    </Pressable>
  );
}

interface HoursFieldProps {
  form: AdjustForm;
  /** Minutes the plan gives the selected option. */
  auto: number;
  onChange: (patch: Partial<AdjustForm>) => void;
}

function HoursField({ form, auto, onChange }: HoursFieldProps) {
  const setMode = (mode: HoursMode) => {
    if (mode === form.hoursMode) return;
    onChange(mode === 'custom' ? { hoursMode: mode, minutes: stepMinutes(auto) } : { hoursMode: mode });
  };
  return (
    <View style={styles.field}>
      <FormLabel>Horas de la semana</FormLabel>
      <Segmented<HoursMode> accessibilityLabel="Horas de la semana" options={HOURS_OPTIONS} value={form.hoursMode} onChange={setMode} />
      {form.hoursMode === 'custom' ? (
        <Stepper value={form.minutes} onChange={(minutes) => onChange({ minutes })} step={MINUTES_STEP} min={0} max={MINUTES_MAX} format={formatSeasonHours} />
      ) : (
        <Text variant="caption" color="textMuted">
          {`El plan te da ${formatSeasonHours(auto)} con esta opción.`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  options: { gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 2 },
  optionEnd: { alignItems: 'flex-end', gap: space.xs },
  tabular: { fontVariant: ['tabular-nums'] },
  field: { gap: space.sm },
});
