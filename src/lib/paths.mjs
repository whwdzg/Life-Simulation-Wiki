import { createHash } from 'node:crypto'

const FORBIDDEN = new Map([
  ['\\', '＼'],
  [':', '：'],
  ['*', '＊'],
  ['?', '？'],
  ['"', '＂'],
  ['<', '＜'],
  ['>', '＞'],
  ['|', '｜'],
])

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** MediaWiki normalizes underscores to spaces and collapses whitespace. */
export function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const DEFAULT_NAMESPACE_ALIASES = {
  image: 'File',
  '图片': 'File',
  '圖片': 'File',
  '文件': 'File',
  '檔案': 'File',
  '模板': 'Template',
  '分类': 'Category',
  '分類': 'Category',
  '用户': 'User',
  '用戶': 'User',
  '特殊': 'Special',
  'project': 'Project',
  'wp': 'Wikipedia',
}

/**
 * Turn a link target into the canonical title used by the page index.
 * Only the first letter is case-folded, matching MediaWiki's first-letter case rule.
 */
export function canonicalTitle(value, { projectName = '来福Simulation Wiki' } = {}) {
  let title = normalizeTitle(value).replace(/^:+/, '')
  if (!title) return ''
  const colon = title.indexOf(':')
  if (colon > 0) {
    const prefix = title.slice(0, colon).trim()
    const rest = title.slice(colon + 1).trim()
    const key = prefix.toLowerCase()
    if (key === projectName.toLowerCase()) return `${projectName}:${rest}`
    const alias = DEFAULT_NAMESPACE_ALIASES[key]
    if (alias) return `${alias}:${rest}`
  }
  return title
}

export function titleKey(value, options) {
  const title = canonicalTitle(value, options)
  if (!title) return ''
  return (title.charAt(0).toLowerCase() + title.slice(1)).normalize('NFC')
}

function sanitizeSegment(segment) {
  let result = ''
  for (const character of segment) {
    if (character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) {
      result += '_'
    } else {
      result += FORBIDDEN.get(character) ?? character
    }
  }
  result = result
    .replace(/\s+/g, '_')
    .replace(/_{3,}/g, '__')
    .replace(/^[. ]+|[. ]+$/g, '')
  if (!result) result = '_'
  if (WINDOWS_RESERVED.test(result)) result = `_${result}`
  return result
}

/**
 * Filesystem-safe path for a page. Subpages keep their hierarchy, so
 * "S3 Secret Life/安居" becomes "S3_Secret_Life/安居".
 */
export function slugForTitle(value) {
  const title = normalizeTitle(value)
  const segments = title.split('/').map(sanitizeSegment)
  let slug = segments.join('/')
  // Avoid absurdly long path segments on Windows and artifact tooling.
  slug = slug
    .split('/')
    .map((segment) => {
      if (Buffer.byteLength(segment, 'utf8') <= 180) return segment
      const suffix = `~${createHash('sha1').update(title).digest('hex').slice(0, 8)}`
      let shortened = ''
      for (const character of segment) {
        if (Buffer.byteLength(shortened + character, 'utf8') > 160) break
        shortened += character
      }
      return `${shortened}${suffix}`
    })
    .join('/')
  return slug
}

/** Assign unique, filesystem-safe paths to all page records. */
export function assignPagePaths(records, { homeKey } = {}) {
  const used = new Map()
  for (const record of records) {
    record.key = record.key || titleKey(record.title)
  }
  const sorted = [...records].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  for (const record of sorted) {
    if (homeKey && record.key === homeKey) {
      record.slug = ''
      record.urlPath = ''
      continue
    }
    const baseSlug = slugForTitle(record.title)
    let slug = baseSlug
    let attempt = 0
    while (used.has(slug.toLowerCase())) {
      attempt += 1
      const suffix = `~${createHash('sha1').update(`${record.title}:${attempt}`).digest('hex').slice(0, 6)}`
      slug = `${baseSlug}${suffix}`
    }
    used.set(slug.toLowerCase(), record)
    record.slug = slug
    record.urlPath = `wiki/${slug}`
  }
}

export function normalizeBase(base) {
  const value = String(base ?? '')
  if (!value || value === '/') return ''
  return `/${value.replace(/^\/+|\/+$/g, '')}`
}

export function sitePath(base, path = '') {
  const normalized = String(path ?? '').replace(/^\/+/, '')
  const prefix = normalizeBase(base)
  if (!normalized) return `${prefix}/`
  return `${prefix}/${normalized}`
}

export function pageUrl(record, base) {
  const prefix = normalizeBase(base)
  if (!record || record.urlPath === '') return `${prefix}/`
  return `${prefix}/${record.urlPath}/`
}

export function pageUrlWithAnchor(record, base, anchor) {
  const url = pageUrl(record, base)
  if (!anchor) return url
  return `${url}#${encodeURIComponent(anchor)}`
}

export function assetUrl(path, base) {
  return sitePath(base, path)
}

export function absoluteUrl(origin, base, path = '') {
  const normalizedOrigin = String(origin ?? '').replace(/\/+$/, '')
  return `${normalizedOrigin}${sitePath(base, path)}`
}

/** URL path (without base) encoding for a slug that may contain Chinese and subpages. */
export function encodeSlug(slug) {
  return slug
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function sourceTitleUrl(title) {
  const encoded = normalizeTitle(title)
    .split('/')
    .map((segment) => encodeURIComponent(segment.replace(/ /g, '_')))
    .join('/')
  return `https://lifesimulation.fandom.com/zh/wiki/${encoded}`
}

export function sourceFileUrl(fileName) {
  return `https://lifesimulation.fandom.com/zh/wiki/File:${encodeURIComponent(fileName.replace(/ /g, '_'))}`
}

/** Stable short hash used in build ids and cache keys. */
export function shortHash(value, length = 10) {
  return createHash('sha1').update(value).digest('hex').slice(0, length)
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case "'": return '&#39;'
      case '"': return '&quot;'
      default: return character
    }
  })
}

export function decodeEntities(value) {
  if (!value || !value.includes('&')) return value
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    if (lower === 'nbsp') return ' '
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return match
  })
}

export function stripTags(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

export function truncate(value, length) {
  const text = String(value ?? '')
  if (text.length <= length) return text
  return `${text.slice(0, Math.max(0, length - 1))}…`
}
