import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useUpdateProfile } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Card, Divider, ErrorNotice, Icon, IconButton, Text, TextField, haptics, space, useTheme } from '@/ui';

import { confirmAction } from '../settings/confirm';
import { COACH_NOTE_MAX, addNote, editNote, joinNoteLines, noteError, noteLines, removeNote } from './coachNotesModel';

/** "Lo que tu coach sabe de ti": one fact per line; edit, delete or add your own. */
export function CoachNotesSection({ notes }: { notes: string | null }) {
  const update = useUpdateProfile();
  const lines = noteLines(notes);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string[]): Promise<boolean> => {
    setError(null);
    try {
      await update.mutateAsync({ coachNotes: joinNoteLines(next) });
      haptics.success();
      return true;
    } catch (err) {
      logger.warn('tú: coach notes save failed', err);
      setError(errorMessage(err, 'No se pudo guardar. Inténtalo de nuevo.'));
      return false;
    }
  };

  const onAdd = async () => {
    const problem = noteError(draft, lines);
    if (problem) return setError(problem);
    if (await save(addNote(lines, draft))) setDraft('');
  };

  const onEdit = async () => {
    if (!editing) return;
    const problem = noteError(editing.text, lines, editing.index);
    if (problem) return setError(problem);
    if (await save(editNote(lines, editing.index, editing.text))) setEditing(null);
  };

  const onRemove = async (index: number) => {
    const ok = await confirmAction({
      title: '¿Que lo olvide?',
      message: lines[index],
      confirmLabel: 'Olvidar',
      destructive: true,
    });
    if (ok) await save(removeNote(lines, index));
  };

  return (
    <View style={styles.wrap}>
      <Card padding="md">
        {lines.length === 0 ? (
          <Text variant="callout" color="textMuted" style={styles.empty}>
            Aún no sabe nada de ti. Cuéntale tus horarios, lesiones o lo que prefieres, aquí o hablándole.
          </Text>
        ) : (
          lines.map((line, index) => (
            <View key={`${index}-${line}`}>
              {index > 0 ? <Divider /> : null}
              {editing?.index === index ? (
                <EditLine
                  text={editing.text}
                  saving={update.isPending}
                  onChange={(text) => setEditing({ index, text })}
                  onSave={() => void onEdit()}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <NoteLine
                  text={line}
                  onEdit={() => {
                    setError(null);
                    setEditing({ index, text: line });
                  }}
                  onRemove={() => void onRemove(index)}
                />
              )}
            </View>
          ))
        )}
      </Card>
      <View style={styles.add}>
        <View style={styles.flex}>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder="Ej.: los lunes no puedo nadar"
            accessibilityLabel="Algo que tu coach deba saber"
            maxLength={COACH_NOTE_MAX}
            returnKeyType="done"
            onSubmitEditing={() => void onAdd()}
          />
        </View>
        <Button label="Añadir" icon="add" variant="secondary" disabled={!draft.trim()} loading={update.isPending && !editing} onPress={() => void onAdd()} />
      </View>
      {error ? <ErrorNotice message={error} /> : null}
    </View>
  );
}

function NoteLine({ text, onEdit, onRemove }: { text: string; onEdit: () => void; onRemove: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.line}>
      <Icon name="lightbulb" size={16} color={colors.textMuted} />
      <Text variant="callout" style={styles.flex}>
        {text}
      </Text>
      <IconButton icon="edit" size={44} accessibilityLabel={`Editar: ${text}`} onPress={onEdit} />
      <IconButton icon="trash" size={44} accessibilityLabel={`Borrar: ${text}`} onPress={onRemove} />
    </View>
  );
}

interface EditLineProps {
  text: string;
  saving: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditLine({ text, saving, onChange, onSave, onCancel }: EditLineProps) {
  return (
    <View style={styles.editing}>
      <TextField value={text} onChangeText={onChange} autoFocus maxLength={COACH_NOTE_MAX} accessibilityLabel="Editar nota" multiline />
      <View style={styles.editActions}>
        <Button label="Cancelar" variant="ghost" size="sm" onPress={onCancel} />
        <Button label="Guardar" icon="check" size="sm" loading={saving} disabled={!text.trim()} onPress={onSave} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  flex: { flex: 1 },
  empty: { padding: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.xs, minHeight: 48 },
  editing: { gap: space.sm, paddingVertical: space.sm },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  add: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
