const cacheName = 'life-simulation-wiki-v6'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/wiki-data/sync-status.json')) return

  event.respondWith((async () => {
    const cached = await caches.match(request)
    const update = fetch(request).then(async (response) => {
      if (response.ok) (await caches.open(cacheName)).put(request, response.clone())
      return response
    })
    if (cached) {
      event.waitUntil(update.catch(() => undefined))
      return cached
    }
    return update
  })().catch(() => Response.error()))
})