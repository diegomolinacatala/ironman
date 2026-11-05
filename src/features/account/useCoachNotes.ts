import { useState } from 'react';

import { useUpdateProfile } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { confirmAction } from '../settings/confirm';
import { addNote, editNote, joinNoteLines, noteError, noteLines, removeNote } from './coachNotesModel';

export interface NoteEditing {
  index: number;
  text: string;
}

export interface CoachNotesState {
  lines: string[];
  editing: NoteEditing | null;
  setEditing: (editing: NoteEditing | null) => void;
  draft: string;
  setDraft: (draft: string) => void;
  error: string | null;
  saving: boolean;
  startEdit: (index: number) => void;
  onAdd: () => Promise<void>;
  onEdit: () => Promise<void>;
  onRemove: (index: number) => Promise<void>;
}

/** State + saves of "Lo que tu coach sabe de ti" (one fact per line in `profile.coachNotes`). */
export function useCoachNotes(notes: string | null): CoachNotesState {
  const update = useUpdateProfile();
  const lines = noteLines(notes);
  const [editing, setEditing] = useState<NoteEditing | null>(null);
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
    const ok = await confirmAction({ title: '¿Que lo olvide?', message: lines[index], confirmLabel: 'Olvidar', destructive: true });
    if (ok) await save(removeNote(lines, index));
  };

  const startEdit = (index: number) => {
    setError(null);
    setEditing({ index, text: lines[index] ?? '' });
  };

  return { lines, editing, setEditing, draft, setDraft, error, saving: update.isPending, startEdit, onAdd, onEdit, onRemove };
}
