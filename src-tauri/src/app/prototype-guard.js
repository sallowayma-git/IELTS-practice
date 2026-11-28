// Tauri's global freeze also affects external WebViews. The product's tinycolor
// dependency assigns an inherited toString and cannot load under that freeze.
// Keep the original protection everywhere except the isolated product origin.
// This document-start script runs before page scripts; the external window has
// no local IPC capability, regardless of its prototype behavior.
(() => {
  const label = window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label
  if (label === 'idictation-product' && location.origin === 'https://www.idictation.cn') return
  Object.freeze(Object.prototype)
})()
