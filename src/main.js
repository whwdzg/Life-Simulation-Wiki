import './style.css'

window.__lifeSimulationWikiStarted = true

const baseUrl = import.meta.env.BASE_URL
const indexUrl = `${baseUrl}wiki-data/index.json`
const pageUrl = (slug) => `${baseUrl}wiki-data/pages/${slug}.json`
const statusUrl = `${baseUrl}wiki-data/sync-status.json`
const app = document.querySelector('#app')
const fallbackTheme = {
  background: 'https://static.wikia.nocookie.net/lifesimulation/images/b/b5/Site-background-light/revision/latest?cb=20251002115419&path-prefix=zh',
  icon: 'https://static.wikia.nocookie.net/lifesimulation/images/e/e6/Site-logo.png/revision/latest?cb=20251002013153&path-prefix=zh',
}

const escapeHtml = (value) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const routeFor = (slug) => `#/wiki/${slug}`

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, { cache: 'force-cache', ...options })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

const applyTheme = (site = {}) => {
  const theme = { background: site.background || fallbackTheme.background, icon: site.icon || fallbackTheme.icon }
  document.documentElement.style.setProperty('--wiki-background', `url("${new URL(theme.background, window.location.href).href}")`)
  document.querySelector('#site-favicon').href = new URL(theme.icon, window.location.href).href
  return theme
}

const renderLoading = (title = '正在加载页面', message = '正在获取 Wiki 内容，请稍候。') => {
  app.innerHTML = `<main class="load-state loading-state" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><h1>${title}</h1><p>${message}</p></main>`
}

const renderFailure = (message) => {
  app.innerHTML = `<main class="load-state"><h1>来福Simulation Wiki（镜像站）</h1><p>${message}</p><p>请稍后刷新页面重试。</p></main>`
}

const formatTime = (value) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(new Date(value)) : '尚未完成首次抓取'

const syncPanel = (sync = {}) => {
  const articles = sync.articles ?? { completed: 0, total: 0 }
  const media = sync.media ?? { completed: 0, total: 0, failed: 0 }
  if (sync.state === 'failed') {
    return `<section class="sync-status is-error"><h2>镜像抓取失败</h2><p>最近一次抓取未能完成：${escapeHtml(sync.error || '未知错误')}</p><p>当前页面继续展示上一次可用内容，系统会在下一个整点后 17 分再次尝试。</p></section>`
  }
  if (sync.state === 'running') {
    return `<section class="sync-status is-running"><h2>镜像正在抓取</h2><p>当前阶段：${escapeHtml(sync.phase || '处理中')}。文章 ${articles.completed}/${articles.total}，媒体 ${media.completed}/${media.total}${media.failed ? `，失败 ${media.failed}` : ''}。</p><p>静态镜像将在本次抓取完成并发布后更新。</p></section>`
  }
  if (sync.state === 'success') {
    return `<section class="sync-status is-success"><h2>镜像抓取信息</h2><p>最近抓取时间：<time datetime="${sync.capturedAt}">${formatTime(sync.capturedAt)}</time></p><p>已同步 ${articles.completed}/${articles.total} 篇文章与 ${media.completed}/${media.total} 个媒体文件${media.failed ? `，其中 ${media.failed} 个媒体文件未能下载` : ''}。</p></section>`
  }
  return '<section class="sync-status"><h2>镜像抓取状态</h2><p>正在等待首次原站抓取。GitHub Actions 会在每小时的第 17 分执行同步。</p></section>'
}

const pageFragment = (page, isHome) => {
  if (!isHome) return { articleHtml: page.html, quoteHtml: '' }
  const template = document.createElement('template')
  template.innerHTML = page.html
  const quote = template.content.querySelector('.main-page-tag-rcs')
  const quoteHtml = quote?.querySelector('.rcs-container')?.innerHTML ?? quote?.innerHTML ?? ''
  quote?.remove()
  return { articleHtml: template.innerHTML, quoteHtml }
}

const prepareImages = (container) => {
  container.querySelectorAll('img').forEach((image) => {
    const finish = () => image.classList.remove('image-loading')
    image.classList.add('image-loading')
    if (image.complete) finish()
    else {
      image.addEventListener('load', finish, { once: true })
      image.addEventListener('error', finish, { once: true })
    }
  })
}

const scrollToFragment = () => {
  const fragment = location.hash.match(/^#\/wiki\/[^#]+#(.+)$/)?.[1]
  if (!fragment) return
  requestAnimationFrame(() => document.getElementById(decodeURIComponent(fragment))?.scrollIntoView({ block: 'start' }))
}

const renderTabbers = () => {
  document.querySelectorAll('.tabber').forEach((tabber) => {
    const tabs = [...tabber.querySelectorAll('.wds-tabs__tab')]
    const panels = [...tabber.querySelectorAll(':scope > .wds-tab__content')]
    tabs.forEach((tab, index) => tab.addEventListener('click', (event) => {
      event.preventDefault()
      tabs.forEach((item, itemIndex) => item.classList.toggle('wds-is-current', itemIndex === index))
      panels.forEach((panel, panelIndex) => panel.classList.toggle('wds-is-current', panelIndex === index))
    }))
  })
}

const start = async () => {
  renderLoading('正在加载 Wiki', '正在获取目录和导航信息，请稍候。')
  let source
  try {
    source = await fetchJson(indexUrl)
  } catch (error) {
    renderFailure(`尚未找到已同步的 Wiki 内容（${escapeHtml(error.message)}）。`)
    return
  }

  let sync = source.sync
  try {
    sync = await fetchJson(statusUrl, { cache: 'no-store' })
  } catch {
    // Use the status embedded in the index when an older deployment lacks a separate status file.
  }

  const theme = applyTheme(source.site)
  const pages = source.pages
  const pagesBySlug = new Map(pages.map((page) => [page.slug, page]))
  const home = pages.find((page) => page.title === '来福Simulation Wiki') ?? pages[0]
  const pageList = pages.map((page) => `<a href="${routeFor(page.slug)}">${escapeHtml(page.title)}</a>`).join('')
  let renderVersion = 0

  const showSearch = (query = '') => {
    const normalized = query.trim().toLocaleLowerCase()
    const matches = normalized
      ? pages.filter((page) => `${page.title} ${page.searchText}`.toLocaleLowerCase().includes(normalized)).slice(0, 24)
      : pages
    document.querySelector('#search-results').innerHTML = matches.length
      ? matches.map((page) => `<a href="${routeFor(page.slug)}"><strong>${escapeHtml(page.title)}</strong><span>${escapeHtml(page.summary || '')}</span></a>`).join('')
      : '<p class="no-results">未找到匹配的条目。</p>'
  }

  const render = async () => {
    const requestedSlug = location.hash.match(/^#\/wiki\/([^#]+)/)?.[1]
    const metadata = pagesBySlug.get(requestedSlug) ?? home
    const version = ++renderVersion
    renderLoading('正在加载页面', `正在打开“${escapeHtml(metadata.title)}”。`)
    let page
    try {
      page = await fetchJson(pageUrl(metadata.slug))
    } catch (error) {
      if (version === renderVersion) renderFailure(`无法加载“${escapeHtml(metadata.title)}”（${escapeHtml(error.message)}）。`)
      return
    }
    if (version !== renderVersion) return

    const toc = page.sections.filter((section) => Number(section.level) <= 3).map((section) => `<a class="toc-level-${section.level}" href="${routeFor(page.slug)}#${section.anchor}">${section.line}</a>`).join('')
    const isHome = metadata.slug === home.slug
    const { articleHtml, quoteHtml } = pageFragment(page, isHome)
    const outline = toc || '<span>本页没有目录</span>'
    document.title = `${page.title} | 来福Simulation Wiki（镜像站）`
    app.innerHTML = `
      <header class="wiki-header"><a class="wiki-brand" href="${routeFor(home.slug)}"><img class="wiki-brand-logo" src="${theme.icon}" alt="来福Simulation 标志"><span>来福Simulation Wiki（镜像站）</span></a><button class="mobile-toc-button" type="button" aria-expanded="false">目录</button><nav><a href="${routeFor(home.slug)}">首页</a><button class="all-pages-button" type="button" aria-expanded="false">全部条目</button></nav><form class="wiki-search" role="search"><label class="sr-only" for="wiki-search-input">搜索 Wiki</label><input id="wiki-search-input" type="search" placeholder="搜索这个镜像站"><button type="submit" aria-label="搜索">⌕</button></form></header>
      <div class="wiki-drawer" hidden><div class="drawer-head"><strong>全部条目（${pages.length}）</strong><button class="close-drawer" type="button" aria-label="关闭">×</button></div><div class="page-list">${pageList}</div></div>
      <aside class="mobile-toc-drawer" hidden aria-label="本页目录"><div class="drawer-head"><strong>本页目录</strong><button class="close-mobile-toc" type="button" aria-label="关闭目录">×</button></div><nav>${outline}</nav></aside>
      <main class="wiki-shell"><article class="wiki-article"><div class="article-heading"><p class="article-eyebrow">来福Simulation Wiki 镜像站</p><h1>${escapeHtml(page.title)}</h1></div><div class="article-body">${articleHtml}</div>${isHome ? syncPanel(sync) : ''}<footer class="article-license">本页为来福Simulation Wiki 的静态镜像，除另有注明外，依照 <a href="https://creativecommons.org/licenses/by-sa/3.0/deed.zh-hans" target="_blank" rel="noreferrer">CC BY-SA</a> 许可协议提供。</footer></article><aside class="wiki-sidebar"><section class="wiki-outline"><h2>本页目录</h2><nav>${outline}</nav></section>${quoteHtml ? `<section class="home-quotes">${quoteHtml}</section>` : ''}<section class="wiki-pages"><h2>Wiki 镜像条目</h2><p>共 ${pages.length} 篇迁移文章</p><a href="${routeFor(home.slug)}">返回镜像首页</a><h3>最近条目</h3>${pages.slice(-8).reverse().map((item) => `<a href="${routeFor(item.slug)}">${escapeHtml(item.title)}</a>`).join('')}</section></aside></main>
      <dialog id="search-dialog"><button class="dialog-close" type="button" aria-label="关闭">×</button><h2>搜索 Wiki</h2><form class="dialog-search"><input type="search" placeholder="输入关键词" autofocus><button type="submit">搜索</button></form><div id="search-results"></div></dialog>`

    const drawer = document.querySelector('.wiki-drawer')
    const drawerButton = document.querySelector('.all-pages-button')
    drawerButton.addEventListener('click', () => {
      const open = drawer.hidden
      drawer.hidden = !open
      drawerButton.setAttribute('aria-expanded', String(open))
    })
    document.querySelector('.close-drawer').addEventListener('click', () => { drawer.hidden = true; drawerButton.setAttribute('aria-expanded', 'false') })
    const mobileToc = document.querySelector('.mobile-toc-drawer')
    const mobileTocButton = document.querySelector('.mobile-toc-button')
    mobileTocButton.addEventListener('click', () => {
      const open = mobileToc.hidden
      mobileToc.hidden = !open
      mobileTocButton.setAttribute('aria-expanded', String(open))
    })
    document.querySelector('.close-mobile-toc').addEventListener('click', () => { mobileToc.hidden = true; mobileTocButton.setAttribute('aria-expanded', 'false') })
    const searchDialog = document.querySelector('#search-dialog')
    document.querySelector('.wiki-search').addEventListener('submit', (event) => { event.preventDefault(); searchDialog.showModal(); const field = document.querySelector('.dialog-search input'); field.value = document.querySelector('#wiki-search-input').value; showSearch(field.value); field.focus() })
    document.querySelector('.dialog-search').addEventListener('submit', (event) => { event.preventDefault(); showSearch(event.currentTarget.querySelector('input').value) })
    document.querySelector('.dialog-close').addEventListener('click', () => searchDialog.close())
    const article = document.querySelector('.wiki-article')
    article.addEventListener('click', (event) => {
      const anchor = event.target.closest('a[href]')
      const href = anchor?.getAttribute('href')
      if (href?.startsWith('#') && href !== '#' && !href.startsWith('#/wiki/')) {
        event.preventDefault()
        location.hash = `${routeFor(page.slug)}${href}`
      }
    })
    prepareImages(article)
    renderTabbers()
    scrollToFragment()
  }

  window.addEventListener('hashchange', render)
  render()
}

applyTheme()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(new URL('sw.js', window.location.href)))
}

start()