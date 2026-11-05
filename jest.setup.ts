/** Global jest setup for the app tests (see jest.config.js). */
jest.mock('react-native-reanimated', () => jest.requireActual('./src/test/reanimatedMock'));
// The theme reads the stored light/dark preference (src/ui/appearance.ts) on every screen.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// expo-audio's native module does not exist under jest (natural-voice playback, src/integrations/speech).
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
  setAudioModeAsync: jest.fn(async () => undefined),
}));
