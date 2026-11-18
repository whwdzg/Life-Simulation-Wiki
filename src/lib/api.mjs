import { setTimeout as delay } from 'node:timers/promises'

export class ApiError extends Error {
  constructor(message, { code = '', status = 0 } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

const RETRYABLE_CODES = new Set(['maxlag', 'ratelimited', 'readonly', 'internal_api_error_DBQueryError'])

function retryAfterMs(response) {
  const header = response.headers.get('retry-after')
  if (!header) return 0
  const seconds = Number.parseFloat(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

/** Minimal MediaWiki action API client with retries and POST fallback. */
export class WikiApi {
  constructor({ apiUrl, userAgent, logger = console }) {
    this.apiUrl = apiUrl
    this.userAgent = userAgent
    this.logger = logger
    this.requestCount = 0
  }

  async request(parameters, { method, attempts = 6, timeout = 60_000 } = {}) {
    const params = {
      format: 'json',
      formatversion: '2',
      utf8: '1',
      ...parameters,
    }
    let body = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      body.set(key, String(value))
    }
    const usePost = method === 'POST' || body.toString().length > 6_000
    let lastError
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const url = new URL(this.apiUrl)
      if (!usePost) url.search = body.toString()
      try {
        this.requestCount += 1
        const response = await fetch(usePost ? this.apiUrl : url, {
          method: usePost ? 'POST' : 'GET',
          headers: {
            'user-agent': this.userAgent,
            accept: 'application/json',
            ...(usePost ? { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' } : {}),
          },
          body: usePost ? body : undefined,
          signal: AbortSignal.timeout(timeout),
        })
        if (response.status === 429 || response.status >= 500) {
          lastError = new ApiError(`HTTP ${response.status} ${response.statusText}`, { status: response.status })
          const wait = retryAfterMs(response) || Math.min(30_000, 1_000 * 2 ** attempt)
          await delay(wait + Math.random() * 400)
          continue
        }
        if (!response.ok) {
          throw new ApiError(`HTTP ${response.status} ${response.statusText}`, { status: response.status })
        }
        const data = await response.json()
        if (data?.error) {
          const code = data.error.code || ''
          if (RETRYABLE_CODES.has(code) && attempt + 1 < attempts) {
            lastError = new ApiError(data.error.info || code, { code, status: 200 })
            await delay(Math.min(30_000, 1_500 * 2 ** attempt) + Math.random() * 500)
            continue
          }
          throw new ApiError(data.error.info || code || 'MediaWiki API error', { code, status: 200 })
        }
        return data
      } catch (error) {
        lastError = error
        const fatal =
          error instanceof ApiError &&
          (error.code === 'missingtitle' ||
            (error.status >= 400 && error.status < 500 && error.status !== 429))
        if (fatal || attempt + 1 >= attempts) break
        const wait = Math.min(30_000, 1_000 * 2 ** attempt)
        this.logger.warn?.(`API request failed (${error.message}); retrying in ${Math.round(wait / 1000)}s`)
        await delay(wait + Math.random() * 400)
      }
    }
    throw lastError instanceof Error ? lastError : new ApiError(String(lastError))
  }

  async siteInfo() {
    const data = await this.request({
      action: 'query',
      meta: 'siteinfo',
      siprop: 'general|statistics|namespaces|namespacealiases|rightsinfo',
    })
    return data.query
  }

  async allPages(namespace) {
    const pages = []
    let continuation = {}
    do {
      const data = await this.request({
        action: 'query',
        list: 'allpages',
        apnamespace: namespace,
        aplimit: 'max',
        ...continuation,
      })
      pages.push(...(data.query?.allpages ?? []))
      continuation = data.continue ?? null
    } while (continuation)
    return pages
  }

  /**
   * Fetch latest revision metadata and wikitext for up to 500 titles.
   * Batches at 50 titles to keep request URLs/body sizes modest.
   */
  async revisions(titles, { batchSize = 40 } = {}) {
    const result = new Map()
    for (let index = 0; index < titles.length; index += batchSize) {
      const batch = titles.slice(index, index + batchSize)
      let continuation = {}
      do {
        const data = await this.request(
          {
            action: 'query',
            prop: 'revisions',
            rvprop: 'ids|timestamp|user|comment|content|size',
            rvslots: 'main',
            titles: batch.join('|'),
            ...continuation,
          },
          { method: 'POST' },
        )
        for (const page of data.query?.pages ?? []) {
          const revision = page.revisions?.[0]
          if (!revision) {
            result.set(page.title, { missing: true })
            continue
          }
          result.set(page.title, {
            revid: revision.revid,
            parentid: revision.parentid,
            timestamp: revision.timestamp,
            user: revision.user ?? '',
            comment: revision.comment ?? '',
            size: revision.size ?? 0,
            content: revision.slots?.main?.content ?? '',
            contentModel: revision.slots?.main?.contentmodel ?? '',
            missing: false,
          })
        }
        continuation = data.continue ?? null
      } while (continuation)
    }
    return result
  }

  async pageContent(title) {
    const data = await this.request({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content|timestamp',
      rvslots: 'main',
      titles: title,
      redirects: '0',
    })
    const page = data.query?.pages?.[0]
    const revision = page?.revisions?.[0]
    return {
      missing: Boolean(page?.missing) || !revision,
      content: revision?.slots?.main?.content ?? '',
      timestamp: revision?.timestamp ?? '',
    }
  }

  async parse(title) {
    const data = await this.request({
      action: 'parse',
      page: title,
      prop: 'text|sections|displaytitle|revid|images|templates|properties',
      disableeditsection: '1',
      disablelimitreport: '1',
      disabletoc: '1',
      redirects: '0',
    })
    return data.parse
  }

  async allImages() {
    const images = []
    let continuation = {}
    do {
      const data = await this.request({
        action: 'query',
        list: 'allimages',
        aiprop: 'url|size|mime|dimensions|timestamp|user|sha1',
        ailimit: 'max',
        ...continuation,
      })
      images.push(...(data.query?.allimages ?? []))
      continuation = data.continue ?? null
    } while (continuation)
    return images
  }

  async fileUsage(titles, { batchSize = 40 } = {}) {
    const usage = new Map()
    for (let index = 0; index < titles.length; index += batchSize) {
      const batch = titles.slice(index, index + batchSize)
      let continuation = {}
      do {
        const data = await this.request({
          action: 'query',
          prop: 'fileusage',
          fuprop: 'title|pageid|redirect',
          fulimit: 'max',
          titles: batch.join('|'),
          ...continuation,
        })
        for (const page of data.query?.pages ?? []) {
          usage.set(page.title, page.fileusage ?? [])
        }
        continuation = data.continue ?? null
      } while (continuation)
    }
    return usage
  }

  async categoryInfo(titles, { batchSize = 40 } = {}) {
    const info = new Map()
    for (let index = 0; index < titles.length; index += batchSize) {
      const batch = titles.slice(index, index + batchSize)
      const data = await this.request({
        action: 'query',
        prop: 'categoryinfo',
        titles: batch.join('|'),
      })
      for (const page of data.query?.pages ?? []) {
        info.set(page.title, page.categoryinfo ?? null)
      }
    }
    return info
  }

  async categoryMembers(titles) {
    const members = new Map()
    for (const title of titles) {
      const items = []
      let continuation = {}
      do {
        const data = await this.request({
          action: 'query',
          list: 'categorymembers',
          cmtitle: title,
          cmprop: 'ids|title|type|timestamp',
          cmtype: 'page|subcat|file',
          cmlimit: 'max',
          ...continuation,
        })
        items.push(...(data.query?.categorymembers ?? []))
        continuation = data.continue ?? null
      } while (continuation)
      members.set(title, items)
    }
    return members
  }

  async recentChanges(limit = 50) {
    const data = await this.request({
      action: 'query',
      list: 'recentchanges',
      rclimit: limit,
      rcprop: 'title|timestamp|user|comment|ids|sizes',
      rctype: 'edit|new',
      rcdir: 'older',
    })
    return data.query?.recentchanges ?? []
  }
}
