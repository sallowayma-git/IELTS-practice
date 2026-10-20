import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// Dev-only command sources, both under developer/tests/dev-mock:
//   VITE_TAURI_MOCK=1    the in-page mock owns the seeded state (legacy previews)
//   VITE_DEV_BACKEND=1   an HTTP mock backend owns the seeded state; the page
//                        only carries a transport shim
// Serve-only and env-gated: normal `vite`, `cargo tauri dev` and `vite build`
// never see either script.
const MOCK_ENABLED = process.env.VITE_TAURI_MOCK === '1'
const DEV_BACKEND_ENABLED = process.env.VITE_DEV_BACKEND === '1'
const DEV_BACKEND_PORT = Number(process.env.VITE_DEV_BACKEND_PORT || 4319)
const MOCK_DIR = resolve(__dirname, '../../developer/tests/dev-mock')
const MOCK_ENTRY = resolve(MOCK_DIR, 'tauri-mock.js')
const DEV_BACKEND_ENTRY = resolve(MOCK_DIR, 'dev-backend-client.js')

function tauriDevMockPlugin() {
    return {
        name: 'ielts-tauri-dev-mock',
        apply: 'serve',
        transformIndexHtml: {
            order: 'pre',
            handler() {
                if (MOCK_ENABLED && DEV_BACKEND_ENABLED) {
                    console.warn('VITE_TAURI_MOCK and VITE_DEV_BACKEND are both set; using the HTTP backend')
                }
                const entry = DEV_BACKEND_ENABLED ? DEV_BACKEND_ENTRY : MOCK_ENABLED ? MOCK_ENTRY : null
                if (!entry) return
                // Module scripts run in document order, so this executes before the app's main module.
                const src = `/@fs/${encodeURI(entry.replace(/\\/g, '/'))}`
                return [{ tag: 'script', attrs: { type: 'module', src }, injectTo: 'head-prepend' }]
            }
        }
    }
}

function devServerConfig() {
    if (!MOCK_ENABLED && !DEV_BACKEND_ENABLED) return undefined
    const server = { fs: { allow: [searchForWorkspaceRoot(__dirname), MOCK_DIR] } }
    if (DEV_BACKEND_ENABLED) {
        server.proxy = {
            '/api': { target: `http://127.0.0.1:${DEV_BACKEND_PORT}`, changeOrigin: false }
        }
    }
    return server
}

export default defineConfig({
    plugins: [vue(), tauriDevMockPlugin()],
    base: './',
    server: devServerConfig(),
    build: {
        outDir: '../../dist/writing',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                assetFileNames: 'assets/[name]-[hash][extname]',
                chunkFileNames: 'assets/[name]-[hash].js',
                entryFileNames: 'assets/[name]-[hash].js'
            }
        }
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    }
})
