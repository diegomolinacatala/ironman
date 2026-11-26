/**
 * "Háblalo con tu Claude": opens a new chat in the athlete's own Claude (their Pro plan), which
 * reaches Road to Ironman through the personal connector. Long reviews and multi-week planning
 * go there; the in-app coach stays for quick questions.
 */
import { Linking } from 'react-native';

import { logger } from '@/lib/logger';

export const CLAUDE_NEW_CHAT_URL = 'https://claude.ai/new';
export const CLAUDE_STARTER_PROMPT = 'Usa Road to Ironman: revisa cómo voy esta semana frente al plan y dime qué ajustarías y por qué.';

/** New-chat link with the prompt prefilled (`q`). */
export function claudeChatUrl(prompt: string = CLAUDE_STARTER_PROMPT): string {
  return `${CLAUDE_NEW_CHAT_URL}?q=${encodeURIComponent(prompt)}`;
}

/** Opens Claude (the app when installed, the web otherwise). Never throws. */
export async function openClaudeChat(prompt?: string): Promise<boolean> {
  try {
    await Linking.openURL(claudeChatUrl(prompt));
    return true;
  } catch (error) {
    logger.warn('could not open Claude', error);
    return false;
  }
}
