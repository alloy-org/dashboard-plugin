export default {
  testEnvironment: 'jsdom',
  modulePaths: ['<rootDir>/lib', '<rootDir>/lib/dashboard'],
  moduleNameMapper: {
    // Stub esbuild virtual modules that have no real files on disk
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
    '\\.scss$': '<rootDir>/test/stubs/scss.cjs',
  },
  transform: {},
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js'
  ],
  injectGlobals: true
};