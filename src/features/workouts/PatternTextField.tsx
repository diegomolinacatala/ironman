import { useState } from 'react';

import { TextField } from '@/ui';

export interface PatternTextFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  /** Only text matching it is reported through `onChange`. */
  pattern: RegExp;
  /** Also the format shown in the error ("AAAA-MM-DD"). */
  placeholder: string;
}

/**
 * Typed date/time field (web). Keeps the raw text while the user types, but:
 * - follows `value` when the parent changes it (e.g. "Hasta" moved by "Desde"),
 * - reverts invalid text to the saved value on blur,
 * so what is shown is always what will be saved.
 */
export function PatternTextField<T extends string>({ label, value, onChange, pattern, placeholder }: PatternTextFieldProps<T>) {
  const [text, setText] = useState<string>(value);
  const [synced, setSynced] = useState<T>(value);
  if (value !== synced) {
    // Derived state: adopt external changes during render (no effect round-trip).
    setSynced(value);
    setText(value);
  }
  const invalid = text.length > 0 && !pattern.test(text);
  return (
    <TextField
      label={label}
      value={text}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      error={invalid ? `Formato ${placeholder}` : null}
      onChangeText={(next) => {
        setText(next);
        if (pattern.test(next)) onChange(next as T);
      }}
      onBlur={() => {
        if (!pattern.test(text)) setText(value);
      }}
    />
  );
}
