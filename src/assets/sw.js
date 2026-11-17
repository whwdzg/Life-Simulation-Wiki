/* The previous version of this mirror registered a caching service worker.
   This worker replaces it, clears old caches, and unregisters itself so the
   static site always comes from GitHub Pages. */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      } catch {
        /* ignore */
      }
      try {
        await self.registration.unregister()
      } catch {
        /* ignore */
      }
    })(),
  )
})
