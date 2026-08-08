// Jest config for the backend test suite.
module.exports = {
  testEnvironment: 'node',
  // Set dummy env vars before any module loads so config/env's required-var
  // check passes without a real .env (the DB/Supabase clients are mocked anyway).
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  // Two roots: this package, plus the per-student unit-test folders the
  // submission guide puts at the repo root (tests/<student-name>/backend).
  // Those files live outside backend/ but require the app by relative path, so
  // nothing else has to change. The frontend half of each student folder is
  // vitest's and is not scanned here — hence the /backend suffix.
  roots: ['<rootDir>', '<rootDir>/../tests'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/[^/]+/frontend/'],
  // A test file at the repo root cannot walk up to backend/node_modules, so
  // `require('supertest')` from tests/<student-name>/backend would not resolve.
  // Name that directory explicitly; the default entry keeps normal lookup.
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
};
