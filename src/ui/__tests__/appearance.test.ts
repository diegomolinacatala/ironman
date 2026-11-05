import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  APPEARANCE_STORAGE_KEY,
  getAppearancePreference,
  loadAppearancePreference,
  resetAppearanceForTests,
  setAppearancePreference,
} from '../appearance';

describe('appearance preference', () => {
  beforeEach(async () => {
    resetAppearanceForTests();
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  test('persists the chosen scheme and reads it back at startup', async () => {
    await setAppearancePreference('dark');
    expect(await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('dark');

    resetAppearanceForTests();
    expect(await loadAppearancePreference()).toBe('dark');
    expect(getAppearancePreference()).toBe('dark');
  });

  test('ignores unknown stored values', async () => {
    await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'sepia');
    expect(await loadAppearancePreference()).toBe('system');
  });

  test('a late startup read does not undo a choice made in this session', async () => {
    await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'dark');
    await setAppearancePreference('light');
    expect(await loadAppearancePreference()).toBe('light');
  });

  test('storage failures keep the in-memory choice', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(setAppearancePreference('dark')).resolves.toBeUndefined();
    expect(getAppearancePreference()).toBe('dark');

    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    expect(await loadAppearancePreference()).toBe('dark');
  });
});
