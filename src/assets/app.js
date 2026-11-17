const root = document.documentElement
const base = (root.dataset.base || '').replace(/\/+$/, '')

const absolute = (path) => `${base}/${String(path).replace(/^\/+/, '')}`

function qs(selector, scope = document) {
  return scope.querySelector(selector)
}

function qsa(selector, scope = document) {
  return [...scope.querySelectorAll(selector)]
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case "'": return '&#39;'
      case '"': return '&quot;'
      default: return character
    }
  })

/* --------------------------------------------------------------------------
   Theme
   -------------------------------------------------------------------------- */

function setupTheme() {
  const button = qs('[data-theme-toggle]')
  if (!button) return
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    try {
      localStorage.setItem('wiki-theme', next)
    } catch {
      /* ignore */
    }
    button.setAttribute('aria-label', next === 'dark' ? '切换到浅色主题' : '切换到深色主题')
    window.dispatchEvent(new Event('wiki:theme'))
  })
  button.setAttribute('aria-label', root.dataset.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题')
}

/* --------------------------------------------------------------------------
   Readability for templates with hard-coded light backgrounds
   -------------------------------------------------------------------------- */

function applyInlineSurfaces() {
  const dark = root.dataset.theme === 'dark'
  for (const element of qsa('.wiki-content [style]')) {
    if (element.closest('.portable-infobox')) continue
    if (!/background/i.test(element.getAttribute('style') || '')) continue
    element.classList.remove('inline-light-surface')
    if (!dark) continue
    const background = getComputedStyle(element).backgroundColor
    const match = background.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
    if (!match) continue
    const luminance = (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255
    if (luminance > 0.72) element.classList.add('inline-light-surface')
  }
}

function setupInlineSurfaces() {
  applyInlineSurfaces()
  window.addEventListener('wiki:theme', applyInlineSurfaces)
}

/* --------------------------------------------------------------------------
   Mobile navigation
   -------------------------------------------------------------------------- */

function setupNavigation() {
  const toggle = qs('.menu-toggle')
  const sidebar = qs('#wiki-sidebar')
  if (!toggle || !sidebar) return
  const setOpen = (open) => {
    document.body.classList.toggle('nav-open', open)
    toggle.setAttribute('aria-expanded', String(open))
  }
  toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')))
  document.addEventListener('click', (event) => {
    if (!document.body.classList.contains('nav-open')) return
    if (sidebar.contains(event.target) || toggle.contains(event.target)) return
    setOpen(false)
  })
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false)
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false)
  })
}

/* --------------------------------------------------------------------------
   Search index
   -------------------------------------------------------------------------- */

let searchPromise = null

function loadSearchIndex() {
  if (!searchPromise) {
    searchPromise = fetch(absolute('data/search.json'), { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .catch((error) => {
        searchPromise = null
        throw error
      })
  }
  return searchPromise
}

const normalize = (value) => String(value ?? '').toLocaleLowerCase('zh-CN').normalize('NFC')

function searchEntries(entries, query) {
  const normalized = normalize(query).trim()
  if (!normalized) return []
  const terms = normalized.split(/\s+/).filter(Boolean)
  const scored = []
  for (const entry of entries) {
    const title = normalize(entry.title)
    const summary = normalize(entry.summary)
    const text = normalize(entry.text)
    let score = 0
    if (title === normalized) score += 1000
    else if (title.startsWith(normalized)) score += 500
    else if (title.includes(normalized)) score += 260
    for (const term of terms) {
      if (title.includes(term)) score += 120
      if (summary.includes(term)) score += 26
      if (text.includes(term)) score += 8
    }
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, 'zh-CN'))
  return scored.slice(0, 50).map((item) => item.entry)
}

function renderSearchResults(container, results, query) {
  if (!query.trim()) {
    container.innerHTML = '<p class="search-results__hint">输入关键词开始搜索。</p>'
    return
  }
  if (!results.length) {
    container.innerHTML = `<p class="search-results__empty">未找到与“${escapeHtml(query)}”匹配的页面。</p>`
    return
  }
  container.innerHTML = results
    .map(
      (entry, index) => `<a class="search-result${index === 0 ? ' is-active' : ''}" href="${escapeHtml(entry.url)}" data-search-result>
        <strong>${escapeHtml(entry.title)}<span class="search-result__badge">${escapeHtml(entry.ns)}</span></strong>
        <span>${escapeHtml(entry.summary || '')}</span>
      </a>`,
    )
    .join('')
}

function setupSearchDialog() {
  const dialog = qs('#search-dialog')
  const input = qs('[data-search-input]')
  const results = qs('[data-search-results]')
  if (!dialog || !input || !results) return
  let entries = null
  let activeIndex = -1

  const setActive = (index) => {
    const items = qsa('[data-search-result]', results)
    if (!items.length) return
    activeIndex = (index + items.length) % items.length
    items.forEach((item, itemIndex) => item.classList.toggle('is-active', itemIndex === activeIndex))
    items[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }

  const run = async () => {
    const query = input.value
    results.innerHTML = '<p class="search-results__hint">正在加载搜索索引…</p>'
    try {
      entries = entries ?? (await loadSearchIndex()).entries
      const matches = searchEntries(entries, query)
      renderSearchResults(results, matches, query)
      activeIndex = matches.length ? 0 : -1
    } catch {
      results.innerHTML = '<p class="search-results__empty">搜索索引加载失败，请稍后重试。</p>'
    }
  }

  const open = () => {
    if (!dialog.open) dialog.showModal()
    input.focus()
    if (!entries) run()
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-search-open]')) {
      event.preventDefault()
      open()
    }
    if (event.target.closest('[data-search-close]')) {
      event.preventDefault()
      dialog.close()
    }
  })

  input.addEventListener('input', () => {
    window.clearTimeout(input.__timer)
    input.__timer = window.setTimeout(run, 90)
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(activeIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(activeIndex - 1)
    } else if (event.key === 'Enter') {
      const active = qs('[data-search-result].is-active', results) ?? qs('[data-search-result]', results)
      if (active) {
        event.preventDefault()
        window.location.href = active.getAttribute('href')
      }
    }
  })

  qs('[data-search-form]', dialog)?.addEventListener('submit', (event) => {
    event.preventDefault()
    const active = qs('[data-search-result].is-active', results) ?? qs('[data-search-result]', results)
    if (active) window.location.href = active.getAttribute('href')
  })

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })

  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName?.toLowerCase()
    const typing = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable
    if ((event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) && !typing) {
      event.preventDefault()
      open()
    }
  })
}

/* --------------------------------------------------------------------------
   Index filters
   -------------------------------------------------------------------------- */

function setupFilters() {
  for (const input of qsa('[data-filter]')) {
    const targetSelector = input.getAttribute('data-filter')
    if (!targetSelector) continue
    const target = qs(targetSelector)
    if (!target) continue
    const items = qsa('[data-filter-item]', target)
    const count = input.parentElement?.querySelector('.index-count')
    const original = count?.textContent ?? ''
    const update = () => {
      const query = normalize(input.value).trim()
      let visible = 0
      for (const item of items) {
        const show = !query || normalize(item.getAttribute('data-title')).includes(query)
        item.hidden = !show
        if (show) visible += 1
      }
      if (count) count.textContent = query ? `${visible} / ${items.length}` : original
    }
    input.addEventListener('input', update)
  }
}

/* --------------------------------------------------------------------------
   Search page
   -------------------------------------------------------------------------- */

async function setupSearchPage() {
  const form = qs('[data-search-page]')
  const results = qs('#search-page-results')
  if (!form || !results) return
  const input = qs('input[type="search"]', form)
  let entries = null

  const render = async (query) => {
    results.innerHTML = '<p class="search-results__hint">正在加载搜索索引…</p>'
    try {
      entries = entries ?? (await loadSearchIndex()).entries
      const matches = searchEntries(entries, query)
      if (!query.trim()) {
        results.innerHTML = '<p class="search-results__hint">输入关键词搜索全部页面。</p>'
        return
      }
      if (!matches.length) {
        results.innerHTML = `<p class="search-results__empty">未找到与“${escapeHtml(query)}”匹配的页面。</p>`
        return
      }
      results.innerHTML =
        `<p class="index-count">找到 ${matches.length} 个结果</p>` +
        matches
          .map(
            (entry) => `<a class="search-result" href="${escapeHtml(entry.url)}">
              <strong>${escapeHtml(entry.title)}<span class="search-result__badge">${escapeHtml(entry.ns)}</span></strong>
              <span>${escapeHtml(entry.summary || '')}</span>
            </a>`,
          )
          .join('')
    } catch {
      results.innerHTML = '<p class="search-results__empty">搜索索引加载失败，请稍后重试。</p>'
    }
  }

  const params = new URLSearchParams(window.location.search)
  if (params.get('q')) input.value = params.get('q')
  render(input.value)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const query = input.value.trim()
    const url = new URL(window.location.href)
    if (query) url.searchParams.set('q', query)
    else url.searchParams.delete('q')
    window.history.replaceState(null, '', url)
    render(query)
  })
  input.addEventListener('input', () => {
    window.clearTimeout(input.__timer)
    input.__timer = window.setTimeout(() => render(input.value), 120)
  })
}

/* --------------------------------------------------------------------------
   Tabbers
   -------------------------------------------------------------------------- */

function setupTabbers() {
  for (const tabber of qsa('.tabber')) {
    const tabs = qsa('.wds-tabs__tab', tabber)
    const panels = [...tabber.children].filter((child) => child.classList.contains('wds-tab__content'))
    if (!tabs.length || !panels.length) continue
    const activate = (index) => {
      tabs.forEach((tab, tabIndex) => {
        const current = tabIndex === index
        tab.classList.toggle('wds-is-current', current)
        tab.setAttribute('aria-selected', String(current))
        tab.setAttribute('tabindex', current ? '0' : '-1')
      })
      panels.forEach((panel, panelIndex) => {
        panel.classList.toggle('wds-is-current', panelIndex === index)
        panel.hidden = panelIndex !== index
      })
    }
    tabs.forEach((tab, index) => {
      tab.setAttribute('role', 'tab')
      tab.addEventListener('click', (event) => {
        event.preventDefault()
        activate(index)
      })
      tab.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate(index)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          activate((index + 1) % tabs.length)
          tabs[(index + 1) % tabs.length].focus()
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          activate((index - 1 + tabs.length) % tabs.length)
          tabs[(index - 1 + tabs.length) % tabs.length].focus()
        }
      })
    })
    const initial = Math.max(0, tabs.findIndex((tab) => tab.classList.contains('wds-is-current')))
    activate(initial)
  }
}

/* --------------------------------------------------------------------------
   Collapsible tables/sections
   -------------------------------------------------------------------------- */

function setupCollapsibles() {
  for (const element of qsa('.mw-collapsible')) {
    if (element.dataset.collapsibleReady) continue
    element.dataset.collapsibleReady = '1'
    const collapsed =
      element.classList.contains('mw-collapsed') || element.classList.contains('mw-collapsible-collapsed')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'collapsible-toggle'
    button.setAttribute('aria-expanded', String(!collapsed))
    button.textContent = collapsed ? '展开内容' : '收起内容'
    element.parentNode.insertBefore(button, element)
    const apply = (isCollapsed) => {
      element.classList.toggle('is-collapsed', isCollapsed)
      button.classList.toggle('is-collapsed', isCollapsed)
      button.setAttribute('aria-expanded', String(!isCollapsed))
      button.textContent = isCollapsed ? '展开内容' : '收起内容'
    }
    apply(collapsed)
    button.addEventListener('click', () => apply(!element.classList.contains('is-collapsed')))
  }
}

/* --------------------------------------------------------------------------
   Table overflow wrappers
   -------------------------------------------------------------------------- */

function setupTables() {
  for (const table of qsa('.wiki-content .wikitable, .wiki-content .fandom-table')) {
    if (table.parentElement?.classList.contains('table-scroll')) continue
    const wrapper = document.createElement('div')
    wrapper.className = 'table-scroll'
    table.parentNode.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  }
}

/* --------------------------------------------------------------------------
   Lightbox
   -------------------------------------------------------------------------- */

function setupLightbox() {
  const dialog = qs('#lightbox')
  const image = qs('[data-lightbox-image]', dialog ?? document)
  const caption = qs('[data-lightbox-caption]', dialog ?? document)
  if (!dialog || !image || !caption) return

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-lightbox]')
    if (link) {
      event.preventDefault()
      const innerImage = link.querySelector('img')
      const src = innerImage?.getAttribute('src') || link.getAttribute('href')
      if (!src) return
      image.src = src
      image.alt = innerImage?.getAttribute('alt') || ''
      const text = link.getAttribute('data-caption') || innerImage?.getAttribute('data-caption') || innerImage?.getAttribute('alt') || ''
      const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      caption.innerHTML = `${escapeHtml(plain)}${plain ? ' · ' : ''}<a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">查看原图</a>`
      dialog.showModal()
      return
    }
    if (event.target.closest('[data-lightbox-close]')) {
      event.preventDefault()
      dialog.close()
    }
  })

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
}

/* --------------------------------------------------------------------------
   Table of contents scrollspy
   -------------------------------------------------------------------------- */

function setupTocSpy() {
  const links = qsa('.toc a[href^="#"]')
  if (!links.length) return
  const map = new Map()
  for (const link of links) {
    const id = decodeURIComponent(link.getAttribute('href').slice(1))
    if (id) map.set(id, link)
  }
  const headings = [...document.querySelectorAll('.wiki-content [id]')].filter((heading) =>
    /^H[2-4]$/.test(heading.tagName),
  )
  if (!headings.length) return
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (!visible.length) return
      const id = visible[0].target.id
      links.forEach((link) => link.classList.remove('is-active'))
      map.get(id)?.classList.add('is-active')
    },
    { rootMargin: '-90px 0px -70% 0px', threshold: [0, 1] },
  )
  headings.forEach((heading) => observer.observe(heading))
}

/* --------------------------------------------------------------------------
   Back to top
   -------------------------------------------------------------------------- */

function setupBackToTop() {
  const button = qs('[data-back-to-top]')
  if (!button) return
  const update = () => button.classList.toggle('is-visible', window.scrollY > 640)
  window.addEventListener('scroll', update, { passive: true })
  update()
  button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

/* --------------------------------------------------------------------------
   Misc
   -------------------------------------------------------------------------- */

function setupMisc() {
  // Open external links in a new tab even when the source HTML forgot target.
  for (const link of qsa('.wiki-content a[href^="http"]')) {
    if (link.hostname && link.hostname !== window.location.hostname) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
    }
  }

  // Preserve tabber anchor clicks.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-tab-link]')
    if (link) event.preventDefault()
  })
}

/* --------------------------------------------------------------------------
   Legacy service worker cleanup
   -------------------------------------------------------------------------- */

function setupLegacyServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker
    .getRegistrations()
    .then(async (registrations) => {
      let removed = false
      for (const registration of registrations) {
        const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || ''
        if (scriptUrl.endsWith('/sw.js')) {
          await registration.unregister().catch(() => {})
          removed = true
        }
      }
      if (removed && 'caches' in window) {
        const keys = await caches.keys().catch(() => [])
        await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)))
      }
    })
    .catch(() => {})
}

const start = () => {
  setupTheme()
  setupInlineSurfaces()
  setupNavigation()
  setupSearchDialog()
  setupSearchPage()
  setupTabbers()
  setupCollapsibles()
  setupTables()
  setupFilters()
  setupLightbox()
  setupTocSpy()
  setupBackToTop()
  setupMisc()
  setupLegacyServiceWorker()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
