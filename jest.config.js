export default {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    // Map absolute imports to lib directory
    '^dashboard/(.*)$': '<rootDir>/lib/dashboard/$1',
    '^constants/(.*)$': '<rootDir>/lib/constants/$1',
    '^styles/(.*)$': '<rootDir>/lib/styles/$1',
    '^lib/(.*)$': '<rootDir>/lib/$1',
  },
  transform: {},
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js'
  ],
  injectGlobals: true
};