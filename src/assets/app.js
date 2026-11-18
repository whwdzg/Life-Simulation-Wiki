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
  const systemToggle = qs('[data-theme-system]')
  const themeStatus = qs('[data-theme-status]')
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  let mode = ['system', 'light', 'dark'].includes(root.dataset.themeMode) ? root.dataset.themeMode : 'system'

  const apply = (nextMode, { persist = true } = {}) => {
    mode = nextMode
    const theme = mode === 'system' ? (media?.matches ? 'dark' : 'light') : mode
    root.dataset.themeMode = mode
    root.dataset.theme = theme
    root.classList.toggle('theme-fandomdesktop-dark', theme === 'dark')
    if (systemToggle) systemToggle.checked = mode === 'system'
    if (themeStatus) {
      themeStatus.textContent =
        mode === 'system' ? `跟随系统 · 当前${theme === 'dark' ? '深色' : '浅色'}` : `手动选择 · 当前${theme === 'dark' ? '深色' : '浅色'}`
    }
    if (button) {
      button.setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题')
      button.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'
    }
    if (persist) {
      try {
        localStorage.setItem('wiki-theme-mode', mode)
        if (mode === 'system') localStorage.removeItem('wiki-theme')
        else localStorage.setItem('wiki-theme', mode)
      } catch {
        /* ignore */
      }
    }
    window.dispatchEvent(new Event('wiki:theme'))
  }

  apply(mode, { persist: false })
  try {
    if (!localStorage.getItem('wiki-theme-mode')) localStorage.setItem('wiki-theme-mode', mode)
  } catch {
    /* ignore */
  }

  button?.addEventListener('click', () => {
    apply(root.dataset.theme === 'dark' ? 'light' : 'dark')
  })
  systemToggle?.addEventListener('change', () => {
    apply(systemToggle.checked ? 'system' : root.dataset.theme || 'light')
  })
  if (media) {
    const onChange = () => {
      if (mode === 'system') apply('system', { persist: false })
    }
    if (media.addEventListener) media.addEventListener('change', onChange)
    else media.addListener?.(onChange)
  }
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

function setupStickyTableHeaders() {
  const tables = qsa('.wiki-content .table-scroll > table')
  if (!tables.length) return
  const siteHeader = qs('.site-header')

  for (const table of tables) {
    const wrapper = table.parentElement
    if (!wrapper) continue
    const headerRow = table.tHead?.rows[0] ?? [...table.rows].find((row) => row.cells.length && [...row.cells].some((cell) => cell.tagName === 'TH'))
    if (!headerRow) continue

    const overlay = document.createElement('div')
    overlay.className = 'table-sticky-head'
    overlay.hidden = true
    overlay.setAttribute('aria-hidden', 'true')
    overlay.inert = true
    const clone = document.createElement('table')
    clone.className = table.className
    clone.style.tableLayout = 'fixed'
    clone.style.borderCollapse = 'collapse'
    let queued = false

    const headerBlock = table.tHead ?? headerRow
    const head = table.tHead ? table.tHead.cloneNode(true) : document.createElement('thead')
    if (!table.tHead) head.appendChild(headerRow.cloneNode(true))
    head.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
    head.querySelectorAll('a, button, input, select, textarea').forEach((element) => {
      element.setAttribute('tabindex', '-1')
      if (element.tagName === 'A') element.removeAttribute('href')
    })
    clone.appendChild(head)
    overlay.appendChild(clone)
    document.body.appendChild(overlay)

    const cells = [...head.rows[0].cells]
    const sourceCells = [...headerRow.cells]

    const measure = () => {
      const tableRect = table.getBoundingClientRect()
      clone.style.width = `${tableRect.width}px`
      for (let index = 0; index < cells.length; index += 1) {
        const width = sourceCells[index]?.getBoundingClientRect().width
        if (width) {
          cells[index].style.width = `${width}px`
          cells[index].style.minWidth = `${width}px`
        }
      }
    }

    const position = () => {
      const tableRect = table.getBoundingClientRect()
      const wrapperRect = wrapper.getBoundingClientRect()
      const headerRect = headerBlock.getBoundingClientRect()
      const headerBottom = siteHeader ? Math.max(0, siteHeader.getBoundingClientRect().bottom) : 0
      const stickyTop = headerBottom + 6
      const visible =
        tableRect.height > 0 &&
        headerRect.height > 0 &&
        tableRect.top < stickyTop &&
        tableRect.bottom > stickyTop + headerRect.height + 12
      if (!visible) {
        overlay.hidden = true
        return
      }
      clone.style.width = `${tableRect.width}px`
      overlay.hidden = false
      overlay.style.left = `${wrapperRect.left}px`
      overlay.style.top = `${stickyTop}px`
      overlay.style.width = `${wrapperRect.width}px`
      clone.style.transform = `translateX(${-wrapper.scrollLeft}px)`
    }

    const update = () => {
      if (queued) return
      queued = true
      window.requestAnimationFrame(() => {
        queued = false
        position()
      })
    }

    measure()
    position()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', () => {
      measure()
      update()
    })
    wrapper.addEventListener('scroll', update, { passive: true })
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => {
        measure()
        update()
      })
      observer.observe(table)
      observer.observe(wrapper)
    }
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
  const links = qsa('.page-toc a[href^="#"]')
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

let deferredInstallPrompt = null
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event
  document.dispatchEvent(new CustomEvent('pwa-install-ready'))
})

function setupPWA() {
  const card = qs('[data-pwa-card]')
  if (!card) return
  const button = qs('[data-pwa-install]', card)
  const status = qs('[data-pwa-status]', card)
  const help = qs('[data-pwa-help]', card)
  if (!button || !status) return

  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches === true || window.navigator.standalone === true
  const isIOS =
    /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  let dismissed = false

  const setState = (label, message, disabled = false) => {
    button.textContent = label
    button.disabled = disabled
    status.textContent = message
  }

  const update = () => {
    if (standalone) {
      setState('已安装', '当前正以独立应用模式运行，可从桌面或主屏幕直接打开。', true)
      return
    }
    if (deferredInstallPrompt) {
      setState('安装到设备', '浏览器已准备好安装，点击按钮即可添加到桌面或主屏幕。', false)
      return
    }
    if (isIOS) {
      setState('查看安装方法', 'iPhone / iPad：在 Safari 中点击分享按钮 → “添加到主屏幕”。', false)
      return
    }
    if (dismissed) {
      setState('查看安装方法', '安装已取消。可稍后从浏览器菜单选择“安装应用”。', false)
      return
    }
    setState('查看安装方法', '在浏览器菜单中选择“安装应用”或“添加到主屏幕”；地址栏出现安装图标时也可直接点击。', false)
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    navigator.serviceWorker.register(absolute('sw.js'), { scope: `${base}/` }).catch(() => {})
  }

  button.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      const prompt = deferredInstallPrompt
      deferredInstallPrompt = null
      button.disabled = true
      status.textContent = '正在打开安装窗口…'
      try {
        await prompt.prompt()
        const choice = await prompt.userChoice
        if (choice.outcome === 'accepted') {
          setState('正在安装…', '已接受安装请求，请等待浏览器完成安装。', true)
        } else {
          dismissed = true
          update()
        }
      } catch {
        dismissed = true
        update()
      }
      return
    }
    if (help) {
      help.open = true
      help.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  })

  document.addEventListener('pwa-install-ready', update)
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    setState('已安装', '安装成功，可以从桌面或主屏幕启动镜像。', true)
  })
  update()
  window.setTimeout(update, 3000)
}

/* --------------------------------------------------------------------------
   Interactive maps
   -------------------------------------------------------------------------- */

function setupMaps() {
  for (const root of qsa('[data-map]')) {
    const viewport = qs('[data-map-viewport]', root)
    const canvas = qs('[data-map-canvas]', root)
    if (!viewport || !canvas) continue
    const markers = qsa('[data-map-marker]', root)
    const filters = qsa('[data-map-filter]', root)
    const info = qs('[data-map-info]', root)
    const zoomLabel = qs('[data-map-zoom-label]', root)
    let scale = 1
    let offsetX = 0
    let offsetY = 0
    let pointerId = null
    let startX = 0
    let startY = 0
    let startOffsetX = 0
    let startOffsetY = 0

    const clamp = () => {
      const minX = viewport.clientWidth * (1 - scale)
      const minY = viewport.clientHeight * (1 - scale)
      offsetX = Math.min(0, Math.max(minX, offsetX))
      offsetY = Math.min(0, Math.max(minY, offsetY))
    }

    const apply = () => {
      canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
      if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`
    }

    const setScale = (value, centerX, centerY) => {
      const next = Math.min(6, Math.max(1, value))
      if (next === scale) return
      const px = centerX ?? viewport.clientWidth / 2
      const py = centerY ?? viewport.clientHeight / 2
      offsetX = px - (px - offsetX) * (next / scale)
      offsetY = py - (py - offsetY) * (next / scale)
      scale = next
      clamp()
      apply()
    }

    const reset = () => {
      scale = 1
      offsetX = 0
      offsetY = 0
      apply()
    }

    const selectMarker = (index, focus = false) => {
      const marker = markers.find((item) => item.dataset.index === String(index))
      if (!marker) return
      for (const item of markers) item.classList.toggle('is-active', item === marker)
      if (!info) return
      info.replaceChildren()
      const heading = document.createElement('h3')
      heading.textContent = marker.dataset.title || '标记'
      info.appendChild(heading)
      if (marker.dataset.description) {
        const description = document.createElement('p')
        description.textContent = marker.dataset.description
        info.appendChild(description)
      }
      if (marker.dataset.link) {
        const link = document.createElement('a')
        link.href = marker.dataset.link
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = marker.dataset.linkLabel || '查看相关页面'
        info.appendChild(link)
      }
      if (focus) viewport.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    viewport.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        const rect = viewport.getBoundingClientRect()
        setScale(scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX - rect.left, event.clientY - rect.top)
      },
      { passive: false },
    )

    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || scale <= 1) return
      pointerId = event.pointerId
      startX = event.clientX
      startY = event.clientY
      startOffsetX = offsetX
      startOffsetY = offsetY
      viewport.setPointerCapture(pointerId)
      viewport.classList.add('is-dragging')
    })

    viewport.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return
      offsetX = startOffsetX + (event.clientX - startX)
      offsetY = startOffsetY + (event.clientY - startY)
      clamp()
      apply()
    })

    const endDrag = (event) => {
      if (pointerId !== event.pointerId) return
      pointerId = null
      viewport.classList.remove('is-dragging')
    }
    viewport.addEventListener('pointerup', endDrag)
    viewport.addEventListener('pointercancel', endDrag)

    qs('[data-map-zoom-in]', root)?.addEventListener('click', () => setScale(scale * 1.4))
    qs('[data-map-zoom-out]', root)?.addEventListener('click', () => setScale(scale / 1.4))
    qs('[data-map-reset]', root)?.addEventListener('click', reset)

    for (const filter of filters) {
      filter.addEventListener('click', () => {
        const value = filter.dataset.mapFilter
        for (const item of filters) item.classList.toggle('is-active', item === filter)
        for (const marker of markers) {
          marker.classList.toggle('is-hidden', value !== 'all' && marker.dataset.category !== value)
        }
      })
    }

    for (const marker of markers) {
      marker.addEventListener('click', () => selectMarker(marker.dataset.index))
    }
    for (const item of qsa('[data-marker-target]', root)) {
      item.addEventListener('click', () => selectMarker(item.dataset.markerTarget, true))
    }

    apply()
  }
}

/* --------------------------------------------------------------------------
   Discussion board filters
   -------------------------------------------------------------------------- */

function setupDiscussions() {
  const filters = qsa('[data-discussion-filter]')
  if (!filters.length) return
  const threads = qsa('[data-discussion-thread]')
  for (const filter of filters) {
    filter.addEventListener('click', () => {
      const value = filter.dataset.discussionFilter
      for (const item of filters) item.classList.toggle('is-active', item === filter)
      for (const thread of threads) {
        thread.classList.toggle('is-hidden', value !== 'all' && thread.dataset.forum !== value)
      }
    })
  }
}

/* --------------------------------------------------------------------------
   Internal link previews
   -------------------------------------------------------------------------- */

function setupLinkPreviews() {
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches) return
  const links = qsa('.wiki-content a[href]').filter((link) => {
    if (link.hasAttribute('data-lightbox') || link.hasAttribute('data-tab-link')) return false
    if (link.target === '_blank') return false
    try {
      return new URL(link.href, window.location.href).origin === window.location.origin
    } catch {
      return false
    }
  })
  if (!links.length) return

  const card = document.createElement('a')
  card.className = 'link-preview'
  card.hidden = true
  card.setAttribute('role', 'tooltip')
  document.body.appendChild(card)

  let previewPromise = null
  let previewIndex = null
  let showTimer = null
  let hideTimer = null
  let activeLink = null
  let showToken = 0

  const pathOf = (href) => {
    try {
      return new URL(href, window.location.href).pathname
    } catch {
      return ''
    }
  }

  const loadIndex = () => {
    if (!previewPromise) {
      previewPromise = fetch(absolute('data/previews.json'), { credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json()
        })
        .then((data) => {
          previewIndex = new Map((data.entries ?? []).map((entry) => [pathOf(entry.url), entry]))
          return previewIndex
        })
        .catch((error) => {
          previewPromise = null
          throw error
        })
    }
    return previewPromise
  }

  const hide = () => {
    showToken += 1
    window.clearTimeout(showTimer)
    window.clearTimeout(hideTimer)
    activeLink?.classList.remove('is-previewing')
    activeLink = null
    card.hidden = true
    card.removeAttribute('href')
  }

  const scheduleHide = () => {
    window.clearTimeout(showTimer)
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(hide, 180)
  }

  const position = (link) => {
    card.style.left = '0px'
    card.style.top = '0px'
    card.hidden = false
    const linkRect = link.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const gap = 10
    const above = linkRect.top - cardRect.height - gap >= 8
    const preferredTop = above ? linkRect.top - cardRect.height - gap : linkRect.bottom + gap
    const top = Math.max(8, Math.min(window.innerHeight - cardRect.height - 8, preferredTop))
    const left = Math.max(10, Math.min(window.innerWidth - cardRect.width - 10, linkRect.left))
    card.style.top = `${top}px`
    card.style.left = `${left}px`
    card.dataset.position = above ? 'above' : 'below'
    const arrow = Math.min(cardRect.width - 24, Math.max(24, linkRect.left + linkRect.width / 2 - left))
    card.style.setProperty('--arrow-left', `${arrow}px`)
  }

  const show = async (link) => {
    window.clearTimeout(hideTimer)
    const token = ++showToken
    const path = pathOf(link.href)
    if (!path || path === window.location.pathname) return
    try {
      const index = await loadIndex()
      if (token !== showToken) return
      const entry = index.get(path)
      if (!entry) return
      activeLink?.classList.remove('is-previewing')
      activeLink = link
      link.classList.add('is-previewing')
      card.replaceChildren()
      card.href = link.getAttribute('href')
      if (entry.thumbnail) {
        const image = document.createElement('img')
        image.className = 'link-preview__thumb'
        image.src = entry.thumbnail
        image.alt = ''
        image.loading = 'lazy'
        card.appendChild(image)
      }
      const body = document.createElement('span')
      body.className = 'link-preview__body'
      const meta = document.createElement('span')
      meta.className = 'link-preview__meta'
      meta.textContent = entry.ns || '页面'
      const title = document.createElement('strong')
      title.className = 'link-preview__title'
      title.textContent = entry.title
      const summary = document.createElement('span')
      summary.className = 'link-preview__summary'
      summary.textContent = entry.summary || '此页面暂无摘要。'
      const hint = document.createElement('span')
      hint.className = 'link-preview__hint'
      hint.textContent = '点击打开页面'
      body.append(meta, title, summary, hint)
      card.appendChild(body)
      position(link)
    } catch {
      hide()
    }
  }

  for (const link of links) {
    link.addEventListener('mouseenter', () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
      showTimer = window.setTimeout(() => show(link), 320)
    })
    link.addEventListener('mouseleave', scheduleHide)
    link.addEventListener('focus', () => show(link))
    link.addEventListener('blur', scheduleHide)
  }

  card.addEventListener('mouseenter', () => {
    window.clearTimeout(hideTimer)
    window.clearTimeout(showTimer)
  })
  card.addEventListener('mouseleave', scheduleHide)
  window.addEventListener('scroll', hide, { passive: true, capture: true })
  window.addEventListener('resize', hide)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide()
  })
}

/* --------------------------------------------------------------------------
   Revision history and line diffs
   -------------------------------------------------------------------------- */

function setupHistory() {
  const dataElement = document.getElementById('history-data')
  if (!dataElement) return
  let payload
  try {
    payload = JSON.parse(dataElement.textContent || '{}')
  } catch {
    return
  }
  const revisions = payload.revisions ?? []
  if (!revisions.length) return
  const byId = new Map(revisions.map((revision) => [String(revision.revid), revision]))
  const list = qs('[data-history-list]')
  const diffPanel = qs('[data-history-diff]')
  const diffHead = qs('[data-history-head]')
  const status = qs('[data-history-status]')
  const compareButton = qs('[data-history-compare]')
  const sourceCode = qs('[data-history-source-code]')
  const sourceBox = sourceCode?.closest('details')
  if (!list || !diffPanel || !diffHead || !status || !compareButton) return

  const checkboxes = qsa('input[type="checkbox"]', list)
  const selected = new Set()

  const dateText = (value) => {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }

  const updateSelection = () => {
    status.textContent = `已选 ${selected.size}/2 个版本`
    compareButton.disabled = selected.size !== 2
  }

  const diffLines = (oldText, newText) => {
    const oldLines = String(oldText ?? '').split('\n')
    const newLines = String(newText ?? '').split('\n')
    const n = oldLines.length
    const m = newLines.length
    if (n * m > 2_000_000) {
      return [
        ...oldLines.map((line, index) => ({ type: 'del', line, oldNo: index + 1 })),
        ...newLines.map((line, index) => ({ type: 'add', line, newNo: index + 1 })),
      ]
    }
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    const ops = []
    let i = 0
    let j = 0
    let oldNo = 1
    let newNo = 1
    while (i < n && j < m) {
      if (oldLines[i] === newLines[j]) {
        ops.push({ type: 'context', line: oldLines[i], oldNo, newNo })
        i += 1
        j += 1
        oldNo += 1
        newNo += 1
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: 'del', line: oldLines[i], oldNo })
        i += 1
        oldNo += 1
      } else {
        ops.push({ type: 'add', line: newLines[j], newNo })
        j += 1
        newNo += 1
      }
    }
    while (i < n) {
      ops.push({ type: 'del', line: oldLines[i], oldNo })
      i += 1
      oldNo += 1
    }
    while (j < m) {
      ops.push({ type: 'add', line: newLines[j], newNo })
      j += 1
      newNo += 1
    }
    return ops
  }

  const renderDiff = () => {
    if (selected.size !== 2) return
    const chosen = [...selected]
      .map((revid) => byId.get(revid))
      .filter(Boolean)
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    if (chosen.length !== 2) return
    const [oldRevision, newRevision] = chosen
    diffHead.textContent = `r${oldRevision.revid}（${dateText(oldRevision.timestamp)}） → r${newRevision.revid}（${dateText(newRevision.timestamp)}）`
    const ops = diffLines(oldRevision.content, newRevision.content)
    if (!ops.length) {
      diffPanel.innerHTML = '<p class="comments-empty">两个版本内容相同。</p>'
      return
    }
    const rows = ops
      .map((op) => {
        const marker = op.type === 'add' ? '+' : op.type === 'del' ? '−' : ''
        return `<tr class="diff-${op.type}"><td class="diff-line-no">${op.oldNo ?? ''}</td><td class="diff-line-no">${op.newNo ?? ''}</td><td class="diff-marker">${marker}</td><td>${escapeHtml(op.line)}</td></tr>`
      })
      .join('')
    diffPanel.innerHTML = `<table class="diff-table"><thead><tr><th class="diff-line-no">旧</th><th class="diff-line-no">新</th><th class="diff-marker"></th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    if (sourceCode) sourceCode.textContent = newRevision.content || '（空内容）'
  }

  for (const checkbox of checkboxes) {
    if (selected.size < 2) {
      checkbox.checked = true
      selected.add(checkbox.value)
    }
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        if (selected.size >= 2) {
          const [oldest] = selected
          selected.delete(oldest)
          const oldCheckbox = checkboxes.find((item) => item.value === oldest)
          if (oldCheckbox) oldCheckbox.checked = false
        }
        selected.add(checkbox.value)
      } else {
        selected.delete(checkbox.value)
      }
      updateSelection()
      if (selected.size === 2) {
        renderDiff()
      } else {
        diffHead.textContent = '请选择两个版本'
        diffPanel.innerHTML = '<p class="comments-empty">请勾选两个版本进行对比。</p>'
      }
    })
  }
  updateSelection()
  if (selected.size === 2) renderDiff()
  else diffPanel.innerHTML = '<p class="comments-empty">请勾选两个版本进行对比。</p>'

  compareButton.addEventListener('click', renderDiff)
  for (const button of qsa('[data-history-source]', list)) {
    button.addEventListener('click', () => {
      const revision = byId.get(String(button.dataset.historySource))
      if (!revision || !sourceCode) return
      sourceCode.textContent = revision.content || '（空内容）'
      if (sourceBox) sourceBox.open = true
    })
  }
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
  setupStickyTableHeaders()
  setupFilters()
  setupLightbox()
  setupTocSpy()
  setupBackToTop()
  setupMisc()
  setupMaps()
  setupDiscussions()
  setupLinkPreviews()
  setupHistory()
  setupPWA()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
