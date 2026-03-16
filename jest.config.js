export default {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    // Stub esbuild virtual modules that have no real files on disk
    '^client-bundle$': '<rootDir>/test/stubs/client-bundle.js',
    '^css-content$':   '<rootDir>/test/stubs/css-content.js',
    // Stub tippy.js (not available in jsdom)
    '^tippy\\.js$': '<rootDir>/test/stubs/tippy.js',
    // Map absolute imports to lib directory
    '^dashboard/(.*)$': '<rootDir>/lib/dashboard/$1',
    '^constants/(.*)$': '<rootDir>/lib/constants/$1',
    '^styles/(.*)$': '<rootDir>/test/stubs/scss.js',
    '\\.scss$': '<rootDir>/test/stubs/scss.js',
    '^hooks/(.*)$': '<rootDir>/lib/hooks/$1',
    '^util/(.*)$':  '<rootDir>/lib/util/$1',
    '^lib/(.*)$': '<rootDir>/lib/$1',
    // Bare widget names used by dashboard.js (resolved relative to lib/dashboard/ by esbuild)
    '^(planning|victory-value|mood|calendar|agenda|quotes|ai-plugins|quick-actions|recent-notes|task-domains|day-sketch|peak-hours)$':
      '<rootDir>/lib/dashboard/$1.js',
    '^(dashboard-layout-popup|dashboard-settings-popup|config-popup|widget-wrapper|draggable-heading|dream-task|note-editor|dashboard-tippy|quotes-data)$':
      '<rootDir>/lib/dashboard/$1.js',
    '^(data-service|dream-task-service|app-util)$':
      '<rootDir>/lib/$1.js',
    '^providers/(.*)$': '<rootDir>/lib/providers/$1',
  },
  transform: {},
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js'
  ],
  injectGlobals: true
};