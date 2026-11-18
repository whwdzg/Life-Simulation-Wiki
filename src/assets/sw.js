/* 来福Simulation Wiki PWA service worker.
   Pages are network-first so the mirror stays fresh; static assets use
   stale-while-revalidate. Previously visited pages remain available offline. */
const CACHE = 'lifesim-wiki-pwa-v1'
const CACHE_PREFIX = 'lifesim-wiki-pwa-'
const scope = self.registration.scope

const assetPaths = [
  '',
  'assets/style.css',
  'assets/app.js',
  'assets/favicon.svg',
  'assets/wiki-common.css',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'manifest.webmanifest',
]

const offlineHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线 · 来福Simulation Wiki</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;text-align:center;padding:24px}a{color:#5eead4}</style><main><h1>暂时离线</h1><p>这个页面还没有缓存。联网后重新打开即可，或先回到首页。</p><p><a href="${scope}">返回首页</a></p></main></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(
        assetPaths.map(async (path) => {
          try {
            await cache.add(new Request(new URL(path, scope).href, { cache: 'reload' }))
          } catch {
            /* a missing optional asset should not abort installation */
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

const offlineResponse = () =>
  new Response(offlineHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })

const networkFirst = async (request) => {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match(new URL('', scope).href)) ||
      offlineResponse()
    )
  }
}

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone())
      return response
    })
    .catch(() => null)
  if (cached) {
    network.catch(() => {})
    return cached
  }
  return (await network) || Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/sw.js')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  // Keep large media on the browser's normal HTTP cache rather than filling
  // the service worker cache with hundreds of megabytes.
  if (url.pathname.includes('/media/')) return
  event.respondWith(staleWhileRevalidate(request))
})
