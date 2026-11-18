import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SITE, namespaceLabel } from './config.mjs'
import {
  MediaMirror,
  isMirrorableMediaUrl,
  normalizeMediaUrl,
  thumbnailUrl,
} from './assets.mjs'
import { formatDateTime, formatNumber, formatUtc } from './format.mjs'
import {
  renderBreadcrumb,
  renderDocument,
  renderHomeStatus,
  renderToc,
} from './layout.mjs'
import { createLinkResolver } from './links.mjs'
import {
  absoluteUrl,
  assignPagePaths,
  escapeHtml,
  pageUrl,
  pageUrlWithAnchor,
  shortHash,
  sourceTitleUrl,
  stripTags,
  titleKey,
  truncate,
} from './paths.mjs'
import { collectAssets, createHtmlRewriter } from './rewrite.mjs'
import { formatBytes, formatDuration } from './util.mjs'

const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url))

const KIND_BY_NAMESPACE = {
  0: 'article',
  2: 'user',
  4: 'project',
  6: 'file',
  10: 'template',
  14: 'category',
  502: 'blog',
  828: 'module',
  2900: 'map',
}

const INDEX_NAMESPACES = [0, 2, 4, 6, 10, 14, 502, 828, 2900]

const ACTIVE_BY_KIND = {
  template: 'templates',
  module: 'templates',
  file: 'media',
  category: 'categories',
  map: 'maps',
}

const MEDIA_ICON = {
  video: '<span class="media-fallback" aria-hidden="true">▶</span>',
  audio: '<span class="media-fallback" aria-hidden="true">♪</span>',
  file: '<span class="media-fallback" aria-hidden="true">▧</span>',
}

function kindFor(record) {
  return KIND_BY_NAMESPACE[record.ns] ?? 'article'
}

function isHomeCandidate(record, mainKey) {
  return record.key === mainKey
}

function imageLookupNames(name) {
  const normalized = String(name ?? '').replace(/_/g, ' ')
  return [name, normalized, normalized.trim()]
}

function mediaKind(mime) {
  if (String(mime ?? '').startsWith('video/')) return 'video'
  if (String(mime ?? '').startsWith('audio/')) return 'audio'
  return 'file'
}

function commentText(comment) {
  return String(comment?.text ?? comment?.content ?? comment?.comment ?? '')
}

function commentAuthor(comment) {
  return String(
    comment?.userName ?? comment?.username ?? comment?.author?.name ?? comment?.createdBy?.name ?? '匿名用户',
  )
}

function commentAvatar(comment) {
  return comment?.userAvatar ?? comment?.avatar ?? comment?.author?.avatar ?? comment?.createdBy?.avatarUrl ?? ''
}

function commentTimestamp(comment) {
  const value = comment?.timestamp ?? comment?.createdAt ?? comment?.creationDate ?? comment?.createdAtUtc
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value).toISOString()
  return value ?? ''
}

function commentReplies(comment) {
  return Array.isArray(comment?.replies) ? comment.replies : []
}

function walkComments(comments) {
  const out = []
  for (const comment of comments ?? []) {
    out.push(comment)
    out.push(...walkComments(commentReplies(comment)))
  }
  return out
}

function adfInline(nodes) {
  return (nodes ?? [])
    .map((node) => {
      if (node?.type === 'text') {
        let text = escapeHtml(node.text ?? '')
        for (const mark of node.marks ?? []) {
          if (mark.type === 'strong') text = `<strong>${text}</strong>`
          else if (mark.type === 'em') text = `<em>${text}</em>`
          else if (mark.type === 'code') text = `<code>${text}</code>`
          else if (mark.type === 'strike') text = `<s>${text}</s>`
          else if (mark.type === 'link' && mark.attrs?.href) {
            text = `<a href="${escapeHtml(mark.attrs.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
          }
        }
        return text
      }
      if (node?.type === 'hardBreak') return '<br>'
      if (node?.type === 'mention') return `@${escapeHtml(node.attrs?.text ?? node.attrs?.id ?? '')}`
      if (node?.type === 'emoji') return escapeHtml(node.attrs?.text ?? '')
      if (node?.content) return adfInline(node.content)
      return ''
    })
    .join('')
}

function adfBlock(node) {
  if (!node) return ''
  switch (node.type) {
    case 'paragraph':
      return `<p>${adfInline(node.content)}</p>`
    case 'heading':
      return `<h${Math.min(4, Number(node.attrs?.level) || 3)}>${adfInline(node.content)}</h${Math.min(4, Number(node.attrs?.level) || 3)}>`
    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map(adfBlock).join('')}</blockquote>`
    case 'codeBlock':
      return `<pre><code>${escapeHtml((node.content ?? []).map((child) => child.text ?? '').join('\n'))}</code></pre>`
    case 'rule':
      return '<hr>'
    case 'bulletList':
    case 'orderedList': {
      const tag = node.type === 'orderedList' ? 'ol' : 'ul'
      return `<${tag}>${(node.content ?? []).map((item) => `<li>${(item.content ?? []).map(adfBlock).join('')}</li>`).join('')}</${tag}>`
    }
    case 'listItem':
      return (node.content ?? []).map(adfBlock).join('')
    case 'mediaGroup':
    case 'mediaSingle':
      return (node.content ?? []).map(adfBlock).join('')
    case 'media': {
      const url = node.attrs?.url
      return url ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">查看附件</a></p>` : ''
    }
    default:
      return node.content ? node.content.map(adfBlock).join('') : ''
  }
}

function discussionContent(item) {
  const raw = String(item?.rawContent ?? '').trim()
  if (raw) {
    return raw
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
      .join('')
  }
  const model = item?.jsonModel
  if (!model) return ''
  try {
    const doc = typeof model === 'string' ? JSON.parse(model) : model
    return (doc.content ?? []).map(adfBlock).join('')
  } catch {
    return ''
  }
}

function thumbUrlFor(image, width) {
  if (!image?.url) return null
  if (String(image.mime ?? '') === 'image/svg+xml') return image.url
  if (!String(image.mime ?? '').startsWith('image/')) return null
  return thumbnailUrl(image.url, width)
}

function mediaTypeLabel(mime) {
  const type = String(mime ?? '')
  if (type === 'image/png') return 'PNG'
  if (type === 'image/jpeg') return 'JPEG'
  if (type === 'image/webp') return 'WebP'
  if (type === 'image/gif') return 'GIF'
  if (type === 'image/svg+xml') return 'SVG'
  if (type === 'video/mp4') return 'MP4'
  if (type === 'audio/mpeg') return 'MP3'
  return type || '文件'
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export async function generateSite({ config, data, buildStartedAt, logger = console }) {
  const { siteinfo, pages, images, fileUsage, categoryInfo, categoryMembers, discussion, statistics, mainPage, projectName } = data
  const customStyles = data.customStyles ?? []
  const customCssSource = customStyles
    .map((style) => `/* ${style.title} */\n${style.content}`)
    .join('\n\n')
  const now = new Date()
  const startedAt = buildStartedAt instanceof Date ? buildStartedAt.getTime() : Number(buildStartedAt ?? now)
  const styleSource = await readFile(join(ASSETS_DIR, 'style.css'), 'utf8')
  const scriptSource = await readFile(join(ASSETS_DIR, 'app.js'), 'utf8')
  const buildId = `${now.toISOString().slice(0, 13).replace(/[-:T]/g, '')}-${shortHash(styleSource + scriptSource + customCssSource, 8)}`
  const build = {
    id: buildId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: now.toISOString(),
    durationMs: Date.now() - startedAt,
    pages: 0,
    failedPages: 0,
    media: { files: images.length, assets: 0, bytes: 0, failed: 0, downloaded: 0 },
    parseFailures: data.parseFailures ?? [],
    requestCount: data.requestCount ?? 0,
    runUrl: config.runUrl,
    revision: config.revision,
    remoteMedia: 0,
  }

  const mainKey = titleKey(mainPage, { projectName })
  const records = pages.map((page) => ({
    ...page,
    kind: kindFor(page),
    sourceUrl: sourceTitleUrl(page.title),
    sections: page.sections ?? [],
    html: page.html ?? '',
    wikitext: page.wikitext ?? '',
  }))
  let homeRecord = records.find((record) => isHomeCandidate(record, mainKey))
  if (!homeRecord) homeRecord = records.find((record) => record.ns === 0) ?? records[0]
  if (!homeRecord) throw new Error('没有可镜像的页面')

  assignPagePaths(records, { homeKey: homeRecord.key })
  homeRecord = records.find((record) => record.key === homeRecord.key) ?? homeRecord

  for (const record of records) {
    record.history = record.history ?? []
    record.historyPath = record.urlPath ? `${record.urlPath}/history` : 'history'
    record.historyUrl = record.history.length ? `${config.base}/${record.historyPath}/` : ''
  }

  const resolver = createLinkResolver({
    pages: records,
    projectName,
    base: config.base,
  })

  const imageByName = new Map()
  for (const image of images) {
    for (const name of imageLookupNames(image.name)) imageByName.set(name, image)
  }
  const fileRecordByName = new Map()
  for (const record of records.filter((item) => item.ns === 6)) {
    fileRecordByName.set(titleKey(record.title), record)
    const name = record.title.replace(/^File:/i, '')
    for (const alias of imageLookupNames(name)) {
      fileRecordByName.set(titleKey(`File:${alias}`), record)
    }
  }

  function fileRecordForImage(image) {
    for (const name of imageLookupNames(image.name)) {
      const record = fileRecordByName.get(titleKey(`File:${name}`))
      if (record) return record
    }
    return null
  }

  function mapBoundsFor(map) {
    const bounds = map?.mapBounds
    if (!Array.isArray(bounds) || bounds.length < 2) return null
    const [[minX, minY], [maxX, maxY]] = bounds
    const width = Number(maxX) - Number(minX)
    const height = Number(maxY) - Number(minY)
    if (!(width > 0) || !(height > 0)) return null
    return { minX: Number(minX), minY: Number(minY), maxX: Number(maxX), maxY: Number(maxY), width, height }
  }

  function mapImageFor(map) {
    const directName = String(map?.mapImage ?? '').replace(/^File:/i, '')
    const direct = directName ? imageByName.get(directName) : null
    if (direct) return direct
    // Some maps reference an image that has since been renamed. Fall back to
    // the uploaded image that exactly matches the map's coordinate bounds.
    const bounds = mapBoundsFor(map)
    if (!bounds) return null
    const candidates = images.filter(
      (image) => Number(image.width) === bounds.width && Number(image.height) === bounds.height,
    )
    return (
      candidates.find((image) => /地图|map|含地狱|世界|world/i.test(image.name)) ??
      candidates[0] ??
      null
    )
  }

  function resolveRedirect(record) {
    let title = record.redirectTarget
    let anchor = record.redirectAnchor ?? ''
    const seen = new Set([record.key])
    for (let depth = 0; depth < 6; depth += 1) {
      const target = resolver.lookup(title)
      if (!target) {
        return {
          missing: true,
          title,
          url: `${sourceTitleUrl(title)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`,
        }
      }
      if (seen.has(target.key)) break
      seen.add(target.key)
      if (target.isRedirect) {
        title = target.redirectTarget
        anchor = anchor || target.redirectAnchor || ''
        continue
      }
      return {
        record: target,
        title: target.title,
        url: pageUrlWithAnchor(target, config.base, anchor),
      }
    }
    return { missing: true, title, url: sourceTitleUrl(title) }
  }

  // ---------------------------------------------------------------------
  // Assets: collect every referenced media URL before rewriting HTML.
  // ---------------------------------------------------------------------
  const assetSet = new Set()
  const addAsset = (value) => {
    const normalized = normalizeMediaUrl(value)
    if (normalized) assetSet.add(normalized)
  }
  for (const record of records) {
    if (record.html) {
      for (const url of collectAssets(record.html)) assetSet.add(url)
    }
    for (const comment of walkComments(record.comments)) {
      for (const url of collectAssets(commentText(comment))) assetSet.add(url)
      const avatar = commentAvatar(comment)
      if (isMirrorableMediaUrl(avatar)) addAsset(avatar)
    }
  }
  for (const item of [...(discussion.threads ?? []), ...(discussion.posts ?? [])]) {
    addAsset(item.createdBy?.avatarUrl ?? item.threadCreatedBy?.avatarUrl ?? '')
    for (const url of String(item.rawContent ?? '').match(/https:\/\/static\.wikia\.nocookie\.net\/[^\s"'<>]+/g) ?? []) {
      addAsset(url)
    }
    for (const image of item._embedded?.attachments?.[0]?.contentImages ?? []) {
      addAsset(image.url ?? image.src ?? '')
    }
  }
  for (const image of images) {
    addAsset(image.url)
    const large = thumbUrlFor(image, 800)
    const small = thumbUrlFor(image, 240)
    if (large) addAsset(large)
    if (small) addAsset(small)
  }
  for (const record of records.filter((item) => item.kind === 'map')) {
    const image = mapImageFor(record.map)
    const thumb = image ? thumbUrlFor(image, 480) : null
    if (thumb) addAsset(thumb)
  }
  for (const style of customStyles) {
    for (const match of style.content.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
      if (isMirrorableMediaUrl(match[2])) addAsset(normalizeMediaUrl(match[2]))
    }
  }
  const uploadedLogo = images.find((image) => /^Site-logo\.(png|jpe?g|svg|webp)$/i.test(image.name))
  const uploadedFavicon = images.find((image) => /^Site-favicon\.(ico|png)$/i.test(image.name))
  const logoSource = normalizeMediaUrl(uploadedLogo?.url || siteinfo.general.logo)
  const faviconSource = normalizeMediaUrl(
    uploadedFavicon?.url || siteinfo.general.favicon || `${siteinfo.general.server}/favicon.ico`,
  )
  if (logoSource) addAsset(logoSource)
  if (faviconSource) addAsset(faviconSource)

  logger.info(`媒体引用：${assetSet.size} 个 URL（含原图、缩略图与站点标志）`)
  const media = new MediaMirror({
    cacheDir: join(config.cacheDir, 'media'),
    base: config.base,
    userAgent: config.userAgent,
    concurrency: config.mediaConcurrency,
    logger,
    skip: config.skipMedia,
  })
  await media.init()
  await media.mirror([...assetSet], { label: '媒体' })

  const usedAssetUrls = new Set([...assetSet].filter((url) => media.entries.has(url)))
  const mediaBytes = [...usedAssetUrls].reduce((sum, url) => sum + (media.entries.get(url)?.size ?? 0), 0)
  build.media.assets = usedAssetUrls.size
  build.media.bytes = mediaBytes
  build.media.failed = media.failures.size
  build.media.downloaded = media.downloadedFiles

  // The site's configured logo/favicon can point at deleted files on Fandom.
  // Prefer the uploaded Site-logo / Site-favicon files when they exist.
  const resolvedLogo = (logoSource && media.urlFor(logoSource)) || null
  const resolvedFavicon = (faviconSource && media.urlFor(faviconSource)) || null
  const backgroundLightImage = images.find((image) => /^Site-background-light(?:\.|$)/i.test(image.name))
  const backgroundDarkImage = images.find((image) => /^Site-background-dark(?:\.|$)/i.test(image.name))
  const backgroundLight = backgroundLightImage ? media.urlFor(backgroundLightImage.url) : null
  const backgroundDark = backgroundDarkImage ? media.urlFor(backgroundDarkImage.url) : null
  build.finishedAt = new Date().toISOString()
  build.durationMs = Date.now() - startedAt

  const site = {
    name: SITE.name,
    title: SITE.title,
    description: SITE.description,
    lang: SITE.lang,
    sourceUrl: SITE.sourceUrl,
    license: SITE.license,
    licenseUrl: SITE.licenseUrl,
    repository: SITE.repository,
    logo: resolvedLogo,
    favicon: resolvedFavicon,
    backgroundLight,
    backgroundDark,
  }
  if (!site.favicon) site.favicon = `${config.base}/assets/favicon.svg`

  const wikiCss = customCssSource.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, quote, value) => {
    const normalized = normalizeMediaUrl(value)
    const local = normalized ? media.urlFor(normalized) : null
    return local ? `url("${local}")` : match
  })

  const rewriter = createHtmlRewriter({
    resolveHref: resolver.resolve,
    assetFor: (url) => media.urlFor(url),
    base: config.base,
    logger,
  })

  function localImage(image, width) {
    const thumb = thumbUrlFor(image, width)
    return (thumb && media.urlFor(thumb)) || media.urlFor(image.url) || null
  }

  function renderRedirect(record) {
    const target = resolveRedirect(record)
    record.redirectUrl = target.url
    record.redirectTitle = target.title
    const content = `<div class="redirect-box">
  <p>此页面重定向到：<strong><a href="${escapeHtml(target.url)}">${escapeHtml(target.title)}</a></strong></p>
  <p class="redirect-box__note">如果浏览器没有自动跳转，请点击上方链接。</p>
  ${target.missing ? '<p class="redirect-box__warn">重定向目标未包含在本次镜像中，链接指向原站。</p>' : ''}
</div>`
    return {
      html: content,
      headExtra: `<meta http-equiv="refresh" content="0; url=${escapeHtml(target.url)}">
  <meta name="robots" content="noindex">`,
      summary: `重定向到 ${target.title}`,
      plainText: `重定向到 ${target.title}`,
    }
  }

  function renderFile(record) {
    const name = record.title.replace(/^File:/i, '')
    let image = imageByName.get(name)
    if (!image) {
      for (const alias of imageLookupNames(name)) {
        image = imageByName.get(alias)
        if (image) break
      }
    }
    const usage = fileUsage.get(record.title) ?? []
    const preview = image ? localImage(image, 800) : null
    const original = image ? media.urlFor(image.url) : null
    const sourceUrl = sourceTitleUrl(record.title)
    let html = ''
    if (record.html) {
      html += rewriter.rewrite(record.html).html
    }
    if (image) {
      const width = image.width ? `${image.width} × ${image.height} 像素` : ''
      const kind = mediaKind(image.mime)
      const mediaSource = original || image.url
      let visual
      if (preview) {
        visual = `<a class="image-link" href="${escapeHtml(preview)}" data-lightbox data-caption="${escapeHtml(name)}"><img src="${escapeHtml(preview)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async"></a>`
      } else if (kind === 'video') {
        visual = `<video class="file-player" controls preload="metadata" playsinline src="${escapeHtml(mediaSource)}"></video>`
      } else if (kind === 'audio') {
        visual = `<audio class="file-player file-player--audio" controls preload="metadata" src="${escapeHtml(mediaSource)}"></audio>`
      } else {
        visual = '<p class="notice">媒体文件未能同步，请使用下方下载链接。</p>'
      }
      html += `<figure class="file-preview">
  ${visual}
  <figcaption>${escapeHtml(name)}${width ? ` · ${width}` : ''}</figcaption>
</figure>
<table class="wikitable file-meta">
  <caption>文件信息</caption>
  <tbody>
    <tr><th scope="row">文件名</th><td>${escapeHtml(image.name)}</td></tr>
    <tr><th scope="row">类型</th><td>${escapeHtml(mediaTypeLabel(image.mime))}</td></tr>
    <tr><th scope="row">大小</th><td>${formatBytes(image.size)}</td></tr>
    <tr><th scope="row">尺寸</th><td>${image.width ? `${formatNumber(image.width)} × ${formatNumber(image.height)}` : '—'}</td></tr>
    <tr><th scope="row">上传时间</th><td>${image.timestamp ? `<time datetime="${escapeHtml(image.timestamp)}">${formatDateTime(image.timestamp)}</time>` : '—'}</td></tr>
    <tr><th scope="row">上传者</th><td>${escapeHtml(image.user || '—')}</td></tr>
    <tr><th scope="row">下载</th><td>${original ? `<a href="${escapeHtml(original)}" download="${escapeHtml(image.name)}">下载镜像文件</a>` : `<a href="${escapeHtml(image.url)}" target="_blank" rel="noopener noreferrer">从原站下载</a>`} · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">原文件页面</a></td></tr>
  </tbody>
</table>`
    } else {
      html += `<div class="notice notice--delete"><p>源站没有找到名为 <strong>${escapeHtml(name)}</strong> 的文件，可能已被删除或尚未上传。</p><p><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原文件页面</a></p></div>`
    }
    if (usage.length) {
      const items = usage
        .map((item) => {
          const target = resolver.lookup(item.title)
          const href = target ? pageUrl(target, config.base) : sourceTitleUrl(item.title)
          return `<li><a href="${escapeHtml(href)}"${target ? '' : ' target="_blank" rel="noopener noreferrer"'}>${escapeHtml(item.title)}</a></li>`
        })
        .join('')
      html += `<h2>使用此文件的页面</h2><ul class="file-usage">${items}</ul>`
    }
    return {
      html,
      headExtra: '',
      summary: image
        ? `${mediaTypeLabel(image.mime)} 文件，${formatBytes(image.size)}${usage.length ? `，被 ${usage.length} 个页面使用` : ''}`
        : '源站缺失的文件页面',
      plainText: stripTags(html),
    }
  }

  function renderCategory(record) {
    const members = categoryMembers.get(record.title) ?? []
    const groups = [
      { type: 'page', label: '页面', anchor: 'category-pages' },
      { type: 'subcat', label: '子分类', anchor: 'category-subcats' },
      { type: 'file', label: '文件', anchor: 'category-files' },
    ]
    let html = record.html ? rewriter.rewrite(record.html).html : ''
    const sections = []
    for (const group of groups) {
      const items = members
        .filter((member) => member.type === group.type)
        .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
      if (!items.length) continue
      sections.push({ anchor: group.anchor, line: `${group.label}（${items.length}）`, level: 2 })
      const links = items
        .map((member) => {
          const target = resolver.lookup(member.title)
          const href = target ? pageUrl(target, config.base) : sourceTitleUrl(member.title)
          return `<li><a href="${escapeHtml(href)}"${target ? '' : ' target="_blank" rel="noopener noreferrer"'}>${escapeHtml(member.title)}</a></li>`
        })
        .join('')
      html += `<h2 id="${group.anchor}">${group.label}（${items.length}）</h2><ul class="category-members">${links}</ul>`
    }
    if (!sections.length && !stripTags(html).trim()) {
      html = '<p class="notice">此分类目前没有成员。</p>'
    }
    record.sections = sections
    return {
      html,
      headExtra: '',
      summary: `分类，共 ${members.length} 个成员`,
      plainText: stripTags(html),
    }
  }

  function renderMap(record) {
    const map = record.map
    const fallbackNotice = '<div class="notice">此互动地图的源站数据无法解析或为空，仅显示原始数据链接。</div>'
    if (!map) {
      return {
        html: `${fallbackNotice}<p><a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原地图页面</a></p>`,
        headExtra: '',
        summary: '互动地图（数据缺失）',
        plainText: '互动地图数据缺失',
      }
    }
    const bounds = mapBoundsFor(map) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 }
    const image = mapImageFor(map)
    const imageUrl = image ? media.urlFor(image.url) : null
    const originTop = String(map.origin ?? '').toLowerCase().includes('top')
    const categories = Array.isArray(map.categories) ? map.categories : []
    const categoryById = new Map(categories.map((category) => [String(category.id), category]))
    const markers = Array.isArray(map.markers) ? map.markers : []
    const markerCounts = new Map()
    let markerHtml = ''
    const listItems = []

    markers.forEach((marker, index) => {
      const categoryId = String(marker.categoryId ?? '')
      markerCounts.set(categoryId, (markerCounts.get(categoryId) ?? 0) + 1)
      const category = categoryById.get(categoryId)
      const color = /^#[0-9a-f]{3,8}$/i.test(String(category?.color ?? '')) ? category.color : 'var(--accent)'
      const position = Array.isArray(marker.position) ? marker.position : [0, 0]
      const rawX = Number(position[0])
      const rawY = Number(position[1])
      const left = Math.min(100, Math.max(0, ((rawX - bounds.minX) / bounds.width) * 100))
      const top = Math.min(
        100,
        Math.max(0, ((originTop ? rawY - bounds.minY : bounds.maxY - rawY) / bounds.height) * 100),
      )
      const title = String(marker.popup?.title ?? `标记 ${index + 1}`)
      const description = String(marker.popup?.description ?? '')
      const rawLink = String(marker.popup?.link?.url ?? '')
      let link = ''
      if (rawLink) {
        const resolved = resolver.resolve(rawLink)
        if (resolved.type === 'internal' || resolved.type === 'external' || resolved.type === 'missing') link = resolved.url
      }
      const linkLabel = String(marker.popup?.link?.label ?? '查看相关页面')
      const iconName = String(marker.icon ?? '').replace(/^File:/i, '')
      const iconImage = iconName ? imageByName.get(iconName) : null
      const iconUrl = iconImage ? media.urlFor(iconImage.url) : null
      const visual = iconUrl
        ? `<img class="map-marker__icon" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" decoding="async">`
        : '<span class="map-marker__dot"></span>'
      markerHtml += `<button class="map-marker" type="button" data-map-marker data-index="${index}" data-category="${escapeHtml(categoryId)}" data-title="${escapeHtml(title)}" data-description="${escapeHtml(description)}" data-link="${escapeHtml(link)}" data-link-label="${escapeHtml(linkLabel)}" style="left:${left.toFixed(4)}%;top:${top.toFixed(4)}%;--marker-color:${escapeHtml(color)}" aria-label="${escapeHtml(title)}">${visual}</button>`
      listItems.push(
        `<button class="map-list-item" type="button" data-marker-target="${index}"><span class="map-list-item__dot" style="--marker-color:${escapeHtml(color)}"></span><span class="map-list-item__text"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(category?.name ?? '未分类')}${description ? ` · ${escapeHtml(description)}` : ''}</small></span></button>`,
      )
    })

    const legend = [
      `<button class="map-filter is-active" type="button" data-map-filter="all">全部 <span>${markers.length}</span></button>`,
      ...categories.map((category) => {
        const id = String(category.id)
        const color = /^#[0-9a-f]{3,8}$/i.test(String(category.color ?? '')) ? category.color : 'var(--accent)'
        return `<button class="map-filter" type="button" data-map-filter="${escapeHtml(id)}" style="--marker-color:${escapeHtml(color)}"><span class="map-list-item__dot" style="--marker-color:${escapeHtml(color)}"></span>${escapeHtml(category.name)} <span>${markerCounts.get(id) ?? 0}</span></button>`
      }),
    ].join('')
    const description = String(map.description ?? '').trim()
    const title = String(map.title ?? record.title.replace(/^地图:/, ''))
    record.sections = [
      { anchor: 'map', line: '地图', level: 2 },
      { anchor: 'map-markers', line: '标记列表', level: 2 },
    ]
    const html = `<section class="interactive-map" data-map>
  <div class="map-intro">
    <h2 id="map">地图</h2>
    ${description ? `<p class="map-description">${escapeHtml(description)}</p>` : ''}
    <p class="map-meta">${escapeHtml(title)} · ${formatNumber(markers.length)} 个标记 · ${formatNumber(categories.length)} 个分类${image ? '' : ' · 源站地图图片缺失'}</p>
  </div>
  ${imageUrl ? '' : '<div class="notice">源站配置的地图图片不存在，已保留标记坐标；可在原站查看完整地图。</div>'}
  <div class="map-legend" role="group" aria-label="按分类筛选地图标记">${legend}</div>
  <div class="map-viewport" data-map-viewport style="aspect-ratio:${bounds.width} / ${bounds.height}">
    <div class="map-canvas" data-map-canvas>
      ${imageUrl ? `<img class="map-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" draggable="false" loading="lazy" decoding="async">` : '<div class="map-image map-image--missing"></div>'}
      ${markerHtml}
    </div>
  </div>
  <div class="map-tools">
    <button type="button" class="icon-button" data-map-zoom-in aria-label="放大地图">＋</button>
    <button type="button" class="icon-button" data-map-zoom-out aria-label="缩小地图">－</button>
    <button type="button" class="map-reset" data-map-reset>重置</button>
    <span class="map-zoom" data-map-zoom-label>100%</span>
    <span class="map-hint">滚轮缩放 · 拖动平移</span>
  </div>
  <aside class="map-info" data-map-info>点击地图标记或下方列表查看详情。</aside>
  <div class="map-marker-list-block">
    <h2 id="map-markers">标记列表</h2>
    ${listItems.length ? `<div class="map-marker-list">${listItems.join('')}</div>` : '<p class="comments-empty">此地图没有标记。</p>'}
  </div>
</section>`
    return {
      html,
      headExtra: '',
      summary: `互动地图，${markers.length} 个标记，${categories.length} 个分类`,
      plainText: `${description} ${markers.map((marker) => marker.popup?.title ?? '').join(' ')}`,
    }
  }


  function discussionAuthorName(author) {
    const name = String(author?.name ?? '匿名用户')
    const record = resolver.lookup(`User:${name}`)
    return record ? `<a href="${pageUrl(record, config.base)}">${escapeHtml(name)}</a>` : escapeHtml(name)
  }

  function discussionAvatar(author) {
    const url = normalizeMediaUrl(author?.avatarUrl ?? '')
    const local = url ? media.urlFor(url) : null
    if (local) return `<img class="discussion-avatar" src="${escapeHtml(local)}" alt="" loading="lazy" decoding="async">`
    const initial = String(author?.name ?? '?').slice(0, 1)
    return `<span class="discussion-avatar discussion-avatar--fallback" aria-hidden="true">${escapeHtml(initial)}</span>`
  }

  function discussionDateTime(item) {
    const epoch = item?.creationDate?.epochSecond ?? item?.creationDate?.epoch ?? null
    if (epoch) return new Date(Number(epoch) * 1000).toISOString()
    return item?.creationDate ?? ''
  }

  function discussionPost(post, firstPostId = '') {
    const content = discussionContent(post)
    const date = discussionDateTime(post)
    return `<div class="discussion-post${post.isReply ? ' discussion-post--reply' : ''}">
  <div class="discussion-post__head">${discussionAvatar(post.createdBy)}<span class="discussion-author">${discussionAuthorName(post.createdBy)}</span>${date ? `<time datetime="${escapeHtml(date)}">${formatDateTime(date)}</time>` : ''}${post.upvoteCount ? `<span class="comment-likes">♥ ${formatNumber(post.upvoteCount)}</span>` : ''}</div>
  <div class="discussion-post__body">${content || '<p class="discussion-empty">（空内容）</p>'}</div>
</div>`
  }

  function discussionThread(thread) {
    const replies = (discussion.posts ?? [])
      .filter((post) => String(post.threadId) === String(thread.id) && String(post.id) !== String(thread.firstPostId))
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    const forumName = thread.forumName || '综合讨论'
    const date = discussionDateTime(thread)
    return `<article class="discussion-thread" id="thread-${escapeHtml(thread.id)}" data-discussion-thread data-forum="${escapeHtml(forumName)}">
  <header class="discussion-thread__head">
    <span class="discussion-forum">${escapeHtml(forumName)}</span>
    <h2>${escapeHtml(thread.title || '（无标题主题）')}</h2>
    <p class="discussion-thread__meta">${discussionAuthorName(thread.createdBy)} · ${date ? `<time datetime="${escapeHtml(date)}">${formatDateTime(date)}</time>` : '时间未知'} · ${formatNumber(Math.max(0, replies.length))} 条回复${thread.upvoteCount ? ` · ♥ ${formatNumber(thread.upvoteCount)}` : ''}</p>
  </header>
  ${discussionPost({ ...thread, isReply: false }, thread.firstPostId)}
  ${replies.length ? `<ol class="discussion-replies">${replies.map((reply) => `<li>${discussionPost({ ...reply, isReply: true }, thread.firstPostId)}</li>`).join('')}</ol>` : '<p class="discussion-no-replies">暂无回复。</p>'}
  <p class="discussion-source"><a href="${escapeHtml(SITE.sourceOrigin + '/zh/f')}" target="_blank" rel="noopener noreferrer">在原站查看讨论</a></p>
</article>`
  }

  function renderHistory(record) {
    const revisions = record.history ?? []
    const data = revisions.map((revision) => ({
      revid: revision.revid,
      timestamp: revision.timestamp,
      user: revision.user,
      comment: revision.comment,
      size: revision.size,
      minor: revision.minor,
      content: revision.content ?? '',
    }))
    const rows = revisions
      .map((revision) => {
        const current = revision.revid === record.revid
        return `<li class="history-item" data-history-revision="${revision.revid}">
  <label class="history-check"><input type="checkbox" value="${revision.revid}" aria-label="选择修订 ${revision.revid}"></label>
  <div class="history-item__main">
    <div class="history-item__title"><strong class="mono">r${revision.revid}</strong>${current ? ' <span class="badge badge--current">当前</span>' : ''} <time datetime="${escapeHtml(revision.timestamp)}">${formatDateTime(revision.timestamp)}</time>${revision.minor ? ' <span class="history-minor">小编辑</span>' : ''}</div>
    <div class="history-item__meta">${escapeHtml(revision.user || '未知')} · ${formatBytes(revision.size)}${revision.comment ? ` · ${escapeHtml(revision.comment)}` : ''}</div>
    <button class="history-source-button" type="button" data-history-source="${revision.revid}">查看源代码</button>
  </div>
</li>`
      })
      .join('')
    const sourceHistory = `${record.sourceUrl}?action=history`
    return `<p class="index-intro">共 ${formatNumber(revisions.length)} 个历史版本。勾选两个版本后点击“对比所选版本”；也可以查看任意版本的维基文本源代码。</p>
<div class="history-toolbar">
  <span class="history-selection" data-history-status>已选 0/2 个版本</span>
  <button class="button" type="button" data-history-compare disabled>对比所选版本</button>
  <a class="history-back" href="${pageUrl(record, config.base)}">返回条目</a>
</div>
<div class="history-layout">
  <ol class="history-list" data-history-list>${rows}</ol>
  <div class="history-view">
    <div class="history-view__head" data-history-head>正在加载差异…</div>
    <div class="diff-panel" data-history-diff><p class="comments-empty">正在加载差异…</p></div>
    <details class="history-source-box">
      <summary>所选版本源代码</summary>
      <pre data-history-source-code>点击左侧“查看源代码”选择版本。</pre>
    </details>
  </div>
</div>
<script type="application/json" id="history-data">${safeJson({ title: record.title, revisions: data })}</script>
<p class="history-source-link"><a href="${escapeHtml(sourceHistory)}" target="_blank" rel="noopener noreferrer">在原站查看完整历史</a></p>`
  }

  async function writeHistoryPage(record) {
    const heading = `${record.title} · 历史版本`
    const html = renderDocument({
      config,
      site,
      build,
      counts,
      title: heading,
      description: `查看 ${record.title} 的历史版本并对比差异。`,
      active: ACTIVE_BY_KIND[record.kind] ?? '',
      index: true,
      headingHtml: escapeHtml(heading),
      contentHtml: renderHistory(record),
      breadcrumb: renderBreadcrumb(
        [
          { label: '首页', path: '' },
          { label: '全部页面', path: 'pages' },
          { label: record.title },
          { label: '历史版本' },
        ],
        config.base,
      ),
      urlPath: record.historyPath,
      headExtra: '<meta name="robots" content="noindex">',
    })
    await writePageHtml(record.historyPath, html)
  }

  function renderDiscussions() {
    const threads = discussion.threads ?? []
    const threadCount = discussion.threadCount ?? threads.length
    const postCount = discussion.postCount ?? threads.reduce((sum, thread) => sum + Number(thread.postCount ?? 0), 0)
    const boardUrl = SITE.sourceOrigin + '/zh/f'
    if (!threads.length) {
      return `<p class="index-intro">源站讨论版暂时没有可读取的主题，或 Discussions 接口未返回数据。</p>
<p><a class="button" href="${boardUrl}" target="_blank" rel="noopener noreferrer">访问原站讨论版</a></p>`
    }
    const forums = [...new Set(threads.map((thread) => thread.forumName || '综合讨论'))]
    const filterButtons = [
      `<button class="discussion-filter is-active" type="button" data-discussion-filter="all">全部 <span>${threads.length}</span></button>`,
      ...forums.map((forum) => {
        const count = threads.filter((thread) => (thread.forumName || '综合讨论') === forum).length
        return `<button class="discussion-filter" type="button" data-discussion-filter="${escapeHtml(forum)}">${escapeHtml(forum)} <span>${count}</span></button>`
      }),
    ].join('')
    return `<p class="index-intro">镜像自 Fandom Discussions，共 ${formatNumber(threadCount)} 个主题、${formatNumber(postCount)} 条回复。内容为构建时快照，回复请前往<a href="${boardUrl}" target="_blank" rel="noopener noreferrer">原站讨论版</a>。</p>
<div class="discussion-filters" role="group" aria-label="按板块筛选讨论">${filterButtons}</div>
<div class="discussion-thread-list" data-discussions>${threads.map((thread) => discussionThread(thread)).join('')}</div>`
  }

  function renderCommentItem(comment, depth = 0) {
    const author = commentAuthor(comment)
    const authorRecord = resolver.lookup(`User:${author}`)
    const authorName = authorRecord
      ? `<a href="${pageUrl(authorRecord, config.base)}">${escapeHtml(author)}</a>`
      : escapeHtml(author)
    const normalizedAvatar = normalizeMediaUrl(commentAvatar(comment))
    const avatar = normalizedAvatar ? media.urlFor(normalizedAvatar) : null
    const avatarHtml = avatar
      ? `<img class="comment-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" decoding="async">`
      : `<span class="comment-avatar comment-avatar--fallback" aria-hidden="true">${escapeHtml(author.slice(0, 1))}</span>`
    const raw = commentText(comment)
    const body = raw.includes('<')
      ? rewriter.rewrite(raw).html
      : `<p>${escapeHtml(raw).replace(/\n/g, '<br>')}</p>`
    const timestamp = commentTimestamp(comment)
    const likes = comment?.likes ?? comment?.likeCount ?? comment?.upvotes
    const replies = commentReplies(comment)
    const replyHtml = replies.length
      ? `<ul class="comment-replies">${replies.map((reply) => renderCommentItem(reply, depth + 1)).join('')}</ul>`
      : ''
    return `<li class="comment${depth ? ' comment--reply' : ''}"${comment?.id ? ` id="comment-${escapeHtml(comment.id)}"` : ''}>
  <div class="comment-head">${avatarHtml}<span class="comment-author">${authorName}</span>${timestamp ? `<time datetime="${escapeHtml(timestamp)}">${formatDateTime(timestamp)}</time>` : ''}${likes ? `<span class="comment-likes">♥ ${formatNumber(likes)}</span>` : ''}</div>
  <div class="comment-body">${body}</div>
  ${replyHtml}
</li>`
  }

  function renderComments(record) {
    const comments = record.comments ?? []
    const total = record.commentsTotal ?? comments.length
    const source = record.sourceUrl
    if (!comments.length) {
      const note = record.commentsSupported
        ? '源站页面暂无评论。'
        : '源站未返回评论，评论功能可能未启用或暂无评论。'
      return `<section class="comments-section comments-section--empty" id="comments">
  <div class="comments-head"><h2>页面评论</h2><span class="comments-count">0</span></div>
  <p class="comments-empty">${note} <a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">在原站查看或参与评论</a></p>
</section>`
    }
    return `<section class="comments-section" id="comments">
  <div class="comments-head"><h2>页面评论</h2><span class="comments-count">${formatNumber(total)}</span></div>
  <ol class="comment-list">${comments.map((comment) => renderCommentItem(comment)).join('')}</ol>
  <p class="comments-note">评论同步自原站，按源站顺序展示。<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">在原站参与讨论</a></p>
</section>`
  }

  let remoteMediaCount = 0
  for (const record of records) {
    let result
    if (record.isRedirect) {
      result = renderRedirect(record)
    } else if (record.kind === 'file') {
      result = renderFile(record)
    } else if (record.kind === 'category') {
      result = renderCategory(record)
    } else if (record.kind === 'map') {
      result = renderMap(record)
    } else if (record.html) {
      const rewritten = rewriter.rewrite(record.html)
      remoteMediaCount += rewritten.remoteFallbacks
      let html = rewritten.html
      if (record.kind === 'template' || record.kind === 'module') {
        html += `<details class="source-box">
  <summary>${record.kind === 'module' ? '模块' : '模板'}源代码（维基文本）</summary>
  <pre class="source-code"><code>${escapeHtml(record.wikitext)}</code></pre>
</details>`
      }
      if (record.kind === 'map' && !html.trim()) {
        html = `<p class="notice">互动地图需要原站的 JavaScript 才能显示。</p><pre class="source-code"><code>${escapeHtml(record.wikitext)}</code></pre>`
      }
      result = {
        html,
        headExtra: '',
        summary: triviaSummary(html),
        plainText: stripTags(html).slice(0, 6000),
      }
    } else if (record.parseError) {
      result = {
        html: `<div class="notice notice--delete"><p>本页在本次同步中渲染失败：${escapeHtml(record.parseError)}</p><p><a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原页面</a></p></div>`,
        headExtra: '',
        summary: '页面渲染失败',
        plainText: '',
      }
    } else {
      result = {
        html: `<p class="notice">此页面暂无内容。</p>`,
        headExtra: '',
        summary: `${record.nsName}空白页面`,
        plainText: '',
      }
    }
    record.contentHtml = result.html
    record.headExtra = result.headExtra
    record.summary = result.summary || `${record.nsName}页面`
    record.plainText = result.plainText || ''
    if (record.ns === 0 && !record.isRedirect) {
      const commentsHtml = renderComments(record)
      record.contentHtml += commentsHtml
      record.plainText += ` ${stripTags(commentsHtml)}`
    }
  }
  build.remoteMedia = remoteMediaCount

  // ---------------------------------------------------------------------
  // Render content pages into dist/wiki/<slug>/index.html
  // ---------------------------------------------------------------------
  const counts = {
    pages: records.length,
    articles: records.filter((record) => record.ns === 0).length,
    templates: records.filter((record) => record.ns === 10).length,
    modules: records.filter((record) => record.ns === 828).length,
    files: records.filter((record) => record.ns === 6).length,
    categories: records.filter((record) => record.ns === 14).length,
    media: images.length,
  }
  build.pages = records.length
  build.failedPages = (data.parseFailures?.length ?? 0) + records.filter((record) => record.missing).length

  await mkdir(config.outDir, { recursive: true })
  await cp(ASSETS_DIR, join(config.outDir, 'assets'), { recursive: true })
  await cp(join(ASSETS_DIR, 'sw.js'), join(config.outDir, 'sw.js'))
  await writeFile(join(config.outDir, 'assets', 'wiki-common.css'), `${wikiCss.trim()}\n`)
  const manifest = {
    id: `${config.base}/`,
    name: '来福Simulation Wiki 镜像',
    short_name: '来福 Wiki',
    description: '来福Simulation Wiki 的离线静态镜像：条目、模板、媒体、地图与讨论版。',
    lang: 'zh-CN',
    dir: 'ltr',
    start_url: `${config.base}/`,
    scope: `${config.base}/`,
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    background_color: '#0f766e',
    theme_color: '#0f766e',
    orientation: 'any',
    categories: ['reference', 'games', 'entertainment'],
    prefer_related_applications: false,
    icons: [
      { src: `${config.base}/assets/icons/icon-192.png?v=2`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${config.base}/assets/icons/icon-512.png?v=2`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${config.base}/assets/icons/icon-maskable-512.png?v=2`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '全部页面', short_name: '页面', url: `${config.base}/pages/`, icons: [{ src: `${config.base}/assets/icons/icon-192.png?v=2`, sizes: '192x192' }] },
      { name: '站内搜索', short_name: '搜索', url: `${config.base}/search/`, icons: [{ src: `${config.base}/assets/icons/icon-192.png?v=2`, sizes: '192x192' }] },
    ],
  }
  await writeFile(join(config.outDir, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(config.outDir, '.nojekyll'), '')

  const stats = {
    pages: counts.pages,
    articles: counts.articles,
    templates: counts.templates,
    modules: counts.modules,
    files: counts.files,
    categories: counts.categories,
    media: counts.media,
    ...statistics,
  }

  async function writePageHtml(urlPath, html) {
    const segments = String(urlPath ?? '')
      .split('/')
      .filter(Boolean)
    const filePath = join(config.outDir, ...segments, 'index.html')
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, html)
  }

  for (const record of records) {
    const isHome = record.key === homeRecord.key
    const badges = []
    if (record.kind === 'template' || record.kind === 'module') {
      badges.push({ label: '模板', modifier: 'template' })
    } else if (record.kind === 'file') {
      badges.push({ label: '文件', modifier: 'file' })
    } else {
      badges.push({ label: record.nsName })
    }
    if (record.isRedirect) badges.push({ label: '重定向', modifier: 'redirect' })
    const toc = record.kind === 'file' ? '' : renderToc(record.sections)
    const breadcrumb = isHome
      ? ''
      : renderBreadcrumb(
          [
            { label: '首页', path: '' },
            { label: '全部页面', path: 'pages' },
            { label: record.title },
          ],
          config.base,
        )
    const html = renderDocument({
      config,
      site,
      build,
      counts,
      title: record.title,
      description: record.summary,
      active: isHome ? 'home' : ACTIVE_BY_KIND[record.kind] ?? '',
      page: record,
      sourceUrl: record.sourceUrl,
      contentHtml: record.contentHtml,
      toc,
      breadcrumb,
      homeStatus: isHome ? renderHomeStatus({ build, stats, site }) : '',
      urlPath: record.urlPath,
      isHome,
      headExtra: record.headExtra,
    })
    await writePageHtml(record.urlPath, html)
    if (record.history.length) await writeHistoryPage(record)
  }

  // ---------------------------------------------------------------------
  // Index pages
  // ---------------------------------------------------------------------
  async function writeIndexPage({ path, title, heading, description, active, content, headExtra = '' }) {
    const html = renderDocument({
      config,
      site,
      build,
      counts,
      title,
      description,
      active,
      index: true,
      headingHtml: escapeHtml(heading),
      contentHtml: content,
      breadcrumb: renderBreadcrumb(
        [
          { label: '首页', path: '' },
          { label: heading },
        ],
        config.base,
      ),
      urlPath: path,
      headExtra,
    })
    await writePageHtml(path, html)
  }

  const namespaceGroups = INDEX_NAMESPACES.map((namespace) => ({
    namespace,
    label: namespaceLabel(namespace),
    items: records
      .filter((record) => record.ns === namespace)
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
  })).filter((group) => group.items.length)

  const pagesIndexContent = `<p class="index-intro">镜像共收录 ${formatNumber(records.length)} 个页面，按命名空间分组。点击条目进入本地镜像页面；带“重定向”标记的页面会自动跳转。</p>
<div class="index-toolbar"><input type="search" data-filter="#pages-index" placeholder="筛选页面标题…" aria-label="筛选页面标题"><span class="index-count">${formatNumber(records.length)} 页</span></div>
<div id="pages-index">
${namespaceGroups
  .map(
    (group) => `<section class="index-section" id="ns-${group.namespace}">
  <div class="index-section__head"><h2>${escapeHtml(group.label)}</h2><span class="index-count">${formatNumber(group.items.length)} 页</span></div>
  <ul class="index-link-list">
    ${group.items
      .map(
        (record) =>
          `<li data-filter-item data-title="${escapeHtml(record.title)}"><a href="${pageUrl(record, config.base)}">${escapeHtml(record.title)}</a>${record.isRedirect ? ' <span class="meta">（重定向）</span>' : ''}</li>`,
      )
      .join('')}
  </ul>
</section>`,
  )
  .join('')}
</div>`
  await writeIndexPage({
    path: 'pages',
    title: '全部页面',
    heading: '全部页面',
    description: `按命名空间浏览镜像收录的 ${formatNumber(records.length)} 个页面。`,
    active: 'pages',
    content: pagesIndexContent,
  })

  const templateRecords = records
    .filter((record) => record.ns === 10 || record.ns === 828)
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  const templatesIndexContent = `<p class="index-intro">模板与模块页面共 ${formatNumber(templateRecords.length)} 个。镜像在构建时调用 MediaWiki 解析器展开模板，因此条目中的信息框、导航框、标签页等模板内容都会以静态 HTML 呈现；模板页面本身也保留维基文本源代码。</p>
<div class="index-toolbar"><input type="search" data-filter="#templates-index" placeholder="筛选模板名称…" aria-label="筛选模板名称"><span class="index-count">${formatNumber(templateRecords.length)} 个</span></div>
<div class="card-grid" id="templates-index">
${templateRecords
  .map(
    (record) => `<a class="card" href="${pageUrl(record, config.base)}" data-filter-item data-title="${escapeHtml(record.title)}">
  <strong>${escapeHtml(record.title)}</strong>
  <span>${escapeHtml(truncate(record.summary, 110))}</span>
</a>`,
  )
  .join('')}
</div>`
  await writeIndexPage({
    path: 'templates',
    heading: '模板与模块',
    title: '模板与模块',
    description: '所有被镜像的模板和 Lua 模块，包含渲染结果与源代码。',
    active: 'templates',
    content: templatesIndexContent,
  })

  const mediaRecords = images
    .map((image) => ({
      image,
      record: fileRecordForImage(image),
      thumb: localImage(image, 240),
    }))
    .sort((a, b) => a.image.name.localeCompare(b.image.name, 'zh-CN'))
  const mediaIndexContent = `<p class="index-intro">镜像保存了源站 ${formatNumber(images.length)} 个媒体文件（图片、音频与视频）及其页面缩略图，共 ${formatBytes(mediaBytes)}。点击卡片可查看文件信息与下载链接。</p>
<div class="index-toolbar"><input type="search" data-filter="#media-grid" placeholder="筛选媒体文件名…" aria-label="筛选媒体文件名"><span class="index-count">${formatNumber(images.length)} 个文件</span></div>
<div class="media-grid" id="media-grid">
${mediaRecords
  .map(({ image, record, thumb }) => {
    const href = record ? pageUrl(record, config.base) : sourceTitleUrl(`File:${image.name}`)
    const kind = mediaKind(image.mime)
    const visual = thumb
      ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">`
      : MEDIA_ICON[kind]
    return `<a class="media-card" href="${escapeHtml(href)}" data-filter-item data-title="${escapeHtml(image.name)}">
  <span class="media-card__thumb">${visual}</span>
  <span class="media-card__body"><span class="media-card__name">${escapeHtml(image.name)}</span><span class="media-card__meta">${escapeHtml(mediaTypeLabel(image.mime))}${image.width ? ` · ${formatNumber(image.width)}×${formatNumber(image.height)}` : ''} · ${formatBytes(image.size)}</span></span>
</a>`
  })
  .join('')}
</div>`
  await writeIndexPage({
    path: 'media',
    heading: '媒体库',
    title: '媒体库',
    description: '镜像站保存的全部图片、音频与视频文件。',
    active: 'media',
    content: mediaIndexContent,
  })

  const categoryRecords = records
    .filter((record) => record.ns === 14)
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  const categoriesContent = `<p class="index-intro">共 ${formatNumber(categoryRecords.length)} 个分类。成员列表在构建时通过 <code>list=categorymembers</code> 抓取并生成为本地链接。</p>
<div class="card-grid">
${categoryRecords
  .map((record) => {
    const info = categoryInfo.get(record.title)
    const memberCount = (categoryMembers.get(record.title) ?? []).length
    const size = memberCount || info?.size || info?.pages || 0
    return `<a class="card" href="${pageUrl(record, config.base)}">
  <strong>${escapeHtml(record.title)}</strong>
  <span>${formatNumber(size)} 个成员</span>
</a>`
  })
  .join('')}
</div>`
  await writeIndexPage({
    path: 'categories',
    heading: '分类',
    title: '分类',
    description: '按分类浏览镜像内容。',
    active: 'categories',
    content: categoriesContent,
  })

  const mapRecords = records
    .filter((record) => record.kind === 'map')
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  const mapsContent = `<p class="index-intro">共 ${formatNumber(mapRecords.length)} 张互动地图。地图图片与标记坐标均已静态化，可缩放、拖动并按分类筛选。</p>
<div class="map-card-grid">
${mapRecords
  .map((record) => {
    const map = record.map ?? {}
    const image = mapImageFor(map)
    const thumb = image ? media.urlFor(thumbUrlFor(image, 480)) ?? media.urlFor(image.url) : null
    const count = Array.isArray(map.markers) ? map.markers.length : 0
    return `<a class="map-card" href="${pageUrl(record, config.base)}">
  <span class="map-card__preview">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">` : '<span class="map-card__placeholder">地图</span>'}</span>
  <span class="map-card__body"><strong>${escapeHtml(record.title)}</strong><span>${formatNumber(count)} 个标记${map.description ? ` · ${escapeHtml(String(map.description).slice(0, 70))}` : ''}</span></span>
</a>`
  })
  .join('') || '<p class="comments-empty">镜像中暂时没有互动地图。</p>'}
</div>`
  await writeIndexPage({
    path: 'maps',
    heading: '地图',
    title: '地图',
    description: '浏览镜像收录的互动地图。',
    active: 'maps',
    content: mapsContent,
  })

  await writeIndexPage({
    path: 'discussions',
    heading: '讨论版',
    title: '讨论版',
    description: 'Fandom Discussions 静态快照。',
    active: 'discussions',
    content: renderDiscussions(),
  })

  const recentRecords = records
    .filter((record) => record.timestamp)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 150)
  const recentContent = `<p class="index-intro">按源站最后编辑时间排序，展示最近更新的 ${formatNumber(recentRecords.length)} 个页面。</p>
<ul class="recent-list">
${recentRecords
  .map(
    (record) => `<li>
  <a class="recent-list__title" href="${pageUrl(record, config.base)}">${escapeHtml(record.title)}</a>
  <span class="recent-list__meta">${escapeHtml(record.nsName)} · ${escapeHtml(record.user || '未知')} · <time datetime="${escapeHtml(record.timestamp)}">${formatDateTime(record.timestamp)}</time>${record.comment ? ` · ${escapeHtml(record.comment)}` : ''}</span>
</li>`,
  )
  .join('')}
</ul>`
  await writeIndexPage({
    path: 'recent',
    heading: '最近更新',
    title: '最近更新',
    description: '源站最近编辑的页面。',
    active: 'recent',
    content: recentContent,
  })

  const namespaceTable = namespaceGroups
    .map(
      (group) =>
        `<tr><th scope="row">${escapeHtml(group.label)}</th><td>${formatNumber(group.items.length)}</td></tr>`,
    )
    .join('')
  const failureDetails = (data.parseFailures ?? []).length
    ? `<h2>抓取失败的页面</h2><ul>${data.parseFailures
        .map((failure) => `<li>${escapeHtml(failure.title)} — ${escapeHtml(failure.error)}</li>`)
        .join('')}</ul>`
    : ''
  const statisticsContent = `<p class="index-intro">本站由 GitHub Actions 每小时自动抓取、构建并部署。以下数据来自最近一次同步。</p>
<div class="stat-grid">
  <div class="stat-card"><dt>镜像页面</dt><dd>${formatNumber(records.length)}</dd></div>
  <div class="stat-card"><dt>媒体文件</dt><dd>${formatNumber(images.length)}</dd></div>
  <div class="stat-card"><dt>媒体体积</dt><dd>${formatBytes(mediaBytes)}</dd></div>
  <div class="stat-card"><dt>API 请求</dt><dd>${formatNumber(build.requestCount)}</dd></div>
  <div class="stat-card"><dt>构建耗时</dt><dd>${formatDuration(build.durationMs)}</dd></div>
  <div class="stat-card"><dt>失败页面</dt><dd>${formatNumber(build.failedPages)}</dd></div>
</div>
<h2>更新时间</h2>
<p>内容更新时间：<time datetime="${build.finishedAt}">${formatDateTime(build.finishedAt)}</time>（${formatUtc(build.finishedAt)}）</p>
<p>下次自动更新：GitHub Actions 每小时整点运行一次（实际执行时间可能因 GitHub 调度略有延迟）。</p>
<h2>命名空间</h2>
<table class="wikitable"><thead><tr><th>命名空间</th><th>页面数</th></tr></thead><tbody>${namespaceTable}</tbody></table>
<h2>源站统计</h2>
<p>源站共有 ${formatNumber(statistics.articles ?? 0)} 篇条目、${formatNumber(statistics.edits ?? 0)} 次编辑、${formatNumber(statistics.images ?? 0)} 个媒体文件，${formatNumber(statistics.activeusers ?? 0)} 位活跃贡献者。</p>
<h2>媒体缓存</h2>
<p>本次新增下载 ${formatNumber(build.media.downloaded)} 个文件；缓存命中后只同步新增或变更的媒体。媒体下载失败 ${formatNumber(build.media.failed)} 个，页面中会保留原站链接作为回退。</p>
<p>仍指向原站的媒体引用：${formatNumber(build.remoteMedia)} 处。</p>
${failureDetails}
<p><a href="${site.sourceUrl}" target="_blank" rel="noopener noreferrer">查看源站 Special:Statistics</a></p>`
  await writeIndexPage({
    path: 'statistics',
    heading: '同步统计',
    title: '同步统计',
    description: '镜像构建与源站数据统计。',
    active: 'about',
    content: statisticsContent,
  })

  const aboutContent = `<p class="index-intro">这是一个由社区维护的 <strong>来福Simulation Wiki</strong> 静态镜像站，不是 Fandom 官方站点。项目源代码以 GPL v3 许可协议开源，镜像内容依 CC BY-SA 3.0 提供。</p>
<h2>更新方式</h2>
<p>GitHub Actions 在每个整点（<code>0 * * * *</code>，UTC）自动执行以下流程：</p>
<ol>
  <li>通过 MediaWiki API 读取全部镜像命名空间的页面列表与最新修订；</li>
  <li>调用 <code>action=parse</code> 让 MediaWiki 展开模板、解析器函数与页面链接，得到与源站一致的 HTML；</li>
  <li>下载页面引用的全部图片、音频、视频及缩略图，并保存到本站；</li>
  <li>把站内链接改写为本地路径，生成静态 HTML、搜索索引、媒体库与统计数据；</li>
  <li>部署到 GitHub Pages。</li>
</ol>
<p>当前内容更新时间：<time datetime="${build.finishedAt}">${formatDateTime(build.finishedAt)}</time>（${formatUtc(build.finishedAt)}）。</p>
<h2>模板与图片</h2>
<p>模板不是在浏览器里动态加载的：构建时由 MediaWiki 解析器展开后固化为 HTML，因此信息框、导航框、标签页在离线状态下也能正常显示。图片、音频和视频均已下载到本站 <code>media/</code> 目录；源站文件页中的描述、使用情况和下载链接也会一并镜像。</p>
<h2>已知限制</h2>
<ul>
  <li>本站是只读静态镜像，不提供编辑、评论、上传或登录功能。</li>
  <li>依赖实时数据库的特殊页面（如最近更改、链入页面、用户贡献）不会逐页镜像，链接会指向原站。</li>
  <li>动态变量、随机名言等每次解析结果可能不同；镜像保存的是构建时的快照。</li>
  <li>若某个页面或文件在抓取时失败，会显示错误提示或回退到原站链接，并在下一次整点重试。</li>
</ul>
<h2>许可与致谢</h2>
<p>页面文字与媒体文件来自 <a href="${site.sourceUrl}" target="_blank" rel="noopener noreferrer">来福Simulation Wiki</a>，依 <a href="${site.licenseUrl}" target="_blank" rel="noopener noreferrer">${site.license}</a> 许可协议使用。本站不声称拥有这些内容的版权；如需转载，请遵循原站的署名与相同方式共享要求。</p>
<p>项目仓库：<a href="${site.repository}" target="_blank" rel="noopener noreferrer">${site.repository}</a>${build.runUrl ? ` · <a href="${escapeHtml(build.runUrl)}" target="_blank" rel="noopener noreferrer">最近一次构建记录</a>` : ''}</p>`
  await writeIndexPage({
    path: 'about',
    heading: '关于镜像',
    title: '关于镜像',
    description: '镜像站的同步方式、许可协议与已知限制。',
    active: 'about',
    content: aboutContent,
  })

  const searchContent = `<p class="index-intro">搜索标题、摘要与正文。搜索索引在浏览器本地加载，不会向第三方发送查询。</p>
<form class="search-page__form" role="search" data-search-page>
  <label class="sr-only" for="search-page-input">搜索关键词</label>
  <input id="search-page-input" name="q" type="search" placeholder="输入条目、模板或文件名称…" autocomplete="off">
  <button class="button" type="submit">搜索</button>
</form>
<div id="search-page-results" class="search-page__results"><p class="search-results__hint">输入关键词搜索全部页面。</p></div>`
  await writeIndexPage({
    path: 'search',
    heading: '搜索',
    title: '搜索',
    description: '搜索来福Simulation Wiki 镜像站。',
    active: '',
    content: searchContent,
  })

  const pagesForRandom = records.map((record) => ({
    title: record.title,
    url: pageUrl(record, config.base),
    redirect: Boolean(record.isRedirect),
  }))
  const randomContent = `<p class="index-intro">正在从 ${formatNumber(records.length)} 个页面中随机选择…</p>
<p>如果没有自动跳转，请<a href="${config.base}/pages/">浏览全部页面</a>。</p>
<script>
(function(){
  var base = document.documentElement.dataset.base || '';
  fetch(base + '/data/pages.json').then(function(response){ return response.json(); }).then(function(data){
    var pool = data.pages.filter(function(page){ return !page.redirect; });
    if (!pool.length) { location.replace(base + '/pages/'); return; }
    location.replace(pool[Math.floor(Math.random() * pool.length)].url);
  }).catch(function(){ location.replace(base + '/pages/'); });
})();
</script>`
  await writeIndexPage({
    path: 'random',
    heading: '随机页面',
    title: '随机页面',
    description: '随机打开一个镜像页面。',
    active: '',
    content: randomContent,
    headExtra: '<meta name="robots" content="noindex">',
  })

  const notFoundContent = `<p class="index-intro">你访问的页面不在镜像站中。它可能尚未被收录、已被删除，或者链接有误。</p>
<form class="search-page__form" role="search" data-search-page>
  <label class="sr-only" for="search-page-input">搜索关键词</label>
  <input id="search-page-input" name="q" type="search" placeholder="搜索条目、模板或文件名称…" autocomplete="off">
  <button class="button" type="submit">搜索</button>
</form>
<div id="search-page-results" class="search-page__results"><p class="search-results__hint">输入关键词搜索全部页面。</p></div>
<p><a href="${config.base}/">返回首页</a> · <a href="${config.base}/pages/">浏览全部页面</a> · <a href="${site.sourceUrl}" target="_blank" rel="noopener noreferrer">前往原站</a></p>`
  const notFoundHtml = renderDocument({
    config,
    site,
    build,
    counts,
    title: '页面不存在',
    description: '未找到该页面。',
    active: '',
    index: true,
    headingHtml: '页面不存在',
    contentHtml: notFoundContent,
    breadcrumb: '',
    urlPath: null,
    headExtra: '<meta name="robots" content="noindex">',
  })
  await writeFile(join(config.outDir, '404.html'), notFoundHtml)

  // ---------------------------------------------------------------------
  // Search index, page list, site metadata, sitemap, robots
  // ---------------------------------------------------------------------
  const searchEntries = records
    .map((record) => ({
      title: record.title,
      url: pageUrl(record, config.base),
      ns: record.nsName,
      summary: truncate(record.summary || '', 180),
      text: truncate(record.plainText || '', 6000),
      redirect: Boolean(record.isRedirect),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  const previewEntries = records.map((record) => {
    const image = String(record.contentHtml ?? '').match(/<img\b[^>]*\bsrc="([^"]+)"/i)?.[1] ?? ''
    const thumbnail = image.includes('/media/') && record.kind !== 'map' ? image : ''
    return {
      url: pageUrl(record, config.base),
      title: record.title,
      ns: record.nsName,
      summary: truncate(record.summary || '', 220),
      thumbnail,
    }
  })
  await mkdir(join(config.outDir, 'data'), { recursive: true })
  await writeFile(
    join(config.outDir, 'data', 'previews.json'),
    safeJson({ generatedAt: build.finishedAt, entries: previewEntries }),
  )
  await writeFile(
    join(config.outDir, 'data', 'search.json'),
    safeJson({ generatedAt: build.finishedAt, entries: searchEntries }),
  )
  await writeFile(
    join(config.outDir, 'data', 'pages.json'),
    safeJson({ generatedAt: build.finishedAt, pages: pagesForRandom }),
  )
  await writeFile(
    join(config.outDir, 'data', 'site.json'),
    JSON.stringify(
      {
        site,
        build,
        counts,
        statistics,
        namespaces: namespaceGroups.map((group) => ({ id: group.namespace, label: group.label, pages: group.items.length })),
      },
      null,
      2,
    ),
  )

  const encodeUrlPath = (value) =>
    String(value)
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/')
  const sitemapEntries = [
    { loc: `${config.origin}${config.base}/`, lastmod: build.finishedAt.slice(0, 10) },
    ...records.filter((record) => record.urlPath).map((record) => ({
      loc: `${config.origin}${config.base}/${encodeUrlPath(record.urlPath)}/`,
      lastmod: record.timestamp ? record.timestamp.slice(0, 10) : build.finishedAt.slice(0, 10),
    })),
    ...['pages', 'templates', 'media', 'categories', 'maps', 'discussions', 'recent', 'statistics', 'search', 'about'].map((path) => ({
      loc: `${config.origin}${config.base}/${path}/`,
      lastmod: build.finishedAt.slice(0, 10),
    })),
  ]
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries
  .map(
    (entry) => `  <url><loc>${escapeXml(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod></url>`,
  )
  .join('\n')}
</urlset>
`
  await writeFile(join(config.outDir, 'sitemap.xml'), sitemap)
  await writeFile(
    join(config.outDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${config.origin}${config.base}/sitemap.xml\n`,
  )

  // ---------------------------------------------------------------------
  // Media: copy the used subset into dist and prune the cache.
  // ---------------------------------------------------------------------
  const copied = await media.copyTo(config.outDir, usedAssetUrls)
  await media.gc(usedAssetUrls)
  build.media.bytes = copied.bytes
  build.media.assets = copied.files

  logger.info(
    `站点生成完成：${records.length} 页、${images.length} 个媒体文件、${formatBytes(copied.bytes)}，站点媒体引用 ${build.remoteMedia} 处`,
  )

  return { site, build, counts, stats, records, media, searchEntries }
}

function triviaSummary(html) {
  const text = stripTags(html).replace(/\s+/g, ' ').trim()
  if (!text) return '空白页面'
  return truncate(text, 200)
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
