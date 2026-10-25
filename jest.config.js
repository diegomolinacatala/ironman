/** App + domain tests (jest-expo). Backend tests run with `node --test` (see package.json). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/data/**/*.ts', '!src/**/__tests__/**', '!src/**/*.d.ts'],
  coverageThreshold: {
    './src/domain/': { lines: 80, functions: 80, branches: 70 },
  },
};
