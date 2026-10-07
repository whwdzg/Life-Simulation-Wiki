import { startWikiApp } from './wiki-app.js'
import './style.css'

// Register the service worker for the static mirror.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const base = new URL(window.location.href)
    navigator.serviceWorker
      .register(`${base.href.replace(/[^#]#.*$/, '')}sw.js`, { scope: '/' })
      .catch((error) => console.warn('Service worker registration failed:', error))
  })
}

export default {
  // Mark the VitePress shell as disabled: only the SPA host matters.
  enhanceApp({ app }) {
    document.documentElement.classList.add('no-vp-shell')
    app.mount
  },
}

// Mount the mirror app immediately, then enhance the theme synchronously.
startWikiApp()