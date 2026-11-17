import { WikiApi } from './api.mjs'
import { namespaceLabel } from './config.mjs'
import { canonicalTitle, normalizeTitle, titleKey } from './paths.mjs'
import { createLogger, formatDuration, mapConcurrent } from './util.mjs'

const REDIRECT_RE =
  /^\s*#(?:redirect|重定向|重新導向)\s*:?\s*\[\[\s*([^\]|#]+?)\s*(?:#\s*([^\]|]+?))?\s*(?:\|[^\]]*)?\]\]/i

export function parseRedirect(wikitext) {
  const match = REDIRECT_RE.exec(String(wikitext ?? ''))
  if (!match) return null
  return {
    target: normalizeTitle(match[1]),
    anchor: match[2] ? normalizeTitle(match[2]) : '',
  }
}

export async function collectWiki(config, { logger = createLogger('collect') } = {}) {
  const api = new WikiApi({
    apiUrl: config.apiUrl,
    userAgent: config.userAgent,
    logger,
  })

  logger.info(`读取站点信息：${config.apiUrl}`)
  const siteinfo = await api.siteInfo()
  if (!siteinfo?.general) throw new Error('无法读取 MediaWiki siteinfo')
  const projectNamespace = siteinfo.namespaces?.[4]?.name || 'Project'
  const projectName = projectNamespace === 'Project' ? '来福Simulation Wiki' : projectNamespace

  logger.info('读取页面列表…')
  const pageLists = []
  for (const namespace of config.namespaces) {
    const list = await api.allPages(namespace)
    pageLists.push(...list)
    logger.info(`  命名空间 ${namespace} (${namespaceLabel(namespace)}): ${list.length} 页`)
  }

  let pageEntries = pageLists.map((page) => ({
    title: normalizeTitle(page.title),
    ns: page.ns,
    nsName: namespaceLabel(page.ns),
    pageid: page.pageid,
    key: titleKey(page.title, { projectName }),
  }))

  const seen = new Set()
  pageEntries = pageEntries.filter((page) => {
    if (seen.has(page.key)) return false
    seen.add(page.key)
    return true
  })

  if (config.pageLimit > 0 && pageEntries.length > config.pageLimit) {
    logger.warn(`PAGE_LIMIT=${config.pageLimit}，仅抓取前 ${config.pageLimit} 页（开发模式）`)
    pageEntries = pageEntries.slice(0, config.pageLimit)
  }

  logger.info(`读取 ${pageEntries.length} 页的修订与维基文本…`)
  const revisionMap = await api.revisions(pageEntries.map((page) => page.title))
  for (const page of pageEntries) {
    const revision = revisionMap.get(page.title)
    if (!revision || revision.missing) {
      page.missing = true
      page.wikitext = ''
      page.revid = 0
      page.timestamp = ''
      page.user = ''
      page.comment = ''
      continue
    }
    page.revid = revision.revid
    page.timestamp = revision.timestamp
    page.user = revision.user
    page.comment = revision.comment
    page.size = revision.size
    page.contentModel = revision.contentModel
    page.wikitext = revision.content
  }

  let redirectCount = 0
  for (const page of pageEntries) {
    const redirect = parseRedirect(page.wikitext)
    if (redirect) {
      page.isRedirect = true
      page.redirectTarget = redirect.target
      page.redirectAnchor = redirect.anchor
      redirectCount += 1
    }
  }
  logger.info(`发现 ${redirectCount} 个重定向页面`)

  const parseTargets = pageEntries.filter((page) => {
    if (page.missing || page.isRedirect) return false
    if (page.ns === 6 && !page.wikitext.trim()) return false
    return true
  })
  logger.info(`渲染 ${parseTargets.length} 页（模板已由 MediaWiki 展开）…`)

  let completed = 0
  const parseStarted = Date.now()
  const failures = []
  await mapConcurrent(parseTargets, config.concurrency, async (page) => {
    try {
      const parsed = await api.parse(page.title)
      page.html = parsed?.text ?? ''
      page.sections = (parsed?.sections ?? []).map((section) => ({
        anchor: section.anchor,
        line: section.line ?? '',
        level: Number(section.level) || 2,
      }))
      page.displayTitle = parsed?.displaytitle ?? ''
      page.imagesUsed = parsed?.images ?? []
      page.templatesUsed = (parsed?.templates ?? []).map((template) => template.title ?? template)
      page.revid = parsed?.revid ?? page.revid
    } catch (error) {
      page.parseError = error.message
      failures.push({ title: page.title, error: error.message })
      logger.warn(`渲染失败：${page.title} — ${error.message}`)
    } finally {
      completed += 1
      if (completed % 25 === 0 || completed === parseTargets.length) {
        logger.info(`  已渲染 ${completed}/${parseTargets.length}`)
      }
    }
  })
  logger.info(`页面渲染完成，用时 ${formatDuration(Date.now() - parseStarted)}，失败 ${failures.length} 页`)

  logger.info('读取媒体文件清单…')
  const images = await api.allImages()
  logger.info(`  媒体文件 ${images.length} 个`)

  const filePages = pageEntries.filter((page) => page.ns === 6)
  let fileUsage = new Map()
  if (filePages.length) {
    logger.info(`读取 ${filePages.length} 个文件页面的使用情况…`)
    fileUsage = await api.fileUsage(filePages.map((page) => page.title))
  }

  const categoryPages = pageEntries.filter((page) => page.ns === 14)
  let categoryInfo = new Map()
  if (categoryPages.length) {
    categoryInfo = await api.categoryInfo(categoryPages.map((page) => page.title))
  }

  logger.info('读取站点自定义 CSS…')
  const customStyles = []
  for (const title of ['MediaWiki:Common.css', 'MediaWiki:Wikia.css', 'MediaWiki:Mobile.css']) {
    try {
      const style = await api.pageContent(title)
      if (style.content.trim()) {
        customStyles.push({ title, content: style.content })
        logger.info(`  ${title}：${style.content.length} 字节`)
      }
    } catch (error) {
      logger.warn(`读取 ${title} 失败：${error.message}`)
    }
  }

  const mainPage = siteinfo.general.mainpage
  return {
    api,
    siteinfo,
    statistics: siteinfo.statistics ?? {},
    projectName,
    mainPage,
    pages: pageEntries,
    images,
    fileUsage,
    categoryInfo,
    customStyles,
    parseFailures: failures,
    requestCount: api.requestCount,
    collectedAt: new Date().toISOString(),
  }
}

export { canonicalTitle, titleKey }
