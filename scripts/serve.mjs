import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { loadConfig } from '../src/lib/config.mjs'

const config = loadConfig()
const port = Number(process.env.PORT || 5173)
const root = resolve(config.outDir)
const base = config.base

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

async function resolveFile(urlPath) {
  let pathname
  try {
    pathname = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (base && pathname.startsWith(base)) pathname = pathname.slice(base.length)
  if (!pathname.startsWith('/')) pathname = `/${pathname}`
  const target = normalize(join(root, pathname))
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null
  try {
    const info = await stat(target)
    if (info.isDirectory()) {
      const index = join(target, 'index.html')
      const indexInfo = await stat(index)
      if (indexInfo.isFile()) return { path: index, info: indexInfo }
    }
    if (info.isFile()) return { path: target, info }
  } catch {
    // fall through
  }
  return null
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const found = await resolveFile(url.pathname)
  if (!found) {
    try {
      const notFound = await stat(join(root, '404.html'))
      response.writeHead(404, { 'content-type': MIME['.html'], 'content-length': notFound.size, 'cache-control': 'no-store' })
      createReadStream(join(root, '404.html')).pipe(response)
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('404 Not Found')
    }
    return
  }
  response.writeHead(200, {
    'content-type': MIME[extname(found.path).toLowerCase()] || 'application/octet-stream',
    'content-length': found.info.size,
    'cache-control': 'no-cache',
  })
  createReadStream(found.path).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  const path = base ? `${base}/` : '/'
  console.log(`镜像预览：http://127.0.0.1:${port}${path}`)
  console.log(`站点目录：${root}`)
})
