const cacheName = 'life-simulation-wiki-v7'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))))
  self.clients.claim()
})

const isImageRequest = (url) => /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)(\?|$)/i.test(url.pathname)

const cacheFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request).catch(() => undefined)
  if (response && (response.ok || response.type === 'opaque')) {
    (await caches.open(cacheName)).put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET') return

  // Skip sync-status to always get fresh data
  if (url.origin === self.location.origin && url.pathname.endsWith('/wiki-data/sync-status.json')) return

  // Cache images (including cross-origin) with cache-first strategy
  if (isImageRequest(url)) {
    event.respondWith(cacheFirst(request).catch(() => fetch(request)))
    return
  }

  // Same-origin only for non-image requests
  if (url.origin !== self.location.origin) return

  event.respondWith(cacheFirst(request).catch(() => Response.error()))
})