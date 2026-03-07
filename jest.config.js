export default {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    // Stub esbuild virtual modules that have no real files on disk
    '^client-bundle$': '<rootDir>/test/stubs/client-bundle.js',
    '^css-content$':   '<rootDir>/test/stubs/css-content.js',
    // Map absolute imports to lib directory
    '^dashboard/(.*)$': '<rootDir>/lib/dashboard/$1',
    '^constants/(.*)$': '<rootDir>/lib/constants/$1',
    '^styles/(.*)$': '<rootDir>/lib/styles/$1',
    '^hooks/(.*)$': '<rootDir>/lib/hooks/$1',
    '^util/(.*)$':  '<rootDir>/lib/util/$1',
    '^lib/(.*)$': '<rootDir>/lib/$1',
    // Bare widget names used by dashboard.js (resolved relative to lib/dashboard/ by esbuild)
    '^(planning|victory-value|mood|calendar|agenda|quotes|ai-plugins|quick-actions|task-domains)$':
      '<rootDir>/lib/dashboard/$1.js',
  },
  transform: {},
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js'
  ],
  injectGlobals: true
};