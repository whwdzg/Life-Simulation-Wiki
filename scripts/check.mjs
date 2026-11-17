import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { loadConfig } from '../src/lib/config.mjs'
import { decodeEntities } from '../src/lib/paths.mjs'

const config = loadConfig()
const base = config.base
const root = config.outDir

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function exists(path) {
  try {
    const info = await stat(path)
    if (info.isFile()) return true
    if (info.isDirectory()) {
      const index = await stat(join(path, 'index.html'))
      return index.isFile()
    }
  } catch {
    return false
  }
  return false
}

function isLocal(value) {
  const url = decodeEntities(value).trim()
  if (!url || url.startsWith('#') || url.startsWith('//')) return false
  if (/^(?:https?:|mailto:|data:|javascript:|tel:):/i.test(url)) return false
  if (base) return url.startsWith(`${base}/`) || url === base
  return url.startsWith('/')
}

async function checkUrl(value, pageFile, problems, stats, kind) {
  const raw = decodeEntities(value).trim()
  let pathname
  try {
    const url = new URL(raw, 'https://mirror.invalid')
    pathname = decodeURIComponent(url.pathname)
  } catch {
    problems.push(`${relative(root, pageFile)}: 无法解析 ${kind} ${raw}`)
    return
  }
  if (base) {
    if (pathname === base) pathname = '/'
    else if (pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length)
    else return
  }
  const target = join(root, pathname.replace(/^\/+/, ''))
  const ok = await exists(target)
  stats[kind] = (stats[kind] ?? 0) + 1
  if (!ok) {
    problems.push(`${relative(root, pageFile)}: ${kind} 指向缺失文件 ${raw}`)
  }
}

async function main() {
  const files = await walk(root)
  const htmlFiles = files.filter((file) => file.endsWith('.html'))
  const problems = []
  const stats = { href: 0, src: 0, poster: 0, srcset: 0, externalMedia: 0 }
  const brokenMedia = []

  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8')
    for (const match of html.matchAll(/\s(href|src|poster)="([^"]*)"/gi)) {
      const kind = match[1].toLowerCase()
      const value = match[2]
      if (isLocal(value)) await checkUrl(value, file, problems, stats, kind)
      else if (kind !== 'href' && /^https?:\/\/static\.wikia\./i.test(value)) {
        stats.externalMedia += 1
        brokenMedia.push(`${relative(root, file)} -> ${value}`)
      }
    }
    for (const match of html.matchAll(/\ssrcset="([^"]*)"/gi)) {
      for (const candidate of match[1].split(',')) {
        const value = candidate.trim().split(/\s+/)[0]
        if (isLocal(value)) await checkUrl(value, file, problems, stats, 'srcset')
      }
    }
    if (/\bhref="\/zh\//.test(html) || /\bsrc="\/zh\//.test(html)) {
      problems.push(`${relative(root, file)}: 仍包含未改写的 /zh/ 链接`)
    }
  }

  const homePath = join(root, 'index.html')
  const home = await readFile(homePath, 'utf8').catch(() => '')
  if (!home) problems.push('缺少首页 dist/index.html')
  if (!/镜像内容更新时间/.test(home)) problems.push('首页缺少“镜像内容更新时间”')
  if (!/每小时自动更新/.test(home)) problems.push('首页缺少每小时自动更新说明')
  if (!home.includes('mirror-status')) problems.push('首页缺少镜像状态区块')

  const search = JSON.parse(await readFile(join(root, 'data', 'search.json'), 'utf8').catch(() => '{"entries":[]}'))
  if (!Array.isArray(search.entries) || search.entries.length === 0) problems.push('搜索索引为空')

  const missingIndexes = ['pages', 'templates', 'media', 'categories', 'recent', 'statistics', 'about', 'search']
  for (const path of missingIndexes) {
    if (!(await exists(join(root, path)))) problems.push(`缺少索引页 ${path}/`)
  }
  if (!(await exists(join(root, '404.html')))) problems.push('缺少 404.html')
  if (!(await exists(join(root, 'sitemap.xml')))) problems.push('缺少 sitemap.xml')
  if (!(await exists(join(root, '.nojekyll')))) problems.push('缺少 .nojekyll')

  const mediaFiles = files.filter((file) => relative(root, file).startsWith(`media${sep}`))
  console.log(`页面：${htmlFiles.length} 个 HTML 文件`)
  console.log(`索引：${stats.href} 个本地链接，${stats.src + stats.poster + stats.srcset} 个本地资源引用`)
  console.log(`媒体：${mediaFiles.length} 个文件`)
  console.log(`搜索索引：${search.entries.length} 条`)
  console.log(`首页更新时间：${home.match(/<time datetime="([^"]+)"/)?.[1] ?? '未找到'}`)
  if (stats.externalMedia) {
    console.warn(`警告：仍有 ${stats.externalMedia} 个媒体引用指向 Fandom CDN（下载失败或未镜像）。`)
    for (const item of brokenMedia.slice(0, 8)) console.warn(`  ${item}`)
  }
  if (problems.length) {
    console.error(`\n发现 ${problems.length} 个问题：`)
    for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }
  console.log('检查通过：所有本地链接与资源均存在。')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
