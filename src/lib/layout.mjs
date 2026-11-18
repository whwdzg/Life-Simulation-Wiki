import { escapeHtml, sitePath, stripTags } from './paths.mjs'
import { formatDateTime, formatNumber, formatUtc } from './format.mjs'

export const NAV_ITEMS = [
  { id: 'home', label: '首页', path: '' },
  { id: 'pages', label: '全部页面', path: 'pages' },
  { id: 'templates', label: '模板', path: 'templates' },
  { id: 'media', label: '媒体库', path: 'media' },
  { id: 'categories', label: '分类', path: 'categories' },
  { id: 'maps', label: '地图', path: 'maps' },
  { id: 'discussions', label: '讨论版', path: 'discussions' },
  { id: 'recent', label: '最近更新', path: 'recent' },
  { id: 'about', label: '关于镜像', path: 'about' },
]

export function navUrl(item, base) {
  return item.path ? `${base}/${item.path}/` : `${base}/`
}

export function icon(name, className = 'icon') {
  const paths = {
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    github: '<path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.9a3.4 3.4 0 0 0-1-2.6c3.4-.4 6.8-1.7 6.8-7.6a5.9 5.9 0 0 0-1.6-4.1 5.4 5.4 0 0 0-.2-4.1s-1.3-.4-4.2 1.6a14.5 14.5 0 0 0-7.6 0C4.3-1.7 3-1.3 3-1.3a5.4 5.4 0 0 0-.2 4.1A5.9 5.9 0 0 0 1.2 6.9c0 5.9 3.4 7.2 6.8 7.6a3.4 3.4 0 0 0-1 2.6V21"/>',
  }
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`
}

const FALLBACK_LOGO =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%230f766e%22/%3E%3Cpath d=%22M18 42V26l14-8 14 8v16l-14 8z%22 fill=%22none%22 stroke=%22%23fff%22 stroke-width=%223%22 stroke-linejoin=%22round%22/%3E%3Cpath d=%22M32 34v12%22 stroke=%22%23fff%22 stroke-width=%223%22/%3E%3C/svg%3E'

export function renderHeader({ base, active, site, buildId }) {
  const nav = NAV_ITEMS.map(
    (item) =>
      `<a class="site-nav__link${active === item.id ? ' is-active' : ''}" href="${navUrl(item, base)}"${active === item.id ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a>`,
  ).join('')
  return `<header class="site-header">
  <div class="site-header__inner">
    <button class="icon-button menu-toggle" type="button" aria-label="打开导航" aria-controls="wiki-sidebar" aria-expanded="false">${icon('menu')}</button>
    <a class="brand" href="${base}/">
      <img class="brand__logo" src="${site.logo ?? FALLBACK_LOGO}" alt="" width="40" height="40">
      <span class="brand__text"><span class="brand__name">来福Simulation Wiki</span><span class="brand__sub">静态镜像站</span></span>
    </a>
    <nav class="site-nav" aria-label="站点导航">${nav}</nav>
    <div class="site-header__actions">
      <button class="search-open icon-button" type="button" aria-label="搜索" data-search-open>${icon('search')}<span class="search-open__label">搜索</span><kbd>/</kbd></button>
      <button class="theme-toggle icon-button" type="button" aria-label="切换明暗主题" data-theme-toggle>${icon('sun')}${icon('moon')}</button>
    </div>
  </div>
</header>`
}

export function renderToc(sections, { title = '本页目录' } = {}) {
  const items = (sections ?? []).filter((section) => section?.anchor && section?.line && section.level <= 4)
  if (!items.length) return `<section class="sidebar-block"><h2>${escapeHtml(title)}</h2><p class="sidebar-empty">本页没有目录。</p></section>`
  const links = items
    .map(
      (section) =>
        `<li class="page-toc__item page-toc__item--level-${section.level}"><a href="#${encodeURIComponent(section.anchor)}">${escapeHtml(stripTags(section.line))}</a></li>`,
    )
    .join('')
  return `<section class="sidebar-block toc-block">
  <h2>${escapeHtml(title)}</h2>
  <nav aria-label="本页目录"><ul class="page-toc">${links}</ul></nav>
</section>`
}

export function renderSidebar({ base, active, build, site, counts, toc, sidebarExtra = '' }) {
  const nav = NAV_ITEMS.map(
    (item) =>
      `<a class="sidebar-nav__link${active === item.id ? ' is-active' : ''}" href="${navUrl(item, base)}"${active === item.id ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a>`,
  ).join('')
  return `<aside class="sidebar" id="wiki-sidebar" aria-label="侧边栏">
  <div class="sidebar-search">
    <button type="button" class="sidebar-search__button" data-search-open>${icon('search')}<span>搜索条目、模板、文件…</span><kbd>/</kbd></button>
  </div>
  <section class="sidebar-block">
    <h2>导航</h2>
    <nav class="sidebar-nav" aria-label="站点导航">${nav}</nav>
  </section>
  <section class="sidebar-block sidebar-theme">
    <h2>外观</h2>
    <label class="theme-switch" for="theme-system">
      <span class="theme-switch__text"><strong>跟随系统</strong><small>深色 / 浅色自动切换</small></span>
      <span class="switch"><input id="theme-system" type="checkbox" role="switch" data-theme-system checked><span class="switch__track" aria-hidden="true"></span></span>
    </label>
    <p class="theme-status" data-theme-status>跟随系统</p>
  </section>
  ${toc ?? ''}
  ${sidebarExtra}
  <section class="sidebar-block sidebar-meta">
    <h2>镜像信息</h2>
    <p>共收录 <strong>${formatNumber(counts.pages)}</strong> 个页面、<strong>${formatNumber(counts.media)}</strong> 个媒体文件。</p>
    <p>内容更新时间：<time datetime="${build.finishedAt}">${formatDateTime(build.finishedAt)}</time></p>
    <p><a href="${site.sourceUrl}" target="_blank" rel="noopener noreferrer">访问原站 ${icon('external', 'icon icon--small')}</a></p>
  </section>
  <section class="sidebar-block sidebar-pwa" data-pwa-card>
    <h2>安装为应用</h2>
    <p class="pwa-lead">把镜像添加到桌面或主屏幕，像 App 一样全屏打开；访问过的页面可离线查看。</p>
    <button class="pwa-install" type="button" data-pwa-install aria-describedby="pwa-status">安装到设备</button>
    <p class="pwa-status" id="pwa-status" data-pwa-status role="status" aria-live="polite">正在检查安装条件…</p>
    <details class="pwa-help" data-pwa-help>
      <summary>安装方法</summary>
      <div class="pwa-help__body">
        <p><strong>Chrome / Edge 桌面</strong>：点击地址栏右侧的安装图标，或打开菜单 → “安装应用”。</p>
        <p><strong>Android</strong>：浏览器菜单 → “安装应用”或“添加到主屏幕”。</p>
        <p><strong>iPhone / iPad</strong>：在 Safari 中点分享按钮 → “添加到主屏幕”。</p>
        <p>安装后从桌面图标启动，不显示浏览器地址栏；访问过的页面与样式会缓存到本地，断网时仍可打开。</p>
      </div>
    </details>
  </section>
</aside>`
}

export function renderPageHead({ page, sourceUrl, badges = [] }) {
  const badgeHtml = badges
    .map((badge) => `<span class="badge${badge.modifier ? ` badge--${badge.modifier}` : ''}">${escapeHtml(badge.label)}</span>`)
    .join('')
  const meta = page?.timestamp
    ? `<p class="page-head__meta">最后编辑：<strong>${escapeHtml(page.user || '未知')}</strong> · <time datetime="${page.timestamp}">${formatDateTime(page.timestamp)}</time>${page.revid ? ` · <span class="mono">修订 ${escapeHtml(page.revid)}</span>` : ''}${page.comment ? ` · ${escapeHtml(page.comment)}` : ''}</p>`
    : ''
  return `<header class="page-head">
  <div class="page-head__badges">${badgeHtml}<span class="page-head__links">${page?.historyUrl ? `<a class="source-link" href="${page.historyUrl}">历史版本</a>` : ''}${sourceUrl ? `<a class="source-link" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">原页面 ${icon('external', 'icon icon--small')}</a>` : ''}</span></div>
  <h1>${escapeHtml(page?.title ?? '')}</h1>
  ${meta}
</header>`
}

export function renderBreadcrumb(items, base) {
  const parts = items.map((item, index) => {
    const label = escapeHtml(item.label)
    if (index === items.length - 1) return `<span aria-current="page">${label}</span>`
    return `<a href="${item.path ? sitePath(base, item.path) : `${base}/`}">${label}</a>`
  })
  return `<nav class="breadcrumb" aria-label="面包屑">${parts.join('<span class="breadcrumb__sep">/</span>')}</nav>`
}

export function renderHomeStatus({ build, stats, site }) {
  const failures = build.failedPages ?? 0
  const failedMedia = build.media?.failed ?? 0
  const failedNote =
    failures || failedMedia
      ? `<p class="mirror-status__warning">本次同步有 ${formatNumber(failures)} 个页面、${formatNumber(failedMedia)} 个媒体文件未能获取，相关页面会保留上次抓取的内容或改用原站链接。</p>`
      : ''
  const runLink = build.runUrl
    ? `<a href="${build.runUrl}" target="_blank" rel="noopener noreferrer">查看本次 GitHub Actions 运行记录</a>`
    : ''
  return `<section class="mirror-status" id="mirror-status" aria-labelledby="mirror-status-title">
  <div class="mirror-status__head">
    <h2 id="mirror-status-title">镜像更新状态</h2>
    <span class="pill pill--live">每小时自动更新</span>
  </div>
  <p class="mirror-status__updated">内容更新时间：<time datetime="${build.finishedAt}">${formatDateTime(build.finishedAt)}</time> <span class="mirror-status__utc">（${formatUtc(build.finishedAt)}）</span></p>
  <dl class="mirror-stats">
    <div><dt>收录页面</dt><dd>${formatNumber(build.pages)}</dd></div>
    <div><dt>媒体文件</dt><dd>${formatNumber(build.media?.files ?? 0)}</dd></div>
    <div><dt>媒体体积</dt><dd>${formatNumber(Math.round((build.media?.bytes ?? 0) / 1024 / 1024))} MB</dd></div>
    <div><dt>本次耗时</dt><dd>${formatNumber(Math.round((build.durationMs ?? 0) / 1000))} 秒</dd></div>
    <div><dt>源站条目</dt><dd>${formatNumber(stats.articles ?? 0)}</dd></div>
    <div><dt>源站编辑</dt><dd>${formatNumber(stats.edits ?? 0)}</dd></div>
  </dl>
  ${failedNote}
  <p class="mirror-status__note">本站由 GitHub Actions 在每个整点自动从 <a href="${site.sourceUrl}" target="_blank" rel="noopener noreferrer">来福Simulation Wiki</a> 抓取页面、模板与媒体文件后重新构建；页面中的模板已由 MediaWiki 展开为静态 HTML，图片、音频和视频均保存于本站。${runLink ? ` ${runLink}。` : ''}</p>
</section>`
}

export function renderPageFooter({ page, build, site, sourceUrl }) {
  const history = page?.historyUrl
    ? `<p class="page-footer__history"><a href="${page.historyUrl}">查看历史版本与对比</a></p>`
    : ''
  return `<footer class="page-footer">
  <p>本页内容来自 <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">来福Simulation Wiki</a>，依 <a href="${site.licenseUrl}" target="_blank" rel="noopener noreferrer">${site.license}</a> 许可协议提供；本站为不提供编辑功能的静态镜像。</p>
  ${history}
  <p class="page-footer__updated">镜像内容更新时间：<time datetime="${build.finishedAt}">${formatDateTime(build.finishedAt)}</time> <span class="mirror-status__utc">（${formatUtc(build.finishedAt)}）</span>${page?.revid ? ` · 本页修订 ${escapeHtml(page.revid)}` : ''}</p>
</footer>`
}

export function renderSiteFooter({ build, site, base }) {
  return `<footer class="site-footer">
  <div class="site-footer__inner">
    <p class="site-footer__updated">镜像内容更新时间：<time datetime="${build.finishedAt}">${formatDateTime(build.finishedAt)}</time>（UTC+8）</p>
    <p>来福Simulation Wiki 非官方静态镜像 · 内容依 ${escapeHtml(site.license)} 提供 · 每小时自动同步</p>
    <p class="site-footer__links"><a href="${site.sourceUrl}" target="_blank" rel="noopener noreferrer">原站</a><a href="${site.repository}" target="_blank" rel="noopener noreferrer">GitHub 仓库</a><a href="${base}/about/">关于镜像</a><a href="${base}/statistics/">同步统计</a></p>
  </div>
</footer>`
}

export function renderSearchDialog() {
  return `<dialog class="search-dialog" id="search-dialog" aria-labelledby="search-dialog-title">
  <div class="search-dialog__head">
    <h2 id="search-dialog-title">搜索镜像站</h2>
    <button class="icon-button search-dialog__close" type="button" data-search-close aria-label="关闭搜索">${icon('close')}</button>
  </div>
  <form class="search-dialog__form" role="search" data-search-form>
    <label class="sr-only" for="search-input">搜索关键词</label>
    <input id="search-input" name="q" type="search" placeholder="输入条目、模板或文件名称…" autocomplete="off" spellcheck="false" data-search-input>
    <button type="submit" class="button">搜索</button>
  </form>
  <div class="search-results" id="search-results" data-search-results aria-live="polite">
    <p class="search-results__hint">输入关键词开始搜索。可使用上下方向键选择结果，按 Enter 打开。</p>
  </div>
  <p class="search-dialog__foot"><kbd>Esc</kbd> 关闭 · <kbd>/</kbd> 打开搜索</p>
</dialog>`
}

export function renderLightbox() {
  return `<dialog class="lightbox" id="lightbox" aria-label="图片预览">
  <button class="icon-button lightbox__close" type="button" data-lightbox-close aria-label="关闭预览">${icon('close')}</button>
  <figure class="lightbox__figure">
    <img alt="" data-lightbox-image>
    <figcaption data-lightbox-caption></figcaption>
  </figure>
</dialog>`
}

export function renderDocument({
  config,
  site,
  build,
  counts,
  title,
  description,
  active = '',
  heading = '',
  headingHtml = '',
  badges = [],
  page = null,
  sourceUrl = '',
  contentHtml,
  toc = '',
  breadcrumb = '',
  homeStatus = '',
  sidebarExtra = '',
  bodyClass = '',
  isHome = false,
  index = false,
  urlPath = null,
  headExtra = '',
}) {
  const fullTitle = isHome ? `${site.name} 镜像站` : `${title} · ${site.name} 镜像站`
  const encodedPath = String(urlPath ?? '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const canonical = urlPath === null ? '' : `${config.origin}${config.base}/${encodedPath}${encodedPath ? '/' : ''}`
  const metaDescription = description || site.description
  const logo = site.logo || FALLBACK_LOGO
  const backgroundRules = []
  if (site.backgroundLight) {
    backgroundRules.push(
      `:root{--wiki-background:url("${escapeHtml(site.backgroundLight)}");--wiki-background-size:auto;--wiki-background-repeat:repeat;}`,
    )
  }
  if (site.backgroundDark) {
    backgroundRules.push(
      `html[data-theme="dark"]{--wiki-background:url("${escapeHtml(site.backgroundDark)}");--wiki-background-size:cover;--wiki-background-repeat:no-repeat;}`,
    )
  }
  const backgroundStyle = backgroundRules.length ? `<style>${backgroundRules.join('')}</style>` : ''
  return `<!doctype html>
<html lang="${site.lang}" data-base="${escapeHtml(config.base)}" data-build="${escapeHtml(build.id)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0f766e" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(site.name)} 镜像站">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:image" content="${escapeHtml(logo)}">
  <link rel="manifest" href="${config.base}/manifest.webmanifest">
  <link rel="icon" href="${site.favicon || `${config.base}/assets/favicon.svg`}">
  <link rel="apple-touch-icon" href="${config.base}/assets/icons/icon-192.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="来福 Wiki">
  <link rel="stylesheet" href="${config.base}/assets/style.css?v=${encodeURIComponent(build.id)}">
  <link rel="stylesheet" href="${config.base}/assets/wiki-common.css?v=${encodeURIComponent(build.id)}">
  ${backgroundStyle}
  ${headExtra}
  <script>(function(){try{var mode=localStorage.getItem('wiki-theme-mode');if(mode!=='system'&&mode!=='light'&&mode!=='dark'){mode='system';}var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var theme=mode==='system'?(dark?'dark':'light'):mode;document.documentElement.dataset.themeMode=mode;document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('theme-fandomdesktop-dark',theme==='dark');}catch(e){}})();</script>
</head>
<body class="${escapeHtml(bodyClass)}">
  <a class="skip-link" href="#main">跳到正文</a>
  ${renderHeader({ base: config.base, active, site, buildId: build.id })}
  <div class="layout">
    ${renderSidebar({ base: config.base, active, build, site, counts, toc, sidebarExtra })}
    <main class="main" id="main">
      ${breadcrumb}
      ${index ? '' : renderPageHead({ page: page ?? { title: heading }, sourceUrl, badges })}
      ${headingHtml ? `<header class="page-head"><h1>${headingHtml}</h1>${description ? `<p class="page-head__lede">${escapeHtml(description)}</p>` : ''}</header>` : ''}
      <article class="wiki-content">
        ${contentHtml}
      </article>
      ${homeStatus}
      ${index ? '' : renderPageFooter({ page, build, site, sourceUrl: sourceUrl || site.sourceUrl })}
    </main>
  </div>
  ${renderSiteFooter({ build, site, base: config.base })}
  <button class="back-to-top" type="button" data-back-to-top aria-label="回到顶部">${icon('arrowUp')}</button>
  ${renderSearchDialog()}
  ${renderLightbox()}
  <script src="${config.base}/assets/app.js?v=${encodeURIComponent(build.id)}" defer></script>
</body>
</html>`
}

export { FALLBACK_LOGO }
