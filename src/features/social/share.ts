/**
 * Sharing / copying helpers for invitations. Web uses the Web Share API when
 * available and falls back to the clipboard.
 */
import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';

import { logger } from '@/lib/logger';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed';

export function inviteMessage(username: string): string {
  return `¡Entrena conmigo en Rebufo! Búscame como @${username}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text);
  } catch (error) {
    logger.warn('clipboard copy failed', error);
    return false;
  }
}

interface WebNavigatorShare {
  share?: (data: { text?: string; title?: string }) => Promise<void>;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

async function shareOnWeb(message: string): Promise<ShareOutcome> {
  const nav = (globalThis as { navigator?: WebNavigatorShare }).navigator;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text: message, title: 'Rebufo' });
      return 'shared';
    } catch (error) {
      if (isAbortError(error)) return 'dismissed';
      logger.warn('web share failed, copying instead', error);
    }
  }
  const copied = await copyText(message);
  if (!copied) throw new Error('No se ha podido compartir ni copiar la invitación.');
  return 'copied';
}

/** Opens the share sheet with the invitation text. Throws a Spanish error on failure. */
export async function shareInvite(username: string): Promise<ShareOutcome> {
  const message = inviteMessage(username);
  if (Platform.OS === 'web') return shareOnWeb(message);
  try {
    const result = await Share.share({ message });
    return result.action === Share.sharedAction ? 'shared' : 'dismissed';
  } catch (error) {
    logger.warn('native share failed', error);
    throw new Error('No se ha podido abrir el menú de compartir.');
  }
}
