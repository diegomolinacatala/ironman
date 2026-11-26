import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCoach } from '@/data/queries';
import { CONTEXT_RULES_REPLY } from '@/data/demo/coachContext';
import { startOfWeek, todayISO } from '@/domain/dates';
import type { AthleteContext, CoachMessage } from '@/domain/types';
import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { CoachBubble, UserBubble } from '@/features/talk/TurnView';
import { logger } from '@/lib/logger';
import { Button, Icon, Text, TextField, space, useTheme } from '@/ui';

import { addNote } from './interviewModel';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Facts the AI coach saved to its notes from this turn. */
  memory?: string[];
  /** The text was kept as a note of «Tu contexto» (no AI, or the AI saved nothing). */
  savedAsNote?: boolean;
}

export interface ContextChatProps {
  ctx: AthleteContext;
  /** Coach IA available for this athlete (switch on and consent given). */
  aiReady: boolean;
  /** Stores the context with a new note (rules fallback). */
  onNote: (next: AthleteContext) => void;
  onDone: () => void;
  doneLabel: string;
}

/** Whether the in-app AI can answer «¿Algo más?» (free Workers AI, with the athlete's consent). */
export function contextAiReady(aiConsentAt: string | null): boolean {
  return isAiCoachEnabled() && aiConsentAt !== null;
}

/**
 * «¿Algo más que deba saber?»: a free chat with the coach. With the AI, the
 * coach answers and saves the durable facts to its notes (`topic: 'context'`:
 * it never touches the plan). Without it (or when it saves nothing), the text
 * is kept as a note of «Tu contexto» and the coach just acknowledges it.
 */
export function ContextChat({ ctx, aiReady, onNote, onDone, doneLabel }: ContextChatProps) {
  const coach = useCoach();
  const { colors } = useTheme();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [current, setCurrent] = useState(ctx);

  const keepNote = (text: string): void => {
    const next = addNote(current, text);
    setCurrent(next);
    onNote(next);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || coach.isPending) return;
    setDraft('');
    const history: CoachMessage[] = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((list) => [...list, { role: 'user', content: text }]);
    if (!aiReady) {
      keepNote(text);
      setTurns((list) => [...list, { role: 'assistant', content: CONTEXT_RULES_REPLY, savedAsNote: true }]);
      return;
    }
    try {
      const response = await coach.mutateAsync({ mode: 'chat', weekStart: startOfWeek(todayISO()), message: text, history, topic: 'context' });
      const remembered = response.engine === 'ai' ? response.memory : [];
      if (remembered.length === 0) keepNote(text);
      setTurns((list) => [...list, { role: 'assistant', content: response.reply, memory: remembered, savedAsNote: remembered.length === 0 }]);
    } catch (err) {
      logger.warn('context chat failed', err);
      keepNote(text);
      setTurns((list) => [...list, { role: 'assistant', content: CONTEXT_RULES_REPLY, savedAsNote: true }]);
    }
  };

  return (
    <View style={styles.wrap} testID="context-chat">
      <CoachBubble>
        <Text variant="body">¿Algo más que deba saber?</Text>
        <Text variant="caption" color="textMuted">
          Lo que quieras: familia, turnos, cómo te sientes con cada deporte… Lo tendré en cuenta al planificar.
        </Text>
      </CoachBubble>
      {turns.map((t, i) =>
        t.role === 'user' ? (
          <UserBubble key={i} text={t.content} channel="text" />
        ) : (
          <CoachBubble key={i}>
            <Text variant="body">{t.content}</Text>
            {(t.memory ?? []).map((m) => (
              <View key={m} style={styles.saved}>
                <Icon name="checkCircle" size={14} color={colors.success} />
                <Text variant="caption" color="textMuted" style={styles.flex}>
                  Apuntado: {m}
                </Text>
              </View>
            ))}
            {t.savedAsNote ? (
              <View style={styles.saved}>
                <Icon name="checkCircle" size={14} color={colors.success} />
                <Text variant="caption" color="textMuted" style={styles.flex}>
                  Guardado en tu contexto.
                </Text>
              </View>
            ) : null}
          </CoachBubble>
        ),
      )}
      <TextField
        placeholder="Escribe aquí…"
        value={draft}
        onChangeText={setDraft}
        multiline
        maxLength={280}
        accessibilityLabel="Tu mensaje para el coach"
      />
      <View style={styles.actions}>
        <Button label="Enviar" icon="send" loading={coach.isPending} disabled={draft.trim().length === 0} onPress={() => void send()} />
        <Button label={doneLabel} variant="ghost" icon="check" disabled={coach.isPending} onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  saved: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
