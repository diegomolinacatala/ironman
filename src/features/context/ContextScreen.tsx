import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMetrics } from '@/data/queries';
import { addDays, todayISO } from '@/domain/dates';
import type { AthleteContext, Profile } from '@/domain/types';
import { UserBubble } from '@/features/talk/TurnView';
import { Button, Card, ErrorNotice, GroupedList, IconButton, ListRow, ProgressBar, Screen, SectionHeader, Text, space } from '@/ui';

import { KeyboardAvoider } from '../settings/KeyboardAvoider';
import { ContextChat, contextAiReady } from './ContextChat';
import { ContextQuestion } from './ContextQuestion';
import {
  SECTION_TITLE,
  answerText,
  applyAnswer,
  finish,
  followUps,
  nextQuestion,
  progress,
  questionById,
  removeNote,
  skip,
  startContext,
  summarySections,
  watchSleepTimes,
  type Answer,
  type Question,
} from './interviewModel';
import { useContextSave } from './useContextSave';

type Mode = 'interview' | 'summary' | 'chat';

interface Exchange {
  id: string;
  question: string;
  answer: string;
}

const WATCH_DAYS = 21;

/**
 * Tú › Tu contexto: a short guided interview (one question at a time, chips,
 * resumable, every answer saved) and, at the end, «¿Algo más que deba saber?»
 * with the coach. Once finished it shows what the coach knows, each row
 * editable, plus the chat again.
 */
export function ContextScreen({ profile }: { profile: Profile }) {
  const sports = profile.sports;
  const [ctx, setCtx] = useState<AthleteContext>(() => startContext(profile.athleteContext));
  const [mode, setMode] = useState<Mode>(() => (ctx.completedAt ? 'summary' : 'interview'));
  const [editing, setEditing] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const resumed = useMemo(() => ctx.answered.length > 0 && !ctx.completedAt, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { save, saving, error } = useContextSave();
  const today = todayISO();
  const metrics = useMetrics({ from: addDays(today, -WATCH_DAYS), to: today });
  const watch = useMemo(() => watchSleepTimes(metrics.data ?? []), [metrics.data]);

  const commit = (next: AthleteContext): void => {
    const previous = ctx;
    setCtx(next);
    void save(next, previous).then((stored) => {
      // Keep the life-event ids of new periods (the next save must not create them again).
      if (stored) setCtx((now) => (now === next ? stored : { ...now, periods: stored.periods }));
    });
  };

  const current: Question | null = editing ? questionById(editing) : nextQuestion(ctx, sports);
  // Editing from the summary: that question, then the follow-ups it opened (occupation → load…), then back.
  const afterAnswer = (next: AthleteContext, answeredId: string): void => {
    if (!editing) return;
    const follow = followUps(answeredId, next, sports);
    if (follow) return setEditing(follow);
    setEditing(null);
    if (next.completedAt) setMode('summary');
  };

  const answer = (q: Question, a: Answer): void => {
    const next = applyAnswer(ctx, q.id, a);
    setExchanges((list) => [...list.filter((e) => e.id !== q.id), { id: q.id, question: q.prompt, answer: answerText(q, next) ?? 'Saltar' }]);
    commit(next);
    afterAnswer(next, q.id);
  };

  const skipQuestion = (q: Question): void => {
    const next = skip(ctx, q.id);
    setExchanges((list) => [...list.filter((e) => e.id !== q.id), { id: q.id, question: q.prompt, answer: 'Prefiero saltarla' }]);
    commit(next);
    afterAnswer(next, q.id);
  };

  const done = (): void => {
    commit(finish(ctx));
    setMode('summary');
  };

  const p = progress(ctx, sports);
  const aiReady = contextAiReady(profile.aiConsentAt);

  return (
    <KeyboardAvoider>
      <Screen inSheet contentStyle={styles.content}>
        {error ? <ErrorNotice message={error} /> : null}
        {mode === 'summary' ? (
          <Summary
            ctx={ctx}
            profile={profile}
            onEdit={(id) => {
              setEditing(id);
              setExchanges([]);
              setMode('interview');
            }}
            onChat={() => setMode('chat')}
            onRemoveNote={(i) => commit(removeNote(ctx, i))}
          />
        ) : null}
        {mode === 'chat' ? (
          <ContextChat ctx={ctx} aiReady={aiReady} onNote={commit} onDone={() => setMode('summary')} doneLabel="Listo" />
        ) : null}
        {mode === 'interview' ? (
          <View style={styles.interview}>
            {editing ? null : (
              <View style={styles.progress}>
                <Text variant="callout" color="textMuted">
                  {resumed && exchanges.length === 0 ? 'Seguimos donde lo dejaste. ' : ''}
                  Unos 3 minutos. Puedes saltar lo que quieras y cambiarlo cuando quieras.
                </Text>
                <ProgressBar value={p.total > 0 ? p.done / p.total : 0} accessibilityLabel={`${p.done} de ${p.total} preguntas`} />
              </View>
            )}
            {exchanges.map((e) => (
              <View key={e.id} style={styles.exchange}>
                <Text variant="caption" color="textMuted">
                  {e.question}
                </Text>
                <UserBubble text={e.answer} channel="text" />
              </View>
            ))}
            {current && current.kind !== 'free' ? (
              <ContextQuestion
                key={current.id}
                question={current}
                ctx={ctx}
                watch={watch}
                busy={saving}
                onAnswer={(a) => answer(current, a)}
                onSkip={() => skipQuestion(current)}
              />
            ) : (
              <ContextChat ctx={ctx} aiReady={aiReady} onNote={commit} onDone={done} doneLabel="Terminar" />
            )}
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoider>
  );
}

function Summary({
  ctx,
  profile,
  onEdit,
  onChat,
  onRemoveNote,
}: {
  ctx: AthleteContext;
  profile: Profile;
  onEdit: (id: string) => void;
  onChat: () => void;
  onRemoveNote: (index: number) => void;
}) {
  const sections = summarySections(ctx, profile.sports);
  return (
    <View style={styles.summary} testID="context-summary">
      <Text variant="callout" color="textMuted">
        Esto es lo que el coach sabe de ti. Lo usa para repartir el tiempo entre deportes, ajustar el volumen a tu vida y elegir a qué
        hora entrenas. Toca una fila para cambiarla.
      </Text>
      {sections.map((s) => (
        <View key={s.section} style={styles.section}>
          <SectionHeader title={SECTION_TITLE[s.section]} />
          <GroupedList>
            {s.rows.map((r) => (
              <ListRow key={r.id} title={r.label} subtitle={r.value} onPress={() => onEdit(r.id)} />
            ))}
          </GroupedList>
        </View>
      ))}
      <View style={styles.section}>
        <SectionHeader title={SECTION_TITLE.more} />
        {ctx.notes.map((n, i) => (
          <Card key={`${i}-${n}`} padding="md">
            <View style={styles.noteRow}>
              <Text variant="body" style={styles.flex}>
                {n}
              </Text>
              <IconButton icon="trash" accessibilityLabel="Quitar nota" onPress={() => onRemoveNote(i)} />
            </View>
          </Card>
        ))}
        <Button label="Contarle algo más al coach" icon="coach" variant="secondary" onPress={onChat} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingBottom: 160 },
  interview: { gap: space.lg },
  progress: { gap: space.sm },
  exchange: { gap: space.xs },
  summary: { gap: space.xl },
  section: { gap: space.sm },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
