import {
  collectMediaUrls,
  isMirrorableMediaUrl,
  normalizeMediaUrl,
  parseAttributes,
  serializeAttributes,
} from './assets.mjs'
import { decodeEntities } from './paths.mjs'

const TRANSPARENT_PIXEL =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E'

const TAG_PATTERN = /<(img|source|video|audio)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const ANCHOR_PATTERN = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const STYLE_PATTERN = /(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi

function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

function attributeMap(attributes) {
  const map = new Map()
  for (const attribute of attributes) {
    map.set(attribute.name.toLowerCase(), { ...attribute })
  }
  return map
}

function mapToAttributes(map) {
  return [...map.values()].map((attribute) => ({
    name: attribute.name,
    value: attribute.value,
  }))
}

function getAttribute(map, name) {
  return map.get(name.toLowerCase())?.value
}

function setAttribute(map, name, value) {
  const lower = name.toLowerCase()
  const existing = map.get(lower)
  if (existing) existing.value = value
  else map.set(lower, { name, value })
}

function removeAttribute(map, name) {
  map.delete(name.toLowerCase())
}

function addClass(map, ...classes) {
  const existing = new Set(String(getAttribute(map, 'class') ?? '').split(/\s+/).filter(Boolean))
  for (const className of classes) {
    if (className) existing.add(className)
  }
  setAttribute(map, 'class', [...existing].join(' '))
}

function removeClass(map, ...classes) {
  const remove = new Set(classes)
  const remaining = String(getAttribute(map, 'class') ?? '')
    .split(/\s+/)
    .filter((className) => className && !remove.has(className))
  if (remaining.length) setAttribute(map, 'class', remaining.join(' '))
  else removeAttribute(map, 'class')
}

function parseSrcset(value) {
  return String(value ?? '')
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/)
      return { url: parts[0], descriptor: parts.slice(1).join(' ') }
    })
    .filter((item) => item.url)
}

function serializeSrcset(items) {
  return items
    .map((item) => (item.descriptor ? `${item.url} ${item.descriptor}` : item.url))
    .join(', ')
}

function rewriteCssUrlsInStyles(html, assetFor) {
  return html.replace(STYLE_PATTERN, (match, prefix, quote, value) => {
    const rewritten = value.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (urlMatch, innerQuote, url) => {
      if (!isMirrorableMediaUrl(url)) return urlMatch
      const local = assetFor(normalizeMediaUrl(url))
      if (!local) return urlMatch
      return `url("${local}")`
    })
    return `${prefix}${quote}${rewritten}${quote}`
  })
}

export function createHtmlRewriter({ resolveHref, assetFor, base = '', logger = console }) {
  let remoteFallbacks = 0

  function rewriteImage(attributeText) {
    const map = attributeMap(parseAttributes(attributeText))
    const rawSrc = getAttribute(map, 'src') ?? ''
    const rawDataSrc = getAttribute(map, 'data-src') ?? ''
    const candidate = rawDataSrc || (rawSrc.startsWith('data:') ? '' : rawSrc)
    const normalized = candidate ? normalizeMediaUrl(candidate) : ''
    const local = normalized ? assetFor(normalized) : null

    if (local) {
      setAttribute(map, 'src', local)
    } else if (normalized && isMirrorableMediaUrl(normalized)) {
      // Keep the original CDN URL as an online fallback when a download failed.
      setAttribute(map, 'src', normalized)
      setAttribute(map, 'data-remote', '1')
      remoteFallbacks += 1
    } else if (normalized) {
      // External image that is not hosted on the wiki's media CDN.
      setAttribute(map, 'src', normalized)
      setAttribute(map, 'referrerpolicy', 'no-referrer')
    } else if (rawSrc.startsWith('data:')) {
      setAttribute(map, 'src', TRANSPARENT_PIXEL)
      addClass(map, 'broken-image')
      remoteFallbacks += 1
    } else if (rawSrc) {
      setAttribute(map, 'src', rawSrc)
      setAttribute(map, 'referrerpolicy', 'no-referrer')
    }

    removeAttribute(map, 'data-src')
    removeAttribute(map, 'data-image-key')
    removeAttribute(map, 'data-relevant')
    removeAttribute(map, 'data-tracking-label')
    removeClass(map, 'lazyload', 'lazyloaded')

    const alt = String(getAttribute(map, 'alt') ?? '').trim()
    if (/^style\s*=/i.test(alt) || /^vertical-align\s*:/i.test(alt)) {
      const imageName = String(getAttribute(map, 'data-image-name') ?? '').trim()
      setAttribute(map, 'alt', imageName)
    }
    setAttribute(map, 'loading', getAttribute(map, 'loading') || 'lazy')
    setAttribute(map, 'decoding', 'async')

    const srcset = getAttribute(map, 'srcset')
    if (srcset) {
      const rewritten = parseSrcset(srcset).map((item) => {
        if (!isMirrorableMediaUrl(item.url)) return item
        const localSet = assetFor(normalizeMediaUrl(item.url))
        return localSet ? { ...item, url: localSet } : item
      })
      setAttribute(map, 'srcset', serializeSrcset(rewritten))
    }

    return `<img${serializeAttributes(mapToAttributes(map))}>`
  }

  function rewriteMediaTag(tagName, attributeText, selfClosing) {
    const map = attributeMap(parseAttributes(attributeText))
    for (const name of ['src', 'data-src', 'poster']) {
      const raw = getAttribute(map, name)
      if (!raw) continue
      const normalized = normalizeMediaUrl(raw)
      if (!normalized) continue
      const local = assetFor(normalized)
      if (local) {
        setAttribute(map, name, local)
        removeAttribute(map, 'data-src')
      } else if (isMirrorableMediaUrl(normalized)) {
        setAttribute(map, name, normalized)
        setAttribute(map, 'data-remote', '1')
        remoteFallbacks += 1
      }
    }
    removeAttribute(map, 'data-src')
    if (tagName === 'video') {
      setAttribute(map, 'controls', '')
      setAttribute(map, 'playsinline', '')
      if (!getAttribute(map, 'preload')) setAttribute(map, 'preload', 'metadata')
    }
    if (tagName === 'audio') {
      setAttribute(map, 'controls', '')
      if (!getAttribute(map, 'preload')) setAttribute(map, 'preload', 'metadata')
    }
    return `<${tagName}${serializeAttributes(mapToAttributes(map))}${selfClosing ? ' /' : ''}>`
  }

  function rewriteAnchor(attributeText) {
    const map = attributeMap(parseAttributes(attributeText))
    const rawHref = getAttribute(map, 'href')
    if (rawHref === undefined) return `<a${serializeAttributes(mapToAttributes(map))}>`

    const href = decodeEntities(rawHref).trim()
    removeAttribute(map, 'data-tracking-label')

    if (isMirrorableMediaUrl(href)) {
      const normalized = normalizeMediaUrl(href)
      const local = assetFor(normalized)
      if (local) {
        setAttribute(map, 'href', local)
        setAttribute(map, 'data-lightbox', '')
        addClass(map, 'image-link')
        removeAttribute(map, 'target')
      } else {
        setAttribute(map, 'href', normalized || href)
        setAttribute(map, 'target', '_blank')
        setAttribute(map, 'rel', 'noopener noreferrer')
      }
      return `<a${serializeAttributes(mapToAttributes(map))}>`
    }

    const resolved = resolveHref(href)
    if (resolved.type === 'anchor') {
      setAttribute(map, 'href', resolved.href || '#')
      if (resolved.href === '#') setAttribute(map, 'data-tab-link', '')
      return `<a${serializeAttributes(mapToAttributes(map))}>`
    }
    if (resolved.type === 'internal') {
      setAttribute(map, 'href', resolved.url)
      setAttribute(map, 'data-internal', '')
      removeAttribute(map, 'target')
      removeClass(map, 'external')
      return `<a${serializeAttributes(mapToAttributes(map))}>`
    }
    if (resolved.type === 'missing') {
      setAttribute(map, 'href', resolved.url)
      setAttribute(map, 'target', '_blank')
      setAttribute(map, 'rel', 'noopener noreferrer')
      addClass(map, 'external', 'redlink')
      return `<a${serializeAttributes(mapToAttributes(map))}>`
    }
    if (resolved.type === 'external' || resolved.type === 'empty') {
      if (resolved.type === 'empty') {
        setAttribute(map, 'href', '#')
        return `<a${serializeAttributes(mapToAttributes(map))}>`
      }
      setAttribute(map, 'href', resolved.url || href)
      if (/^https?:/i.test(resolved.url || href)) {
        setAttribute(map, 'target', '_blank')
        setAttribute(map, 'rel', 'noopener noreferrer')
      }
      return `<a${serializeAttributes(mapToAttributes(map))}>`
    }
    return `<a${serializeAttributes(mapToAttributes(map))}>`
  }

  function rewrite(html) {
    remoteFallbacks = 0
    let content = String(html ?? '')
    content = content
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
      .replace(/<figcaption\b[^>]*>\s*style\s*=[\s\S]*?<\/figcaption>/gi, '')
      .replace(/<fandom-ad\b[^>]*>[\s\S]*?<\/fandom-ad>/gi, '')
      .replace(/<fandom-ad\b[^>]*\/?>/gi, '')
      .replace(/\s(?:on[a-z]+|data-tracking-[a-z-]+)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')

    content = rewriteCssUrlsInStyles(content, assetFor)
    content = content.replace(TAG_PATTERN, (match, tagName, attributes) => {
      const lower = tagName.toLowerCase()
      if (lower === 'img') return rewriteImage(attributes)
      const selfClosing = /\/\s*$/.test(attributes)
      return rewriteMediaTag(lower, attributes, selfClosing)
    })
    content = content.replace(ANCHOR_PATTERN, (match, attributes) => rewriteAnchor(attributes))
    return { html: content, remoteFallbacks }
  }

  return { rewrite }
}

export function collectAssets(html) {
  const urls = new Set()
  collectMediaUrls(html, (url) => urls.add(url))
  return urls
}

export { TRANSPARENT_PIXEL }
