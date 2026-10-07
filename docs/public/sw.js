const cacheName = 'life-simulation-wiki-v9'
const offlineUrl = 'offline.html'

const SYNC_STATUS = /wiki-data\/sync-status\.json$/

const isStaticAsset = (url) => {
  const path = url.pathname
  return (
    /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|woff2?|ttf|css|js|mjs|json)(\?|$)/i.test(path) ||
    path.startsWith('/assets/') ||
    path.startsWith('/wiki-data/') ||
    path.startsWith('/wiki-assets/') ||
    path === '/' ||
    path === '/index.html'
  )
}

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)
  if (cached) {
    fetchPromise.catch(() => {})
    return cached
  }
  return fetchPromise
}

const offlineFallback = async () => {
  const cached = await caches.match(offlineUrl)
  if (cached) return cached
  return new Response(
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>离线 - 来福Simulation Wiki</title></head><body><h2>离线</h2><p>网络不可用，缓存中未找到页面。</p><a href="./">返回主页</a></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
  )
  self.clients.claim()
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'reload') {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(cacheName)
        if (event.data.url) {
          await cache.delete(event.data.url)
        } else {
          const keys = await cache.keys()
          await Promise.all(keys.map((request) => cache.delete(request)))
        }
        event.ports[0]?.postMessage({ type: 'reload-done' })
      })()
    )
  }
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET') return

  // Keep sync-status fresh.
  if (url.origin === self.location.origin && SYNC_STATUS.test(url.pathname)) return
  // Other origins: leave alone (cross-origin images are handled below).
  const sameOrigin = url.origin === self.location.origin
  if (!sameOrigin && !/\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)/i.test(url.pathname)) return

  const navigable = request.mode === 'navigate'
  const staticAsset = isStaticAsset(url)
  // We cache: navigation requests (for offline fallback) plus same-origin static
  // assets.  External images are cached via staleWhileRevalidate.
  const cacheable = sameOrigin && (navigable || staticAsset)
  if (!cacheable) return

  const requestCopy = new Request(request)
  event.respondWith(
    (async () => {
      try {
        return await staleWhileRevalidate(requestCopy) || (navigable ? offlineFallback() : offlineFallback())
      } catch (error) {
        if (navigable) return offlineFallback()
        const cache = await caches.open(cacheName)
        const cached = await cache.match(requestCopy)
        if (cached) return cached
        return offlineFallback()
      }
    })()
  )
})