import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // Let jsdom provide localStorage instead of Node's experimental implementation.
    execArgv: Number(process.versions.node.split('.')[0]) >= 26 ? ['--no-webstorage'] : [],
  },
})
