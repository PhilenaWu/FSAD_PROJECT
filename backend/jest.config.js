// Jest config for the backend test suite.
module.exports = {
  testEnvironment: 'node',
  // Set dummy env vars before any module loads so config/env's required-var
  // check passes without a real .env (the DB/Supabase clients are mocked anyway).
  setupFiles: ['<rootDir>/tests/setup-env.js'],
};
