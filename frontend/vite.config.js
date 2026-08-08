import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const nodeModules = path.join(here, 'node_modules')

// The per-student unit tests (tests/<student-name>/frontend, per the
// submission guide) sit above this package, so Node's usual walk-up finds no
// node_modules for their bare imports — react/jsx-dev-runtime, injected by the
// React plugin, fails first. Naming each one keeps resolution inside this
// package; everything those packages import in turn resolves from there.
// react-chartjs-2 is here for a second reason: the chart tests mock it, and a
// mock only applies when the specifier resolves to the same module id the
// component under test imported. Without the alias the mock silently missed
// and Chart.js tried to acquire a canvas jsdom does not implement.
//
// These are applied under `test` ONLY (see below), never to the dev server or
// the build. As a global resolve.alias they rewrote every bare specifier to an
// absolute node_modules path, which took those packages out of Vite's
// dependency pre-bundling. @mui/icons-material ships CommonJS, so the dev
// server then handed the browser a raw `require(...)` module: it threw
// "require is not defined", its default export came back as an object rather
// than a component, and React refused to render it —
// "Element type is invalid ... but got: object. Check the render method of
// `BrandRow`." That blanked every page built on AppShell, the manager
// dashboard included. Files under src/ resolve these packages natively, so
// scoping the aliases to tests costs them nothing.
const HOISTED = [
  'react',
  '@testing-library/react',
  '@testing-library/user-event',
  '@mui/icons-material',
  'react-router',
  'react-chartjs-2',
]

// `$1` carries the subpath, so "react/jsx-dev-runtime" maps too.
const hoistedAliases = HOISTED.map((pkg) => ({
  find: new RegExp(`^${pkg}(/.*)?$`),
  replacement: `${nodeModules.replace(/\\/g, '/')}/${pkg}$1`,
}))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  test: {
    // Test-scoped, so the dev server and build keep Vite's own resolution.
    alias: hoistedAliases,
    // The pure-function and service suites need no DOM, but the component
    // tests do. Vitest 4 dropped per-glob environments, so jsdom is the
    // default for every file — a few milliseconds on the pure ones.
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: true,
    restoreMocks: true,
    // Anything colocated under src/, plus the per-student unit-test folders
    // the submission guide puts at the repo root. Only the frontend half of
    // each student folder is ours — the backend half is jest's.
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../tests/*/frontend/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
  },
  server: {
    // The test files above sit outside this package, so Vite has to be
    // allowed to read them.
    fs: { allow: ['..'] },
  },
})
