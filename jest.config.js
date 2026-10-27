export default {
  testEnvironment: 'jsdom',
  modulePaths: ['<rootDir>/lib', '<rootDir>/lib/dashboard'],
  moduleNameMapper: {
    // Stylesheets come first: Jest uses the first pattern that matches, and a path-prefixed import such as
    // "dashboard/styles/x.scss" would otherwise map to the real file and be parsed as JavaScript
    '\\.scss$': '<rootDir>/test/stubs/scss.cjs',
    // Stub esbuild virtual modules that have no real files on disk
    '^classic-theme-styles$': '<rootDir>/test/stubs/classic-theme-styles.js',
    '^client-bundle$': '<rootDir>/test/stubs/client-bundle.js',
    '^css-content$':   '<rootDir>/test/stubs/css-content.js',
    // Stub tippy.js (not available in jsdom)
    '^tippy\\.js$': '<rootDir>/test/stubs/tippy.js',
    // Map path-prefixed imports to lib subdirectories
    '^constants/(.*)$': '<rootDir>/lib/constants/$1',
    '^dashboard/(.*)$': '<rootDir>/lib/dashboard/$1',
    '^hooks/(.*)$': '<rootDir>/lib/hooks/$1',
    '^lib/(.*)$': '<rootDir>/lib/$1',
    '^providers/(.*)$': '<rootDir>/lib/providers/$1',
    '^styles/(.*)$': '<rootDir>/test/stubs/scss.cjs',
    '^util/(.*)$':  '<rootDir>/lib/util/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup-react-act.js'],
  extensionsToTreatAsEsm: ['.jsx'],
  transform: {
    '^.+\\.(js|jsx)$': ['@swc/jest', {
      jsc: {
        parser: { syntax: 'ecmascript', jsx: true },
        transform: { react: { runtime: 'automatic' } },
      },
      module: { type: 'es6' },
    }],
  },
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js'
  ],
  injectGlobals: true
};