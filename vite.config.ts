import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default {
  root: 'src/renderer',
  publicDir: 'public',
  plugins: [
    react(),
    electron([
      {
        entry: resolve(__dirname, 'src/main/index.ts'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'out/main'),
            rollupOptions: {
              // 必须整包 external：否则 Rollup 会打进 bundle，`./libs/core` 会相对 out/main 解析而崩
              external: (id) =>
                id === 'font-list' ||
                id.startsWith('font-list/') ||
                /[/\\]node_modules[/\\]font-list[/\\]/.test(id),
            },
          },
        },
      },
      {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'out/preload'),
            lib: {
              entry: resolve(__dirname, 'src/preload/index.ts'),
              formats: ['cjs'],
              fileName: () => 'index.cjs', // .cjs 才不会被 package.json "type":"module" 当 ESM 解析
            },
          },
        },
        onstart(options) {
          options.reload()
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: '../../out/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
}
