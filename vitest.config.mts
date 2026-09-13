import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // The real `vscode` module only exists inside an extension host.
    alias: { vscode: resolve(process.cwd(), 'test/vscode-stub.ts') },
  },
})
