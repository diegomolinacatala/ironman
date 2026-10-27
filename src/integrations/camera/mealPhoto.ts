/**
 * Meal photos: pick (camera / library), downscale to a JPEG for the AI, keep a private copy on
 * the device (photos never leave the phone except for the analysis request).
 *
 * - expo-image-picker 58: `launchCameraAsync` (asks camera permission first) and
 *   `launchImageLibraryAsync` (PHPicker on iOS: no photo-library permission needed).
 * - expo-image-manipulator 58 object API: `ImageManipulator.manipulate(uri, { maxWidth, maxHeight })`
 *   decodes already downsampled (low memory), `.resize()` guarantees ≤ 1024 px on the long side,
 *   `renderAsync()` → `ImageRef.saveAsync({ compress: 0.7, format: JPEG, base64: true })`.
 * - expo-file-system 58 object API: copies live in `Paths.document/meals/<id>.jpg`.
 * Web: picking works (browser file input + canvas); nothing is stored.
 */
import { File, Directory, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { UUID } from '@/domain/types';
import { logger } from '@/lib/logger';

import { fitWithin, isSafeFileId, MEAL_PHOTO_MAX_SIDE, stripDataUrlPrefix } from './photoMath';

export type MealPhotoSource = 'camera' | 'library';

export interface MealPhoto {
  /** Local file URI of the downscaled JPEG (≤ 1024 px, ~0.7 quality). */
  uri: string;
  /** Same image, base64 without the data: prefix — for `analyzeMeal`. */
  base64: string;
  width: number;
  height: number;
}

const PICKER_QUALITY = 0.8;
const JPEG_COMPRESS = 0.7;
const MEALS_DIR = 'meals';
const isWeb = Platform.OS === 'web';

const CAMERA_DENIED = 'Sin acceso a la cámara. Actívalo en Ajustes > Apps > Road to Ironman > Cámara.';
const PICK_FAILED = 'No se pudo abrir la cámara. Prueba a elegir la foto de tu galería.';
const LIBRARY_FAILED = 'No se pudieron abrir tus fotos. Inténtalo de nuevo.';
const PROCESS_FAILED = 'No se pudo preparar la foto. Prueba con otra.';

async function launch(source: MealPhotoSource): Promise<ImagePicker.ImagePickerResult> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: PICKER_QUALITY,
    allowsEditing: false,
    exif: false,
  };
  if (source === 'library') {
    try {
      return await ImagePicker.launchImageLibraryAsync(options);
    } catch (error) {
      logger.warn('meal photo: library failed', error);
      throw new Error(LIBRARY_FAILED);
    }
  }
  if (!isWeb) {
    const permission = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
    if (!permission?.granted) throw new Error(CAMERA_DENIED);
  }
  try {
    return await ImagePicker.launchCameraAsync(options);
  } catch (error) {
    // Simulators and devices without a camera end up here.
    logger.warn('meal photo: camera failed', error);
    throw new Error(PICK_FAILED);
  }
}

/** Downscales to ≤ 1024 px and re-encodes as JPEG with base64. */
async function toJpeg(uri: string): Promise<MealPhoto> {
  const max = MEAL_PHOTO_MAX_SIDE;
  // Native shared objects (decoded bitmaps) are freed explicitly: photos are large.
  const owned: { release(): void }[] = [];
  const keep = <T extends { release(): void }>(value: T): T => {
    owned.push(value);
    return value;
  };
  try {
    const decoded = keep(await keep(ImageManipulator.manipulate(uri, { maxWidth: max, maxHeight: max })).renderAsync());
    const target = fitWithin(decoded.width, decoded.height, max);
    const image = target ? keep(await keep(ImageManipulator.manipulate(decoded)).resize(target).renderAsync()) : decoded;
    const saved = await image.saveAsync({ compress: JPEG_COMPRESS, format: SaveFormat.JPEG, base64: true });
    const base64 = stripDataUrlPrefix(saved.base64 ?? '');
    if (!base64) throw new Error('empty base64');
    return { uri: saved.uri, base64, width: saved.width, height: saved.height };
  } finally {
    [...owned].reverse().forEach((item) => {
      try {
        item.release();
      } catch (error) {
        logger.debug('meal photo: release failed', error);
      }
    });
  }
}

/**
 * Opens the camera or the photo library. Resolves null when the user cancels.
 * Throws Error with a Spanish message when permission is denied (mention Ajustes).
 */
export async function pickMealPhoto(source: MealPhotoSource): Promise<MealPhoto | null> {
  const result = await launch(source);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  try {
    return await toJpeg(asset.uri);
  } catch (error) {
    logger.warn('meal photo: could not process the image', error);
    throw new Error(PROCESS_FAILED);
  }
}

function photoFile(nutritionId: UUID): File | null {
  if (isWeb || !isSafeFileId(nutritionId)) return null;
  return new File(Paths.document, MEALS_DIR, `${nutritionId}.jpg`);
}

/** Copies the photo into the app's documents (meals/<id>.jpg). Returns the stored URI, or null on failure. */
export async function saveMealPhoto(nutritionId: UUID, photo: MealPhoto): Promise<string | null> {
  const target = photoFile(nutritionId);
  if (!target) return null;
  try {
    const dir = new Directory(Paths.document, MEALS_DIR);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    if (target.exists) target.delete();
    await new File(photo.uri).copy(target);
    return target.uri;
  } catch (error) {
    logger.warn('meal photo: could not save the copy', error);
    return null;
  }
}

/** URI of the stored photo of a nutrition log, or null (sync; web/none → null). */
export function mealPhotoUri(nutritionId: UUID): string | null {
  try {
    const file = photoFile(nutritionId);
    return file?.exists ? file.uri : null;
  } catch (error) {
    logger.debug('meal photo: lookup failed', error);
    return null;
  }
}

export async function deleteMealPhoto(nutritionId: UUID): Promise<void> {
  try {
    const file = photoFile(nutritionId);
    if (file?.exists) file.delete();
  } catch (error) {
    logger.warn('meal photo: could not delete', error);
  }
}

/** Deletes every stored meal photo on this device (sign-out, account deletion). Web: no-op. */
export async function clearMealPhotos(): Promise<void> {
  if (isWeb) return;
  try {
    const dir = new Directory(Paths.document, MEALS_DIR);
    if (dir.exists) dir.delete();
  } catch (error) {
    logger.warn('meal photo: could not clear the photos', error);
  }
}
