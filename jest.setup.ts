/** Global jest setup for the app tests (see jest.config.js). */
jest.mock('react-native-reanimated', () => jest.requireActual('./src/test/reanimatedMock'));
// The theme reads the stored light/dark preference (src/ui/appearance.ts) on every screen.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
