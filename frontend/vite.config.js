import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  test: {
    // The pure-function and service suites need no DOM, but the component
    // tests do. Vitest 4 dropped per-glob environments, so jsdom is the
    // default for every file — a few milliseconds on the pure ones.
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: true,
    restoreMocks: true,
  },
})
