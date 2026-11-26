import { router } from 'expo-router';
import { useState } from 'react';

import { formatDayMedium } from '@/domain/dates';
import type { Profile, WeekAnswers, WeekLoad, WeekPriority } from '@/domain/types';
import { LOAD_LABELS, PLANS_MAX, PRIORITY_LABELS, WEEK_LOADS, WEEK_PRIORITIES } from '@/domain/weekQuestions';
import { usePlanWeek } from '@/features/week/usePlanWeek';
import { useWeekData } from '@/features/week/useWeekData';
import { Button, Chip, TextField } from '@/ui';

import { AnswerChips, QuestionCard } from './QuestionCard';

type Save = (patch: Partial<Omit<WeekAnswers, 'weekStart'>>) => Promise<Profile | null>;

/**
 * «Tu semana» (Sunday, and Monday while open): two taps, priority then how busy; the plans
 * text is optional. Answering or closing it stores `sundayDone` (gone for that week).
 */
export function SundayCard({ weekStart, onSave, onAnswered }: { weekStart: string; onSave: Save; onAnswered: () => void }) {
  const [priority, setPriority] = useState<WeekPriority | null>(null);
  const [plans, setPlans] = useState('');
  const [saving, setSaving] = useState(false);

  const answer = async (load: WeekLoad) => {
    if (!priority) return;
    setSaving(true);
    const saved = await onSave({ priority, load, sundayDone: true, ...(plans.trim() ? { plans: plans.trim().slice(0, PLANS_MAX) } : {}) });
    setSaving(false);
    if (saved) onAnswered();
  };

  return (
    <QuestionCard
      testID="week-question-sunday"
      icon="week"
      title="Tu semana"
      detail={priority ? '¿Cómo de liada viene?' : `¿Cómo la ves? Empieza el ${formatDayMedium(weekStart)}.`}
      onDismiss={() => void onSave({ sundayDone: true })}>
      {priority ? (
        <>
          <TextField placeholder="¿Qué planes tienes? (opcional)" accessibilityLabel="¿Qué planes tienes?" value={plans} onChangeText={setPlans} maxLength={PLANS_MAX} />
          <AnswerChips>
            {WEEK_LOADS.map((load) => (
              <Chip key={load} label={LOAD_LABELS[load]} disabled={saving} onPress={() => void answer(load)} />
            ))}
          </AnswerChips>
        </>
      ) : (
        <AnswerChips>
          {WEEK_PRIORITIES.map((p) => (
            <Chip key={p} label={PRIORITY_LABELS[p]} onPress={() => setPriority(p)} />
          ))}
        </AnswerChips>
      )}
    </QuestionCard>
  );
}

/** After answering: plan the week with it now (the athlete reviews the proposal), or later from Plan. */
export function SundayFollowUp({ weekStart, onClose }: { weekStart: string; onClose: () => void }) {
  const data = useWeekData(weekStart);
  const { plan, busy } = usePlanWeek();
  return (
    <QuestionCard testID="week-question-sunday-done" icon="checkCircle" title="Apuntado" detail="Lo tendré en cuenta al planificar tu semana." onDismiss={onClose} dismissLabel="Cerrar">
      <AnswerChips>
        <Button
          label="Planificar semana"
          size="sm"
          loading={busy}
          disabled={data.isLoading}
          onPress={() => void plan(weekStart, data).finally(onClose)}
        />
        <Button
          label="Ver el plan"
          size="sm"
          variant="ghost"
          onPress={() => {
            onClose();
            router.navigate(`/week?week=${weekStart}`);
          }}
        />
      </AnswerChips>
    </QuestionCard>
  );
}
