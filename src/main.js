import './style.css'

window.__lifeSimulationWikiStarted = true

const baseUrl = import.meta.env.BASE_URL
const indexUrl = `${baseUrl}wiki-data/index.json`
const pageUrl = (page) => `${baseUrl}wiki-data/pages/${page.file ?? `${page.slug}.json`}`
const statusUrl = `${baseUrl}wiki-data/sync-status.json`
const app = document.querySelector('#app')
const fallbackTheme = {
  background: 'https://static.wikia.nocookie.net/lifesimulation/images/b/b5/Site-background-light/revision/latest?cb=20251002115419&path-prefix=zh',
  icon: 'https://static.wikia.nocookie.net/lifesimulation/images/e/e6/Site-logo.png/revision/latest?cb=20251002013153&path-prefix=zh',
}

const escapeHtml = (value) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const decodeSlug = (slug) => {
  try {
    return decodeURIComponent(slug)
  } catch {
    return slug
  }
}
const routeFor = (slug, fragment = '') => {
  const root = new URL(baseUrl, window.location.href).href
  const anchor = fragment ? `#${encodeURIComponent(decodeSlug(fragment))}` : ''
  return `${root}#/wiki/${slug}${anchor}`
}

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, { cache: 'force-cache', ...options })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

const applyTheme = (site = {}) => {
  const theme = { background: site.background || fallbackTheme.background, icon: site.icon || fallbackTheme.icon }
  document.documentElement.style.setProperty('--wiki-background', `url("${new URL(theme.background, window.location.href).href}")`)
  document.querySelector('#site-favicon').href = new URL(theme.icon, window.location.href).href
  document.documentElement.style.colorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return theme
}

const renderLoading = (title = '正在加载页面', message = '正在获取 Wiki 内容，请稍候。') => {
  app.innerHTML = `<main class="load-state loading-state" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><h1>${title}</h1><p>${message}</p></main>`
}

const renderFailure = (message) => {
  app.innerHTML = `<main class="load-state"><h1>来福Simulation Wiki（镜像站）</h1><p>${message}</p><p>请稍后刷新页面重试。</p></main>`
}

const formatTime = (value) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(new Date(value)) : '尚未完成首次抓取'
const formatTimeShort = (value) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value)) : ''

const revisionPanel = (page) => {
  const rev = page.revision || {}
  if (!rev.user && !rev.timestamp && !rev.revid) return ''
  const historyCount = page.history ? page.history.length : 0
  return `<section class="sync-status revision-info"><h2>版本编辑历史</h2><p>编辑人：${escapeHtml(rev.user || '未知')}</p><p>编辑时间：<time datetime="${rev.timestamp}">${formatTime(rev.timestamp)}</time></p>${rev.comment ? `<p>编辑摘要：${escapeHtml(rev.comment)}</p>` : ''}${historyCount > 0 ? `<p><button class="history-btn" type="button" data-slug="${escapeHtml(page.slug)}">查看历史版本（${historyCount} 个）</button></p>` : ''}</section>`
}

const renderHistoryDialog = (page) => {
  const list = (page.history || []).map((rev, index) => `<label class="history-item"><input type="radio" name="history-rev" value="${rev.revid}" data-index="${index}"${index === 0 ? ' checked' : ''}><span class="history-meta"><strong>${escapeHtml(rev.user || '未知')}</strong><time datetime="${rev.timestamp}">${formatTimeShort(rev.timestamp)}</time></span><span class="history-comment">${escapeHtml(rev.comment || '')}</span></label>`).join('')
  return `<dialog id="history-dialog"><button class="dialog-close" type="button" aria-label="关闭">×</button><h2>历史版本</h2><div class="history-list">${list || '<p>暂无历史版本信息。</p>'}</div><div class="history-actions"><button class="history-view-btn" type="button" disabled>查看选中版本</button><button class="history-diff-btn" type="button" disabled>与当前版本对比</button></div><div id="history-preview" class="history-preview"></div></dialog>`
}

const diffHtml = (oldHtml, newHtml) => {
  const oldText = oldHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const newText = newHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (oldText === newText) return '<p class="diff-no-change">两个版本内容相同。</p>'
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  let result = '<table class="diff-table"><thead><tr><th>旧版本</th><th>新版本</th></tr></thead><tbody>'
  const maxLen = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || ''
    const newLine = newLines[i] || ''
    if (oldLine !== newLine) {
      result += `<tr class="diff-changed"><td>${escapeHtml(oldLine) || '&nbsp;'}</td><td>${escapeHtml(newLine) || '&nbsp;'}</td></tr>`
    } else {
      result += `<tr><td>${escapeHtml(oldLine)}</td><td>${escapeHtml(newLine)}</td></tr>`
    }
  }
  result += '</tbody></table>'
  return result
}

const deployPanel = (deploy = {}) => {
  const branch = (deploy.ref || '').replace(/^refs\/heads\//, '')
  const shortSha = (deploy.sha || '').slice(0, 7)
  const repoUrl = deploy.repository ? `https://github.com/${deploy.repository}` : ''
  const runUrl = deploy.repository && deploy.runId ? `${repoUrl}/actions/runs/${deploy.runId}` : ''
  const commitMessage = deploy.message || ''
  return `<section class="sync-status deploy-info"><h2>部署信息</h2><p>${repoUrl ? `<a href="${repoUrl}" target="_blank" rel="noreferrer">${escapeHtml(deploy.repository)}</a>` : '—'}</p><p>分支：${branch || '—'}&#x2003;提交：${shortSha ? (repoUrl ? `<a href="${repoUrl}/commit/${deploy.sha}" target="_blank" rel="noreferrer">${shortSha}</a>` : shortSha) : '—'}</p>${commitMessage ? `<p>提交描述：${escapeHtml(commitMessage)}</p>` : ''}${runUrl ? `<p>触发：<a href="${runUrl}" target="_blank" rel="noreferrer">${escapeHtml(deploy.workflow || '')} #${deploy.runNumber || ''}</a></p>` : ''}<p><button class="reload-page-btn" type="button">重载页面</button></p></section>`
}

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

const pageFragment = (page, isHome, logoUrl) => {
  if (!isHome) return { articleHtml: page.html, quoteHtml: '' }
  const template = document.createElement('template')
  template.innerHTML = page.html
  const quote = template.content.querySelector('.main-page-tag-rcs')
  const quoteHtml = quote?.querySelector('.rcs-container')?.innerHTML ?? quote?.innerHTML ?? ''
  quote?.remove()
  // 替换首页第一个大图为网站图标
  const firstImg = template.content.querySelector('img[src*="wiki-assets/"]')
  if (firstImg && logoUrl) {
    firstImg.src = logoUrl
    firstImg.dataset.sourceUrl = logoUrl
    firstImg.style.maxWidth = '200px'
    firstImg.style.maxHeight = '200px'
    firstImg.loading = 'eager'
    firstImg.fetchPriority = 'high'
  }
  return { articleHtml: template.innerHTML, quoteHtml }
}

const prepareImages = (container) => {
  container.querySelectorAll('img').forEach((image, index) => {
    const finish = () => {
      image.classList.remove('image-loading', 'image-failed')
      image.closest('figure, .thumb, .image')?.classList.remove('image-loading')
    }
    const fallback = () => {
      const source = image.dataset.sourceUrl
      if (source && image.currentSrc !== source) {
        image.removeAttribute('data-source-url')
        image.addEventListener('error', fallback, { once: true })
        image.src = source
        return
      }
      image.classList.remove('image-loading')
      image.classList.add('image-failed')
    }
    if (index === 0) {
      image.loading = 'eager'
      image.fetchPriority = 'high'
    } else {
      image.loading = 'lazy'
      image.decoding = 'async'
    }
    image.classList.add('image-loading')
    image.closest('figure, .thumb, .image')?.classList.add('image-loading')
    if (image.complete) {
      if (image.naturalWidth > 0) finish()
      else fallback()
    } else {
      image.addEventListener('load', finish, { once: true })
      image.addEventListener('error', fallback, { once: true })
    }
  })
}

const prepareVideos = (container) => {
  container.querySelectorAll('video').forEach((video) => {
    if (!video.hasAttribute('preload')) video.preload = 'none'
    if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', '')
    video.addEventListener('mouseenter', () => { video.preload = 'auto' }, { once: true })
  })
}

const scrollToFragment = () => {
  const fragment = location.hash.match(/^#\/wiki\/[^#]+#(.+)$/)?.[1]
  if (!fragment) return
  requestAnimationFrame(() => document.getElementById(decodeURIComponent(fragment))?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

const normalizeWikiLinks = (container) => {
  container.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href')
    const match = href?.match(/^#\/wiki\/([^#]+)(?:#(.+))?$/)
    if (!match) return
    const [, slug, fragment = ''] = match
    // 保持 #/wiki/ 格式，使用解码后的 slug 避免浏览器二次编码
    const decodedSlug = decodeSlug(slug)
    anchor.href = fragment ? `#/wiki/${decodedSlug}#${encodeURIComponent(decodeSlug(fragment))}` : `#/wiki/${decodedSlug}`
    anchor.dataset.wikiSlug = decodedSlug
    if (fragment) anchor.dataset.scrollTarget = decodeSlug(fragment)
  })
}

const scrollWithinPage = (slug, target) => {
  history.replaceState(null, '', routeFor(slug, target))
  document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  let deploy = {}
  try {
    deploy = await fetchJson(`${baseUrl}wiki-data/deploy-info.json`)
  } catch {
    // deploy-info.json may not exist in older deployments or local dev.
  }

  const theme = applyTheme(source.site)
  const pages = source.pages
  const pagesBySlug = new Map(pages.flatMap((page) => [[page.slug, page], [decodeSlug(page.slug), page]]))
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
    const metadata = pagesBySlug.get(requestedSlug) ?? pagesBySlug.get(decodeSlug(requestedSlug ?? '')) ?? home
    const version = ++renderVersion
    renderLoading('正在加载页面', `正在打开“${escapeHtml(metadata.title)}”。`)
    let page
    try {
      page = await fetchJson(pageUrl(metadata))
    } catch (error) {
      if (version === renderVersion) renderFailure(`无法加载“${escapeHtml(metadata.title)}”（${escapeHtml(error.message)}）。`)
      return
    }
    if (version !== renderVersion) return

    const toc = page.sections.filter((section) => Number(section.level) <= 3).map((section) => `<a class="toc-level-${section.level}" data-wiki-slug="${page.slug}" data-scroll-target="${escapeHtml(section.anchor)}" href="${routeFor(page.slug, section.anchor)}">${section.line}</a>`).join('')
    const isHome = metadata.slug === home.slug
    const { articleHtml, quoteHtml } = pageFragment(page, isHome, theme.icon)
    const outline = toc || '<span>本页没有目录</span>'
    document.title = `${page.title} | 来福Simulation Wiki（镜像站）`
    app.innerHTML = `
      <header class="wiki-header"><a class="wiki-brand" href="${routeFor(home.slug)}"><img class="wiki-brand-logo" src="${theme.icon}" alt="来福Simulation 标志"><span>来福Simulation Wiki（镜像站）</span></a><nav><a href="${routeFor(home.slug)}">首页</a><button class="all-pages-button" type="button" aria-expanded="false">全部页面</button></nav><button class="search-toggle" type="button" aria-label="搜索">⌕</button><form class="wiki-search" role="search"><label class="sr-only" for="wiki-search-input">搜索 Wiki</label><input id="wiki-search-input" type="search" placeholder="搜索这个镜像站"><button type="submit" aria-label="搜索">⌕</button></form><button class="mobile-toc-button" type="button" aria-expanded="false">目录</button></header>
      <div class="wiki-drawer" hidden><div class="drawer-head"><strong>全部条目（${pages.length}）</strong><button class="close-drawer" type="button" aria-label="关闭">×</button></div><div class="page-list">${pageList}</div></div>
      <aside class="mobile-toc-drawer" hidden aria-label="本页目录"><div class="drawer-head"><strong>本页目录</strong><button class="close-mobile-toc" type="button" aria-label="关闭目录">×</button></div><nav>${outline}</nav></aside>
      <main class="wiki-shell"><article class="wiki-article"><div class="article-heading"><p class="article-eyebrow">来福Simulation Wiki 镜像站</p><h1>${escapeHtml(page.title)}</h1></div><div class="article-body">${articleHtml}</div>${isHome ? syncPanel(sync) + deployPanel(deploy) : ''}${revisionPanel(page)}<footer class="article-license">本页为<a href="https://lifesimulation.fandom.com/zh/wiki/%E6%9D%A5%E7%A6%8FSimulation" target="_blank" rel="noreferrer">来福Simulation Wiki</a> 的静态镜像，除另有注明外，依照 <a href="https://creativecommons.org/licenses/by-sa/3.0/deed.zh-hans" target="_blank" rel="noreferrer">CC BY-SA</a> 许可协议提供。源代码以GPL v3许可协议开源。本站不提供编辑内容功能，也无法完全替代原页面，仅供静态页面浏览。</footer></article><aside class="wiki-sidebar"><section class="wiki-outline"><h2>本页目录</h2><nav>${outline}</nav></section>${quoteHtml ? `<section class="home-quotes">${quoteHtml}</section>` : ''}<section class="wiki-pages"><h2>Wiki 镜像条目</h2><p>共 ${pages.length} 篇迁移文章</p><a href="${routeFor(home.slug)}">返回镜像首页</a><h3>最近条目</h3>${pages.slice(-8).reverse().map((item) => `<a href="${routeFor(item.slug)}">${escapeHtml(item.title)}</a>`).join('')}</section></aside></main>
      ${renderHistoryDialog(page)}
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
    document.querySelector('.search-toggle')?.addEventListener('click', () => { searchDialog.showModal(); const field = document.querySelector('.dialog-search input'); field.value = ''; showSearch(''); field.focus() })
    document.querySelector('.dialog-search').addEventListener('submit', (event) => { event.preventDefault(); showSearch(event.currentTarget.querySelector('input').value) })
    document.querySelector('.dialog-close').addEventListener('click', () => searchDialog.close())
    const historyDialog = document.querySelector('#history-dialog')
    const historyCloseBtn = historyDialog?.querySelector('.dialog-close')
    if (historyCloseBtn) historyCloseBtn.addEventListener('click', () => historyDialog.close())
    document.querySelector('.reload-page-btn')?.addEventListener('click', async () => {
      const btn = document.querySelector('.reload-page-btn')
      btn.disabled = true
      btn.textContent = '正在重载...'
      try {
        // 清除所有 service worker 缓存
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((key) => caches.delete(key)))
        }
      } catch { /* best effort */ }
      // 强制从服务器重新加载，跳过浏览器缓存
      location.reload()
    })
    const historyBtn = document.querySelector('.history-btn')
    if (historyBtn) {
      historyBtn.addEventListener('click', () => {
        historyDialog?.showModal()
        document.querySelector('#history-preview').innerHTML = ''
        document.querySelector('.history-view-btn').disabled = true
        document.querySelector('.history-diff-btn').disabled = true
      })
    }
    document.querySelector('.history-list')?.addEventListener('change', () => {
      document.querySelector('.history-view-btn').disabled = false
      document.querySelector('.history-diff-btn').disabled = false
    })
    document.querySelector('.history-view-btn')?.addEventListener('click', () => {
      const selected = document.querySelector('input[name="history-rev"]:checked')
      if (!selected) return
      const index = Number(selected.dataset.index)
      const rev = page.history?.[index]
      if (!rev) return
      const preview = document.querySelector('#history-preview')
      if (rev.html) {
        preview.innerHTML = `<div class="diff-result"><h3>版本 ${rev.revid} - ${escapeHtml(rev.user)} (${formatTimeShort(rev.timestamp)})</h3><div class="history-preview-content">${rev.html}</div></div>`
      } else {
        preview.innerHTML = '<p>该版本内容未同步到镜像站，无法查看。</p>'
      }
    })
    document.querySelector('.history-diff-btn')?.addEventListener('click', () => {
      const selected = document.querySelector('input[name="history-rev"]:checked')
      if (!selected) return
      const index = Number(selected.dataset.index)
      const rev = page.history?.[index]
      if (!rev) return
      const preview = document.querySelector('#history-preview')
      if (rev.html) {
        preview.innerHTML = `<div class="diff-result"><h3>与当前版本对比（版本 ${rev.revid}）</h3>${diffHtml(rev.html, page.html)}</div>`
      } else {
        preview.innerHTML = '<p>该版本内容未同步到镜像站，无法对比。</p>'
      }
    })
    const article = document.querySelector('.wiki-article')
    normalizeWikiLinks(article)
    const handlePageNavigation = (event) => {
      const anchor = event.target.closest('a[href]')
      if (!anchor) return
      const slug = anchor.dataset.wikiSlug
      if (!slug) return
      event.preventDefault()
      const target = anchor.dataset.scrollTarget
      if (target && decodeSlug(slug) === decodeSlug(page.slug)) {
        scrollWithinPage(slug, target)
      } else {
        const decodedSlug = decodeSlug(slug)
        const hash = target ? `#/wiki/${decodedSlug}#${encodeURIComponent(decodeSlug(target))}` : `#/wiki/${decodedSlug}`
        window.location.href = hash
      }
    }
    article.addEventListener('click', handlePageNavigation)
    mobileToc.addEventListener('click', handlePageNavigation)
    document.querySelector('.wiki-sidebar').addEventListener('click', handlePageNavigation)
    prepareImages(article)
    prepareVideos(article)
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