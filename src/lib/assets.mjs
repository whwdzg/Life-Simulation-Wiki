import { createHash } from 'node:crypto'
import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { decodeEntities } from './paths.mjs'
import { formatBytes, mapConcurrent } from './util.mjs'

const MEDIA_HOST_RE = /(^|\.)(wikia\.nocookie\.net|wikia\.com|fandom\.com|nocookie\.net)$/i

const MIME_EXTENSIONS = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'application/ogg': 'ogv',
  'application/pdf': 'pdf',
}

export function isMirrorableMediaUrl(value) {
  try {
    const url = new URL(decodeEntities(String(value ?? '').trim()))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (!MEDIA_HOST_RE.test(url.hostname)) return false
    if (url.pathname.includes('/wiki/Special:FilePath/')) return true
    return url.pathname.includes('/images/') || url.pathname.includes('/revision/')
  } catch {
    return false
  }
}

export function normalizeMediaUrl(value) {
  let text = decodeEntities(String(value ?? '').trim())
  if (!text) return ''
  if (text.startsWith('//')) text = `https:${text}`
  try {
    const url = new URL(text)
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

const ATTRIBUTE_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

export function parseAttributes(source) {
  const attributes = []
  for (const match of source.matchAll(ATTRIBUTE_RE)) {
    attributes.push({
      name: match[1],
      value: match[2] ?? match[3] ?? match[4] ?? '',
    })
  }
  return attributes
}

export function serializeAttributes(attributes) {
  return attributes
    .map(({ name, value }) => {
      const escaped = String(value ?? '').replace(/"/g, '&quot;')
      return ` ${name}="${escaped}"`
    })
    .join('')
}

/** Yields every mirrorable image/media URL referenced from an HTML fragment. */
export function collectMediaUrls(html, callback) {
  const text = String(html ?? '')
  for (const match of text.matchAll(ATTRIBUTE_RE)) {
    const name = match[1].toLowerCase()
    if (!['src', 'data-src', 'poster', 'href', 'data-image-src'].includes(name)) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (isMirrorableMediaUrl(value)) callback(normalizeMediaUrl(value))
  }
  for (const match of text.matchAll(/\ssrcset\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const value = match[2] ?? match[3] ?? ''
    for (const candidate of value.split(',')) {
      const url = candidate.trim().split(/\s+/)[0]
      if (isMirrorableMediaUrl(url)) callback(normalizeMediaUrl(url))
    }
  }
  for (const match of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const url = match[2]
    if (isMirrorableMediaUrl(url)) callback(normalizeMediaUrl(url))
  }
}

export function extensionForContentType(contentType, url) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  if (MIME_EXTENSIONS[type]) return MIME_EXTENSIONS[type]
  try {
    const pathname = new URL(url).pathname
    const extension = pathname.split('/').pop()?.match(/\.([a-z0-9]{1,6})$/i)?.[1]
    if (extension) return extension.toLowerCase()
  } catch {
    // ignore
  }
  return 'bin'
}

export function thumbnailUrl(value, width) {
  try {
    const url = new URL(value)
    const match = url.pathname.match(/^(.*\/revision\/latest)(?:\/scale-to-width-down\/\d+)?$/)
    if (!match) return null
    url.pathname = `${match[1]}/scale-to-width-down/${width}`
    return url.toString()
  } catch {
    return null
  }
}

function cacheFileName(url, contentType) {
  const hash = createHash('sha1').update(url).digest('hex')
  return `${hash}.${extensionForContentType(contentType, url)}`
}

async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}

/** Downloads media into a persistent cache and copies the used subset into dist. */
export class MediaMirror {
  constructor({ cacheDir, base, userAgent, concurrency = 8, logger = console, skip = false }) {
    this.cacheDir = cacheDir
    this.base = base
    this.userAgent = userAgent
    this.concurrency = concurrency
    this.logger = logger
    this.skip = skip
    this.entries = new Map()
    this.failures = new Map()
    this.downloadedBytes = 0
    this.downloadedFiles = 0
  }

  get manifestPath() {
    return join(this.cacheDir, 'manifest.json')
  }

  async init() {
    this.fileIndex = new Map()
    try {
      const manifest = JSON.parse(await readFile(this.manifestPath, 'utf8'))
      for (const [url, entry] of Object.entries(manifest.entries ?? {})) {
        this.entries.set(url, entry)
      }
      this.logger.info?.(`媒体缓存：${this.entries.size} 条记录`)
    } catch {
      this.logger.info?.('媒体缓存清单不存在，将根据缓存文件恢复')
    }
    try {
      for (const file of await readdir(this.cacheDir)) {
        const hash = file.split('.')[0]
        if (/^[0-9a-f]{40}$/.test(hash) && !file.endsWith('.part') && this.fileIndex.get(hash) === undefined) {
          this.fileIndex.set(hash, file)
        }
      }
    } catch {
      // cache directory does not exist yet
    }
  }

  /** Recover a cache entry for a URL even when manifest.json was not written. */
  async recover(url) {
    const hash = createHash('sha1').update(url).digest('hex')
    const file = this.fileIndex.get(hash)
    if (!file) return null
    const size = await fileSize(join(this.cacheDir, file))
    if (size <= 0) return null
    const extension = file.split('.').pop() ?? ''
    const type = Object.entries(MIME_EXTENSIONS).find(([, ext]) => ext === extension)?.[0] ?? ''
    const entry = { file, size, type }
    this.entries.set(url, entry)
    return entry
  }

  async download(url) {
    const existing = this.entries.get(url)
    if (existing) {
      const path = join(this.cacheDir, existing.file)
      if ((await fileSize(path)) === existing.size) return existing
      this.entries.delete(url)
    }
    const recovered = await this.recover(url)
    if (recovered) return recovered
    let lastError
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            'user-agent': this.userAgent,
            accept: '*/*',
            referer: 'https://lifesimulation.fandom.com/',
          },
          signal: AbortSignal.timeout(60_000),
          redirect: 'follow',
        })
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`HTTP ${response.status}`)
        }
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status} ${response.statusText}`)
          error.fatal = response.status >= 400 && response.status < 500
          throw error
        }
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.startsWith('text/html')) {
          const error = new Error(`意外的 HTML 响应 (${contentType})`)
          error.fatal = true
          throw error
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        if (!buffer.length) {
          const error = new Error('空文件')
          error.fatal = true
          throw error
        }
        if (buffer.length > 80 * 1024 * 1024) {
          const error = new Error(`文件过大：${formatBytes(buffer.length)}`)
          error.fatal = true
          throw error
        }
        const file = cacheFileName(url, contentType)
        const destination = join(this.cacheDir, file)
        await mkdir(dirname(destination), { recursive: true })
        const temporary = `${destination}.${process.pid}.${Math.random().toString(16).slice(2)}.part`
        await writeFile(temporary, buffer)
        await rename(temporary, destination)
        const entry = {
          file,
          size: buffer.length,
          type: contentType.split(';')[0].trim().toLowerCase(),
        }
        this.entries.set(url, entry)
        this.fileIndex.set(createHash('sha1').update(url).digest('hex'), file)
        this.downloadedBytes += buffer.length
        this.downloadedFiles += 1
        return entry
      } catch (error) {
        lastError = error
        if (error.fatal || attempt >= 2) break
        await delay(Math.min(20_000, 1_000 * 2 ** attempt) + Math.random() * 500)
      }
    }
    throw lastError
  }

  async mirror(urls, { label = '媒体' } = {}) {
    const unique = [...new Set(urls.filter(Boolean))]
    if (this.skip) {
      this.logger.warn?.('SKIP_MEDIA=1，跳过媒体下载')
      return this
    }
    await mkdir(this.cacheDir, { recursive: true })
    let completed = 0
    await mapConcurrent(unique, this.concurrency, async (url) => {
      try {
        await this.download(url)
      } catch (error) {
        this.failures.set(url, error.message)
        this.logger.warn?.(`下载失败：${url.slice(0, 110)} — ${error.message}`)
      } finally {
        completed += 1
        if (completed % 25 === 0 || completed === unique.length) {
          this.logger.info?.(`  ${label} ${completed}/${unique.length}（新增 ${this.downloadedFiles} 个，${formatBytes(this.downloadedBytes)}）`)
        }
      }
    })
    await this.save()
    this.logger.info?.(
      `${label}完成：${unique.length - this.failures.size}/${unique.length} 可用，失败 ${this.failures.size} 个`,
    )
    return this
  }

  async save() {
    await mkdir(this.cacheDir, { recursive: true })
    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      entries: Object.fromEntries([...this.entries].sort(([a], [b]) => a.localeCompare(b))),
    }
    await writeFile(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  /** URL for an HTML asset (base-prefixed) or null if it was not mirrored. */
  urlFor(url) {
    const entry = this.entries.get(url)
    if (!entry) return null
    return `${this.base}/media/${entry.file.slice(0, 2)}/${entry.file}`
  }

  pathFor(url) {
    const entry = this.entries.get(url)
    return entry ? `media/${entry.file.slice(0, 2)}/${entry.file}` : null
  }

  async copyTo(outDir, usedUrls) {
    let copied = 0
    let bytes = 0
    const urls = [...usedUrls].filter((url) => this.entries.has(url))
    await mapConcurrent(urls, 16, async (url) => {
      const entry = this.entries.get(url)
      const source = join(this.cacheDir, entry.file)
      const destination = join(outDir, 'media', entry.file.slice(0, 2), entry.file)
      if ((await fileSize(destination)) === entry.size) {
        bytes += entry.size
        return
      }
      await mkdir(dirname(destination), { recursive: true })
      try {
        await link(source, destination)
      } catch {
        await copyFile(source, destination)
      }
      copied += 1
      bytes += entry.size
    })
    return { files: urls.length, copied, bytes }
  }

  async gc(usedUrls) {
    const keep = new Set()
    for (const url of usedUrls) {
      const entry = this.entries.get(url)
      if (entry) keep.add(entry.file)
    }
    for (const [url, entry] of [...this.entries]) {
      if (!usedUrls.has(url)) {
        await rm(join(this.cacheDir, entry.file), { force: true })
        this.entries.delete(url)
      }
    }
    await this.save()
    return keep.size
  }
}
