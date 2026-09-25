import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    // dist/ is built ONCE here, before any test file runs, and installed by rename —
    // a per-file `beforeAll` tsc rewrote the shared dist/ under running bins.
    globalSetup: ['./src/__tests__/helpers/build-dist.ts'],
    environment: 'node',
    testTimeout: 10_000,
    pool: 'forks',
  },
})
