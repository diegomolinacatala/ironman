import { Tag, useTheme } from '@/ui';

import type { StatusCopy } from './jointModel';
import { toneColor } from './palette';

/** Status label that always carries an icon (colour is never the only signal). */
export function StatusTag({ copy, tone = 'soft' }: { copy: StatusCopy; tone?: 'soft' | 'solid' | 'outline' }) {
  const { colors } = useTheme();
  return <Tag label={copy.label} color={toneColor(copy.tone, colors)} icon={copy.icon} tone={tone} />;
}
