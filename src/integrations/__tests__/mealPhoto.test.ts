/**
 * Meal photos against fakes of expo-image-picker / expo-image-manipulator / expo-file-system:
 * permission errors, cancel, downscale to ≤ 1024 px, private copies and sign-out cleanup.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { clearMealPhotos, deleteMealPhoto, mealPhotoUri, pickMealPhoto, saveMealPhoto } from '../camera/mealPhoto';

interface FakeFs {
  files: Set<string>;
  dirs: Set<string>;
}

jest.mock('expo-file-system', () => {
  const fs = { files: new Set<string>(), dirs: new Set<string>() };
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return fs.files.has(this.uri);
    }
    delete() {
      fs.files.delete(this.uri);
    }
    async copy(target: { uri: string }) {
      fs.files.add(target.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return fs.dirs.has(this.uri);
    }
    create() {
      fs.dirs.add(this.uri);
    }
    delete() {
      fs.dirs.delete(this.uri);
      [...fs.files].filter((f) => f.startsWith(`${this.uri}/`)).forEach((f) => fs.files.delete(f));
    }
  }
  return { fs, File, Directory, Paths: { document: { uri: 'file:///docs' } } };
});

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///tmp/camera.jpg', width: 4032, height: 3024 }] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock('expo-image-manipulator', () => {
  const resized: { width?: number | null; height?: number | null }[] = [];
  const image = (width: number, height: number) => ({
    width,
    height,
    release: jest.fn(),
    saveAsync: jest.fn(async () => ({ uri: 'file:///cache/out.jpg', width, height, base64: 'data:image/jpeg;base64,QUJD' })),
  });
  const context = (w: number, h: number) => ({
    release: jest.fn(),
    renderAsync: jest.fn(async () => image(w, h)),
    resize: (size: { width: number; height: number }) => {
      resized.push(size);
      return context(size.width, size.height);
    },
  });
  return {
    resized,
    SaveFormat: { JPEG: 'jpeg' },
    // Decoding "honours" maxWidth only (a rotated photo can still exceed on the other side).
    ImageManipulator: { manipulate: jest.fn(() => context(1024, 1365)) },
  };
});

const { fs } = jest.requireMock<{ fs: FakeFs }>('expo-file-system');
const picker = jest.requireMock<{
  requestCameraPermissionsAsync: jest.Mock<() => Promise<{ granted: boolean }>>;
}>('expo-image-picker');
const manipulator = jest.requireMock<{ resized: unknown[] }>('expo-image-manipulator');

const ID = '2f1c6a1e-0b5e-4c1f-9a0e-6f1d2c3b4a5e';

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  manipulator.resized.length = 0;
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
});

describe('meal photos', () => {
  test('camera photo → JPEG ≤ 1024 px with raw base64', async () => {
    const photo = await pickMealPhoto('camera');
    expect(manipulator.resized).toEqual([{ width: 768, height: 1024 }]);
    expect(photo).toEqual({ uri: 'file:///cache/out.jpg', base64: 'QUJD', width: 768, height: 1024 });
  });

  test('denied camera explains Ajustes; a cancelled library pick resolves null', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickMealPhoto('camera')).rejects.toThrow(/Ajustes/);
    await expect(pickMealPhoto('library')).resolves.toBeNull();
  });

  test('copies are kept privately per nutrition log and can be deleted', async () => {
    const photo = { uri: 'file:///cache/out.jpg', base64: 'QUJD', width: 768, height: 1024 };
    expect(mealPhotoUri(ID)).toBeNull();
    expect(await saveMealPhoto(ID, photo)).toBe(`file:///docs/meals/${ID}.jpg`);
    expect(mealPhotoUri(ID)).toBe(`file:///docs/meals/${ID}.jpg`);
    await deleteMealPhoto(ID);
    expect(mealPhotoUri(ID)).toBeNull();
  });

  test('ids that are not uuid-like never become paths', async () => {
    const photo = { uri: 'file:///cache/out.jpg', base64: 'QUJD', width: 1, height: 1 };
    expect(await saveMealPhoto('../../escape', photo)).toBeNull();
    expect(mealPhotoUri('../../escape')).toBeNull();
  });

  test('sign-out cleanup removes every stored photo', async () => {
    await saveMealPhoto(ID, { uri: 'file:///cache/out.jpg', base64: 'QUJD', width: 1, height: 1 });
    await clearMealPhotos();
    expect(mealPhotoUri(ID)).toBeNull();
    expect(fs.dirs.size).toBe(0);
  });
});
