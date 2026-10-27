/** Global jest setup for the app tests (see jest.config.js). */
jest.mock('react-native-reanimated', () => jest.requireActual('./src/test/reanimatedMock'));
