import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { microemuServer } from './server/emulator.js'

export default defineConfig({
  base: './',
  plugins: [microemuServer()],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.sessions/**', '**/server/**', '**/.research/**'],
    },
  },
})
