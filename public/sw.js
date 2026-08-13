const cacheName = 'life-simulation-wiki-v7'
const offlineUrl = 'offline.html'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))))
  self.clients.claim()
})

const isImageRequest = (url) => /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)(\?|$)/i.test(url.pathname)

const fromCache = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request).catch(() => undefined)
  if (response && (response.ok || response.type === 'opaque')) {
    (await caches.open(cacheName)).put(request, response.clone())
  }
  return response
}

const offlineFallback = async () => {
  const cached = await caches.match(offlineUrl)
  if (cached) return cached
  return new Response(
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>离线 - 来福Simulation Wiki</title></head><body><h2>离线</h2><p>网络不可用，缓存中未找到页面。</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET') return

  // Skip sync-status to always get fresh data
  if (url.origin === self.location.origin && url.pathname.endsWith('/wiki-data/sync-status.json')) return

  // Cache images (including cross-origin) with cache-first strategy
  if (isImageRequest(url)) {
    event.respondWith(fromCache(request).catch(() => fetch(request)))
    return
  }

  // Same-origin only for non-image requests
  if (url.origin !== self.location.origin) return

  event.respondWith(
    fromCache(request).catch(() => {
      // Navigation requests: show offline page
      if (request.mode === 'navigate') return offlineFallback()
      // Other requests: try to serve from cache offline page
      return caches.match(offlineUrl).then((cached) => cached || offlineFallback())
    })
  )
})