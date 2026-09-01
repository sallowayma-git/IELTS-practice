/// <reference types="vite/client" />

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }
    __TAURI_INTERNALS__?: unknown
    DictionaryService?: { lookup?: (term: string) => unknown }
  }
}

export {}
