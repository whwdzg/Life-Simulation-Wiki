import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'

const api = 'https://lifesimulation.fandom.com/zh/api.php'
const outputDirectory = new URL('../public/wiki-data/', import.meta.url)
const pageDirectory = new URL('../public/wiki-data/pages/', import.meta.url)
const mediaDirectory = new URL('../public/wiki-assets/', import.meta.url)
const statusFile = new URL('../public/wiki-data/sync-status.json', import.meta.url)

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const timestamp = () => new Date().toISOString()
const writeStatus = async (status) => {
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(statusFile, JSON.stringify({ updatedAt: timestamp(), ...status }, null, 2))
}

const fetchWithRetry = async (url, options = {}) => {
  let lastError
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      if (response.ok || (response.status >= 400 && response.status < 500)) return response
      throw new Error(`${response.status} ${response.statusText}`)
    } catch (error) {
      lastError = error
      if (attempt < 3) await wait(750 * (attempt + 1))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

const query = async (parameters) => {
  const url = new URL(api)
  Object.entries({ format: 'json', origin: '*', ...parameters }).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetchWithRetry(url, { headers: { 'user-agent': 'Life-Simulation-Wiki static migration' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response.json()
}

const getAll = async (list, prefix) => {
  const items = []
  let continuation = {}
  do {
    const data = await query({ action: 'query', list, [`${prefix}limit`]: 'max', ...continuation })
    items.push(...data.query[list])
    continuation = data.continue ?? null
  } while (continuation)
  return items
}

const mediaName = (url) => {
  try {
    const match = new URL(url).pathname.match(/\/images\/(.+?)\/revision\//)
    return match ? decodeURIComponent(match[1].split('/').at(-1)) : null
  } catch {
    return null
  }
}

const assetName = (name) => {
  const extension = extname(name).replace(/[^.a-z0-9]/gi, '').toLowerCase() || '.bin'
  return `${createHash('sha1').update(name).digest('hex')}${extension}`
}

const siteAsset = (assets, name) => assets[name] ? `./wiki-assets/${assets[name]}` : ''
const plainText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

const replaceAttribute = (html, attribute, replace) => html.replace(new RegExp(`(${attribute}=["'])([^"']+)(["'])`, 'gi'), (_, start, value, end) => `${start}${replace(value)}${end}`)

const mapConcurrent = async (items, limit, mapper) => {
  const results = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

const sanitizeHtml = (html, pages, assets, currentSlug) => {
  let content = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<div[^>]*class=["'][^"']*(?:fandom-ad|portable-infobox|mw-editsection)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<fandom-ad\b[^>]*>[\s\S]*?<\/fandom-ad>/gi, '')
    .replace(/\s(?:on\w+|data-tracking-label)=["'][^"']*["']/gi, '')
  content = replaceAttribute(content, 'data-src', (value) => {
    const name = mediaName(value)
    return name && assets[name] ? `./wiki-assets/${assets[name]}` : value
  })
  content = replaceAttribute(content, 'src', (value) => {
    const name = mediaName(value)
    return name && assets[name] ? `./wiki-assets/${assets[name]}` : value
  })
  content = content.replace(/\sdata-src=/gi, ' src=').replace(/\sclass=["']([^"']*)\blazyload\b([^"']*)["']/gi, ' class="$1$2"')
  content = content.replace(/href=["'](?:https?:\/\/lifesimulation\.fandom\.com)?\/zh\/wiki\/([^"'#?]+)(#[^"']*)?["']/gi, (_, rawTitle, hash = '') => {
    const title = decodeURIComponent(rawTitle).replace(/_/g, ' ')
    return pages[title] ? `href="#/wiki/${pages[title]}${hash}"` : 'href="#" class="unavailable-link"'
  })
  content = content.replace(/href=["']#([^"']+)["']/gi, (_, anchor) => `href="#/wiki/${currentSlug}#${anchor}"`)
  return content
}

const downloadAssets = async (images) => {
  const assets = Object.fromEntries(images.map((image) => [image.name, assetName(image.name)]))
  let completed = 0
  let failed = 0
  await rm(mediaDirectory, { recursive: true, force: true })
  await mkdir(mediaDirectory, { recursive: true })
  const queue = [...images]
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const image = queue.shift()
      const destination = new URL(assets[image.name], mediaDirectory)
      try {
        const response = await fetchWithRetry(image.url, { headers: { 'user-agent': 'Life-Simulation-Wiki static migration' } })
        if (!response.ok) throw new Error(String(response.status))
        await writeFile(destination, new Uint8Array(await response.arrayBuffer()))
      } catch (error) {
        failed += 1
        console.warn(`Skipped asset: ${image.name} (${error.message})`)
      } finally {
        completed += 1
        if (completed % 20 === 0 || completed === images.length) {
          await writeStatus({ state: 'running', phase: 'media', articles: { completed: 0, total: 0 }, media: { completed, total: images.length, failed } })
        }
      }
    }
  })
  await Promise.all(workers)
  return { assets, failed }
}

const main = async () => {
  await writeStatus({ state: 'running', phase: 'index', articles: { completed: 0, total: 0 }, media: { completed: 0, total: 0, failed: 0 } })
  console.log('Fetching page and media indexes...')
  const [pages, images] = await Promise.all([
    getAll('allpages', 'ap'),
    getAll('allimages', 'ai'),
  ])
  const articles = pages.filter((page) => page.ns === 0)
  const pageMap = Object.fromEntries(articles.map((page) => [page.title, encodeURIComponent(page.title.replaceAll(' ', '_'))]))
  console.log(`Fetching ${articles.length} articles and downloading ${images.length} media files...`)
  await writeStatus({ state: 'running', phase: 'media', articles: { completed: 0, total: articles.length }, media: { completed: 0, total: images.length, failed: 0 } })
  const { assets, failed: failedMedia } = await downloadAssets(images)
  const site = {
    background: siteAsset(assets, 'Site-background-light'),
    icon: siteAsset(assets, 'Site-logo.png'),
  }
  let completedArticles = 0
  const content = await mapConcurrent(articles, 8, async (page, index) => {
    const parsed = await query({ action: 'parse', page: page.title, prop: 'text|sections|displaytitle' })
    const parse = parsed.parse
    const article = {
      title: page.title,
      slug: pageMap[page.title],
      displayTitle: parse.displaytitle || page.title,
      sections: parse.sections.map((section) => ({ anchor: section.anchor, line: section.line, level: section.level })),
      html: sanitizeHtml(parse.text['*'], pageMap, assets, pageMap[page.title]),
    }
    completedArticles += 1
    if (completedArticles % 5 === 0 || completedArticles === articles.length) {
      await writeStatus({ state: 'running', phase: 'articles', articles: { completed: completedArticles, total: articles.length }, media: { completed: images.length, total: images.length, failed: failedMedia } })
    }
    console.log(`[${index + 1}/${articles.length}] ${page.title}`)
    return article
  })
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })
  await mkdir(pageDirectory, { recursive: true })
  await Promise.all(content.map((page) => writeFile(new URL(`${page.slug}.json`, pageDirectory), JSON.stringify(page))))
  const index = content.map(({ html, ...page }) => {
    const text = plainText(html)
    return { ...page, summary: text.slice(0, 180), searchText: text.slice(0, 4000) }
  })
  const status = { state: 'success', phase: 'complete', capturedAt: timestamp(), articles: { completed: articles.length, total: articles.length }, media: { completed: images.length, total: images.length, failed: failedMedia } }
  await writeFile(new URL('index.json', outputDirectory), JSON.stringify({ generatedAt: status.capturedAt, site, sync: status, pages: index }))
  await writeFile(new URL('manifest.json', outputDirectory), JSON.stringify({ articles: articles.length, media: images.length, failedMedia, capturedAt: status.capturedAt }, null, 2))
  await writeStatus(status)
  console.log(`Complete: ${articles.length} articles and ${images.length} media files migrated.`)
}

main().catch(async (error) => {
  console.error(error)
  await writeStatus({ state: 'failed', phase: 'error', error: error.message, articles: { completed: 0, total: 0 }, media: { completed: 0, total: 0, failed: 0 } })
  process.exitCode = 1
})