import {
  canonicalTitle,
  decodeEntities,
  normalizeTitle,
  pageUrl,
  pageUrlWithAnchor,
  sourceTitleUrl,
  titleKey,
} from './paths.mjs'

export const SPECIAL_TARGETS = {
  allpages: 'pages',
  '所有页面': 'pages',
  '所有頁面': 'pages',
  allimages: 'media',
  '所有文件': 'media',
  '所有檔案': 'media',
  '文件列表': 'media',
  '檔案清單': 'media',
  newfiles: 'media',
  '最新文件': 'media',
  '最新檔案': 'media',
  categories: 'categories',
  '分类': 'categories',
  '分類': 'categories',
  statistics: 'statistics',
  '统计': 'statistics',
  '統計': 'statistics',
  recentchanges: 'recent',
  '最近更改': 'recent',
  '最近变更': 'recent',
  '最近變更': 'recent',
  search: 'search',
  '搜索': 'search',
  '搜尋': 'search',
  random: 'random',
  randompage: 'random',
  '随机页面': 'random',
  '隨機頁面': 'random',
  specialpages: 'about',
  '特殊页面': 'about',
  '特殊頁面': 'about',
  '所有页面': 'pages',
}

const UPLOAD_PREFIXES = /^(upload|上传文件|上傳檔案|上傳文件)$/i

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function splitFragment(value) {
  const index = value.indexOf('#')
  if (index < 0) return { path: value, anchor: '' }
  return { path: value.slice(0, index), anchor: safeDecode(value.slice(index + 1)) }
}

function parseTitlePath(path) {
  let title = path
  if (title.startsWith('/zh/wiki/')) title = title.slice('/zh/wiki/'.length)
  else if (title.startsWith('/wiki/')) title = title.slice('/wiki/'.length)
  else if (title.startsWith('wiki/')) title = title.slice('wiki/'.length)
  title = title.replace(/\?.*$/, '')
  return normalizeTitle(safeDecode(title))
}

function specialTarget(name) {
  const normalized = normalizeTitle(safeDecode(name)).replace(/\s+/g, ' ')
  const key = normalized.toLowerCase()
  return SPECIAL_TARGETS[key] ?? SPECIAL_TARGETS[normalized] ?? null
}

export function createLinkResolver({
  pages,
  projectName = '来福Simulation Wiki',
  base = '',
  extraPages = {},
}) {
  const pageByKey = new Map()
  for (const page of pages) {
    pageByKey.set(page.key || titleKey(page.title, { projectName }), page)
  }
  for (const [key, page] of Object.entries(extraPages)) {
    pageByKey.set(key, page)
  }

  function lookup(title) {
    let canonical = canonicalTitle(title, { projectName })
    if (!canonical) return null
    if (/^project:/i.test(canonical)) canonical = `${projectName}:${canonical.slice('project:'.length)}`
    return pageByKey.get(titleKey(canonical, { projectName })) ?? null
  }

  function internalUrl(page, anchor = '') {
    return pageUrlWithAnchor(page, base, anchor)
  }

  function specialUrl(target, anchor = '') {
    const page = {
      urlPath: target,
    }
    return pageUrlWithAnchor(page, base, anchor)
  }

  function uploadTarget(query, anchor) {
    const fileName = query.get('wpDestFile') || query.get('wpDestFile') || query.get('file')
    if (!fileName) return null
    const record = lookup(`File:${fileName}`)
    if (!record) return null
    return { type: 'internal', url: internalUrl(record, anchor), record, exists: true }
  }

  function resolve(rawHref) {
    const href = decodeEntities(String(rawHref ?? '')).trim()
    if (!href) return { type: 'empty' }
    if (href.startsWith('#')) {
      return { type: 'anchor', href: href === '##' ? '#' : href }
    }
    if (/^(?:javascript|data):/i.test(href)) return { type: 'empty' }

    let url
    try {
      if (href.startsWith('//')) url = new URL(`https:${href}`)
      else if (/^https?:/i.test(href)) url = new URL(href)
    } catch {
      return { type: 'external', url: href }
    }

    if (url) {
      const host = url.hostname.toLowerCase()
      const isThisWiki = host === 'lifesimulation.fandom.com' || host.endsWith('.lifesimulation.fandom.com')
      if (!isThisWiki) return { type: 'external', url: url.toString() }
      if (url.pathname === '/zh/index.php' || url.pathname === '/index.php') {
        const title = url.searchParams.get('title')
        if (!title) return { type: 'external', url: url.toString() }
        return resolveTitle(title, url.hash ? safeDecode(url.hash.slice(1)) : '', url.searchParams)
      }
      if (url.pathname.startsWith('/zh/wiki/') || url.pathname.startsWith('/wiki/')) {
        const title = parseTitlePath(url.pathname)
        return resolveTitle(title, url.hash ? safeDecode(url.hash.slice(1)) : '', url.searchParams)
      }
      return { type: 'external', url: url.toString() }
    }

    if (href.startsWith('/zh/index.php')) {
      try {
        const url = new URL(`https://lifesimulation.fandom.com${href}`)
        const title = url.searchParams.get('title')
        if (!title) return { type: 'external', url: url.toString() }
        return resolveTitle(title, '', url.searchParams)
      } catch {
        return { type: 'external', url: href }
      }
    }

    if (href.startsWith('/') || href.startsWith('wiki/')) {
      try {
        const url = new URL(href, 'https://lifesimulation.fandom.com')
        const { path, anchor } = splitFragment(url.pathname)
        return resolveTitle(parseTitlePath(path), anchor, url.searchParams)
      } catch {
        return { type: 'external', url: href }
      }
    }

    return { type: 'external', url: href }
  }

  function resolveTitle(title, anchor, query) {
    if (!title) return { type: 'empty' }
    if (/^special:/i.test(title)) {
      const rest = title.slice(title.indexOf(':') + 1).trim()
      const slash = rest.indexOf('/')
      const name = slash >= 0 ? rest.slice(0, slash) : rest
      const subpage = slash >= 0 ? rest.slice(slash + 1) : ''
      if (UPLOAD_PREFIXES.test(name) && query) {
        const upload = uploadTarget(query, anchor)
        if (upload) return upload
      }
      const target = specialTarget(name)
      if (target && !subpage) {
        return { type: 'internal', url: specialUrl(target, anchor), record: { title: `Special:${name}`, urlPath: target }, exists: true, special: true }
      }
      return { type: 'external', url: sourceTitleUrl(title) }
    }
    const record = lookup(title)
    if (record) {
      return { type: 'internal', url: internalUrl(record, anchor), record, exists: true }
    }
    return {
      type: 'missing',
      title: canonicalTitle(title, { projectName }),
      url: `${sourceTitleUrl(canonicalTitle(title, { projectName }))}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`,
    }
  }

  return {
    pageByKey,
    lookup,
    resolve,
    internalUrl,
    specialUrl,
  }
}
