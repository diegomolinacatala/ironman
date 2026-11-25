/**
 * Hands a bike session to Zwift (or any app that opens .zwo): on iPhone the
 * share sheet with the file (AirDrop to the computer, Files › Zwift/Workouts,
 * Mail…); on the web demo a download. The XML comes from `domain/zwo.ts`.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

const DIR = 'zwift';

export type ShareZwoResult = 'shared' | 'unavailable' | 'failed';

function download(fileName: string, xml: string): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareZwo(fileName: string, xml: string): Promise<ShareZwoResult> {
  try {
    if (Platform.OS === 'web') {
      download(fileName, xml);
      return 'shared';
    }
    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    const dir = new Directory(Paths.cache, DIR);
    dir.create({ idempotent: true, intermediates: true });
    const file = new File(dir, fileName);
    if (file.exists) file.delete();
    await file.write(xml);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/xml', UTI: 'public.xml', dialogTitle: 'Exportar a Zwift' });
    return 'shared';
  } catch (error) {
    logger.warn('zwo share failed', error);
    return 'failed';
  }
}
