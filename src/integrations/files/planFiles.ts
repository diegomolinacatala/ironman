/**
 * Files and feeds for "Importar un plan":
 * - expo-document-picker 58 (`getDocumentAsync`, copied to the cache so
 *   expo-file-system can read it) for PDF, CSV and Excel;
 * - expo-file-system 58 object API (`new File(uri).text() / .bytes() / .base64()`);
 *   on web the picker returns a browser `File` instead;
 * - plan photos reuse the meal photo pipeline but keep more detail (1600 px),
 *   because a training table has small text;
 * - calendar feeds (TrainingPeaks iCal) are fetched from the device: the
 *   private feed URL never reaches our server.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

import { fitWithin, stripDataUrlPrefix } from '../camera/photoMath';

export type PlanFileKind = 'pdf' | 'csv' | 'xlsx';

export interface PickedPlanFile {
  name: string;
  kind: PlanFileKind;
  size: number | null;
  /** Native file URI, or null on web (then `webFile` is set). */
  uri: string | null;
  webFile: Blob | null;
}

export const PDF_MAX_BYTES = 4_500_000;
export const SHEET_MAX_BYTES = 5_000_000;
export const PLAN_PHOTO_MAX_SIDE = 1600;
const FEED_MAX_CHARS = 2_000_000;
const FEED_TIMEOUT_MS = 20_000;

const MIME: Record<PlanFileKind, string[]> = {
  pdf: ['application/pdf'],
  csv: ['text/csv', 'text/comma-separated-values', 'text/plain', 'text/tab-separated-values', 'application/csv'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
};

export function fileKindOf(name: string, mimeType?: string | null): PlanFileKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  if (mimeType) {
    for (const [kind, types] of Object.entries(MIME) as [PlanFileKind, string[]][]) if (types.includes(mimeType)) return kind;
  }
  return null;
}

/** Opens the system file picker. Null when cancelled. Throws with a Spanish message for unsupported files. */
export async function pickPlanFile(kinds: readonly PlanFileKind[]): Promise<PickedPlanFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: kinds.flatMap((k) => MIME[k]),
    copyToCacheDirectory: true,
    multiple: false,
    base64: false,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const kind = fileKindOf(asset.name, asset.mimeType);
  if (!kind || !kinds.includes(kind)) {
    throw new Error(kinds.includes('pdf') ? 'Elige un archivo PDF.' : 'Elige un archivo .xlsx o .csv. Si es un .xls antiguo, guárdalo como .xlsx.');
  }
  const max = kind === 'pdf' ? PDF_MAX_BYTES : SHEET_MAX_BYTES;
  if (asset.size && asset.size > max) throw new Error(kind === 'pdf' ? 'El PDF es demasiado grande (máximo 4,5 MB).' : 'El archivo es demasiado grande (máximo 5 MB).');
  return { name: asset.name, kind, size: asset.size ?? null, uri: Platform.OS === 'web' ? null : asset.uri, webFile: asset.file ?? null };
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function readPlanFileText(file: PickedPlanFile): Promise<string> {
  if (file.webFile) return file.webFile.text();
  if (!file.uri) throw new Error('No he podido leer el archivo.');
  return new File(file.uri).text();
}

export async function readPlanFileBytes(file: PickedPlanFile): Promise<Uint8Array> {
  if (file.webFile) return new Uint8Array(await file.webFile.arrayBuffer());
  if (!file.uri) throw new Error('No he podido leer el archivo.');
  return new File(file.uri).bytes();
}

export async function readPlanFileBase64(file: PickedPlanFile): Promise<string> {
  if (file.webFile) return bytesToBase64(await readPlanFileBytes(file));
  if (!file.uri) throw new Error('No he podido leer el archivo.');
  return new File(file.uri).base64();
}

/** Photo of the plan (camera or library) → JPEG base64 ≤ 1600 px, or null when cancelled. */
export async function pickPlanPhoto(source: 'camera' | 'library'): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9, allowsEditing: false, exif: false };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
      if (!permission?.granted) throw new Error('Sin acceso a la cámara. Actívalo en Ajustes > Apps > Road to Ironman > Cámara.');
    }
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const owned: { release(): void }[] = [];
  const keep = <T extends { release(): void }>(v: T): T => {
    owned.push(v);
    return v;
  };
  try {
    const max = PLAN_PHOTO_MAX_SIDE;
    const decoded = keep(await keep(ImageManipulator.manipulate(asset.uri, { maxWidth: max, maxHeight: max })).renderAsync());
    const target = fitWithin(decoded.width, decoded.height, max);
    const image = target ? keep(await keep(ImageManipulator.manipulate(decoded)).resize(target).renderAsync()) : decoded;
    const saved = await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG, base64: true });
    const base64 = stripDataUrlPrefix(saved.base64 ?? '');
    if (!base64) throw new Error('empty');
    return base64;
  } catch (error) {
    logger.warn('plan photo: could not process', error);
    throw new Error('No se pudo preparar la foto. Prueba con otra.');
  } finally {
    [...owned].reverse().forEach((o) => {
      try {
        o.release();
      } catch {
        // already released
      }
    });
  }
}

/** Downloads an iCal feed (https URL already normalized). Throws with a Spanish message. */
export async function fetchCalendarFeed(url: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { headers: { Accept: 'text/calendar, text/plain, */*' }, signal: controller.signal });
    if (res.status === 404 || res.status === 410) throw new Error('Ese enlace ya no existe. Copia de nuevo el enlace del calendario en TrainingPeaks.');
    if (res.status === 401 || res.status === 403) throw new Error('TrainingPeaks no deja leer ese calendario. Comprueba que tu cuenta sea Premium y copia el enlace de nuevo.');
    if (!res.ok) throw new Error(`El calendario respondió con un error (${res.status}). Inténtalo más tarde.`);
    const text = await res.text();
    if (text.length > FEED_MAX_CHARS) throw new Error('El calendario es demasiado grande.');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Ese enlace no es un calendario (.ics). Copia el enlace de «Calendar sync» de TrainingPeaks.');
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('El calendario tarda demasiado en responder. Inténtalo de nuevo.');
    if (error instanceof Error && /^(Ese|TrainingPeaks|El calendario)/.test(error.message)) throw error;
    logger.warn('calendar feed: fetch failed', error);
    throw new Error('No he podido descargar el calendario. Comprueba la conexión y el enlace.');
  } finally {
    clearTimeout(timer);
  }
}
