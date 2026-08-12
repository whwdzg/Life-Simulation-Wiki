import './style.css'

const dataUrl = `${import.meta.env.BASE_URL}wiki-data/pages.json`
const app = document.querySelector('#app')

const escapeHtml = (value) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const routeFor = (slug) => `#/wiki/${slug}`
const pageText = (page) => page.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

const renderLoading = () => {
  app.innerHTML = '<main class="load-state loading-state" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><h1>正在加载 Wiki 内容</h1><p>正在读取本地内容包，请稍候。</p></main>'
}

const renderFailure = (message) => {
  app.innerHTML = `<main class="load-state"><h1>来福Simulation Wiki</h1><p>${message}</p><p>GitHub Pages 部署会先运行内容同步，再发布完整静态站点。</p></main>`
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
  const id = decodeURIComponent(fragment)
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
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
  renderLoading()
  let source
  try {
    const response = await fetch(dataUrl)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    source = await response.json()
  } catch (error) {
    renderFailure(`尚未找到已同步的 Wiki 内容（${escapeHtml(error.message)}）。`)
    return
  }

  const pages = source.pages
  const pagesBySlug = new Map(pages.map((page) => [page.slug, page]))
  const home = pages.find((page) => page.title === '来福Simulation Wiki') ?? pages[0]
  const pageList = pages.map((page) => `<a href="${routeFor(page.slug)}">${escapeHtml(page.title)}</a>`).join('')

  const showSearch = (query = '') => {
    const normalized = query.trim().toLocaleLowerCase()
    const matches = normalized
      ? pages.filter((page) => `${page.title} ${pageText(page)}`.toLocaleLowerCase().includes(normalized)).slice(0, 24)
      : pages
    document.querySelector('#search-results').innerHTML = matches.length
      ? matches.map((page) => `<a href="${routeFor(page.slug)}"><strong>${escapeHtml(page.title)}</strong><span>${escapeHtml(pageText(page).slice(0, 110))}</span></a>`).join('')
      : '<p class="no-results">未找到匹配的条目。</p>'
  }

  const render = () => {
    const rawSlug = location.hash.match(/^#\/wiki\/([^#]+)/)?.[1]
    const page = pagesBySlug.get(rawSlug) ?? home
    const toc = page.sections.filter((section) => Number(section.level) <= 3).map((section) => `<a class="toc-level-${section.level}" href="#${section.anchor}">${section.line}</a>`).join('')
    const { articleHtml, quoteHtml } = pageFragment(page, page === home)
    const outline = toc || '<span>本页没有目录</span>'
    document.title = `${page.title} | 来福Simulation Wiki`
    app.innerHTML = `
      <header class="wiki-header"><a class="wiki-brand" href="${routeFor(home.slug)}">来福Simulation Wiki</a><nav><a href="${routeFor(home.slug)}">首页</a><button class="all-pages-button" type="button" aria-expanded="false">全部条目</button></nav><form class="wiki-search" role="search"><label class="sr-only" for="wiki-search-input">搜索 Wiki</label><input id="wiki-search-input" type="search" placeholder="搜索这个 Wiki"><button type="submit" aria-label="搜索">⌕</button></form></header>
      <div class="wiki-drawer" hidden><div class="drawer-head"><strong>全部条目（${pages.length}）</strong><button class="close-drawer" type="button" aria-label="关闭">×</button></div><div class="page-list">${pageList}</div></div>
      <main class="wiki-shell"><article class="wiki-article"><details class="mobile-outline"><summary>本页目录</summary><nav>${outline}</nav></details><div class="article-heading"><p class="article-eyebrow">来福Simulation Wiki</p><h1>${escapeHtml(page.title)}</h1></div><div class="article-body">${articleHtml}</div><footer class="article-license">本页内容迁移自来福Simulation Wiki，除另有注明外，依照 <a href="https://creativecommons.org/licenses/by-sa/3.0/deed.zh-hans" target="_blank" rel="noreferrer">CC BY-SA</a> 许可协议提供。</footer></article><aside class="wiki-sidebar"><section class="wiki-outline"><h2>本页目录</h2><nav>${outline}</nav></section>${quoteHtml ? `<section class="home-quotes">${quoteHtml}</section>` : ''}<section class="wiki-pages"><h2>Wiki 条目</h2><p>共 ${pages.length} 篇迁移文章</p><a href="${routeFor(home.slug)}">返回首页</a><h3>最近条目</h3>${pages.slice(-8).reverse().map((item) => `<a href="${routeFor(item.slug)}">${escapeHtml(item.title)}</a>`).join('')}</section></aside></main>
      <dialog id="search-dialog"><button class="dialog-close" type="button" aria-label="关闭">×</button><h2>搜索 Wiki</h2><form class="dialog-search"><input type="search" placeholder="输入关键词" autofocus><button type="submit">搜索</button></form><div id="search-results"></div></dialog>`

    const drawer = document.querySelector('.wiki-drawer')
    const drawerButton = document.querySelector('.all-pages-button')
    drawerButton.addEventListener('click', () => {
      const open = drawer.hidden
      drawer.hidden = !open
      drawerButton.setAttribute('aria-expanded', String(open))
    })
    document.querySelector('.close-drawer').addEventListener('click', () => { drawer.hidden = true; drawerButton.setAttribute('aria-expanded', 'false') })
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(new URL('sw.js', window.location.href)))
}

start()