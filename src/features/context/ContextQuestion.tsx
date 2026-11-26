import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { periodRange } from '@/domain/athleteContext';
import { todayISO } from '@/domain/dates';
import type { AthleteContext, ContextPeriod, ISODate } from '@/domain/types';
import { CoachBubble } from '@/features/talk/TurnView';
import { Button, Card, Chip, IconButton, Text, TextField, space } from '@/ui';

import { DateField } from '../settings/DateField';
import {
  initialTimes,
  watchPrefills,
  type Answer,
  type ChoiceQuestion,
  type HabitField,
  type PeriodsQuestion,
  type Question,
  type TimesQuestion,
  type WatchSleep,
} from './interviewModel';

export interface ContextQuestionProps {
  question: Exclude<Question, { kind: 'free' }>;
  ctx: AthleteContext;
  watch: WatchSleep | null;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
  onSkip: () => void;
}

/** The coach's current question (bubble) and the controls to answer it: chips, times or periods. */
export function ContextQuestion({ question, ctx, watch, busy, onAnswer, onSkip }: ContextQuestionProps) {
  return (
    <View style={styles.wrap} testID={`context-question-${question.id}`}>
      <CoachBubble>
        <Text variant="body">{question.prompt}</Text>
        {question.hint ? (
          <Text variant="caption" color="textMuted">
            {question.hint}
          </Text>
        ) : null}
      </CoachBubble>
      {question.kind === 'choice' ? <ChoiceControls key={question.id} question={question} ctx={ctx} busy={busy} onAnswer={onAnswer} /> : null}
      {question.kind === 'times' ? <TimesControls key={question.id} question={question} ctx={ctx} watch={watch} busy={busy} onAnswer={onAnswer} /> : null}
      {question.kind === 'periods' ? <PeriodsControls key={question.id} question={question} ctx={ctx} busy={busy} onAnswer={onAnswer} /> : null}
      <Button label="Saltar" variant="ghost" size="sm" icon="skip" disabled={busy} onPress={onSkip} />
    </View>
  );
}

function ChoiceControls({ question, busy, onAnswer }: { question: ChoiceQuestion; ctx: AthleteContext; busy: boolean; onAnswer: (a: Answer) => void }) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  if (!question.text) {
    return (
      <View style={styles.chips}>
        {question.options.map((o) => (
          <Chip key={o.value} label={o.label} disabled={busy} onPress={() => onAnswer({ choice: o.value })} />
        ))}
      </View>
    );
  }
  const ready = choice !== null || text.trim().length > 0;
  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {question.options.map((o) => (
          <Chip key={o.value} label={o.label} selected={choice === o.value} disabled={busy} onPress={() => setChoice(choice === o.value ? null : o.value)} />
        ))}
      </View>
      <TextField placeholder={question.text.placeholder} value={text} onChangeText={setText} maxLength={300} multiline accessibilityLabel="Tu respuesta" />
      <Button label="Seguir" icon="arrowRight" disabled={!ready} loading={busy} onPress={() => onAnswer({ choice, text })} />
    </View>
  );
}

function TimesControls({
  question,
  ctx,
  watch,
  busy,
  onAnswer,
}: {
  question: TimesQuestion;
  ctx: AthleteContext;
  watch: WatchSleep | null;
  busy: boolean;
  onAnswer: (a: Answer) => void;
}) {
  const [times, setTimes] = useState<Partial<Record<HabitField, string | null>>>(() => initialTimes(question, ctx, watch));
  const fromWatch = watchPrefills(question, ctx, watch);
  return (
    <View style={styles.form}>
      {fromWatch ? (
        <Text variant="caption" color="textMuted">
          He marcado lo que dice tu reloj de las últimas semanas. Cámbialo si no es lo normal.
        </Text>
      ) : null}
      {question.fields.map((f) => {
        const value = times[f.field] ?? null;
        const presets = value && !f.presets.includes(value) ? [...f.presets, value].sort() : f.presets;
        return (
          <View key={f.field} style={styles.timeRow}>
            <Text variant="callout" color="textMuted">
              {f.label}
            </Text>
            <View style={styles.chips} accessibilityLabel={f.label}>
              {presets.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  selected={value === t}
                  disabled={busy}
                  onPress={() => setTimes({ ...times, [f.field]: value === t ? null : t })}
                />
              ))}
            </View>
          </View>
        );
      })}
      <Button label="Seguir" icon="arrowRight" loading={busy} onPress={() => onAnswer({ times })} />
    </View>
  );
}

function PeriodsControls({ question, ctx, busy, onAnswer }: { question: PeriodsQuestion; ctx: AthleteContext; busy: boolean; onAnswer: (a: Answer) => void }) {
  const [periods, setPeriods] = useState<ContextPeriod[]>(() => ctx.periods.filter((p) => p.kind === question.periodKind));
  const [from, setFrom] = useState<ISODate | null>(null);
  const [to, setTo] = useState<ISODate | null>(null);
  const [label, setLabel] = useState(question.defaultLabel);
  const [error, setError] = useState<string | null>(null);
  const today = todayISO();
  const add = () => {
    if (!from || !to) return setError('Elige las dos fechas.');
    if (to < from) return setError('La fecha de fin va después de la de inicio.');
    if (periods.length >= 4) return setError('Como mucho 4 épocas de cada tipo.');
    setError(null);
    setPeriods([...periods, { kind: question.periodKind, from, to, label: label.trim() || question.defaultLabel, eventId: null }]);
    setFrom(null);
    setTo(null);
    setLabel(question.defaultLabel);
  };
  return (
    <View style={styles.form}>
      {periods.map((p, i) => (
        <Card key={`${p.from}-${p.to}-${i}`} padding="md">
          <View style={styles.periodRow}>
            <View style={styles.flex}>
              <Text variant="bodyStrong">{p.label}</Text>
              <Text variant="caption" color="textMuted">
                {periodRange(p)}
              </Text>
            </View>
            <IconButton icon="trash" accessibilityLabel={`Quitar ${p.label}`} onPress={() => setPeriods(periods.filter((_x, j) => j !== i))} />
          </View>
        </Card>
      ))}
      <Card padding="md">
        <View style={styles.form}>
          <DateField label="Desde" value={from} minimumDate={today} onChange={setFrom} />
          <DateField label="Hasta" value={to} minimumDate={from ?? today} onChange={setTo} />
          <TextField label="Nombre" value={label} maxLength={60} onChangeText={setLabel} />
          {error ? (
            <Text variant="caption" color="danger">
              {error}
            </Text>
          ) : null}
          <Button label="Añadir" icon="add" variant="secondary" disabled={busy} onPress={add} />
        </View>
      </Card>
      <Button
        label={periods.length > 0 ? 'Seguir' : 'No tengo, de momento'}
        icon="arrowRight"
        loading={busy}
        onPress={() => onAnswer({ periods })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  form: { gap: space.md },
  timeRow: { gap: space.xs },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1, gap: space.xxs },
});
