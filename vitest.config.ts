import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Pruebas de unidad sobre lógica pura (sin red, sin base, sin secretos).
// El alias '@' replica el del tsconfig para poder importar '@/lib/...'.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
