// 镜像站是纯 SPA：wiki-data 驱动 #app，路由走 #/wiki/。
// 所有浏览器侧逻辑放在 enhanceApp 里；VitePress build 阶段还会在 Node 环境
// 下调用一次 enhanceApp 用于预渲染，所以要如果 typeof window === 'undefined' 直接跳过。
import { startWikiApp } from './wiki-app.js'
import './style.css'

let started = false

const boot = () => {
  if (started) return
  if (typeof window === 'undefined' || import.meta.env.SSR) return
  started = true
  document.documentElement.classList.add('mirror-shell')

  // 确保 #app 存在：docs/index.md / wiki-pages/*.md 已提供 <main id="app">；兜底一次。
  if (!document.querySelector('#app')) {
    const host = document.createElement('main')
    host.id = 'app'
    host.className = 'mirror-app'
    document.body.append(host)
  }

  startWikiApp().catch((error) => console.warn('startWikiApp failed:', error))

  // 生产构建下用 Service Worker 提供离线缓存。
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker
      .register(`${document.baseURI}sw.js`, { scope: document.baseURI })
      .catch((error) => console.warn('Service worker registration failed:', error))
  }
}

export default {
  enhanceApp() {
    boot()
  },
}