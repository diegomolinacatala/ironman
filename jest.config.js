/** App + domain tests (jest-expo). Backend tests run with `node --test` (see package.json). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  // Reanimated's own mock needs the native worklets runtime: every test gets a plain stand-in.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Screen tests render whole flows; under a loaded machine (CI, full run) 5 s is not enough.
  testTimeout: 20000,
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/data/**/*.ts', '!src/**/__tests__/**', '!src/**/*.d.ts', '!src/test/**'],
  coverageThreshold: {
    './src/domain/': { lines: 80, functions: 80, branches: 70 },
  },
};
