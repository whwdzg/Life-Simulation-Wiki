import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '来福Simulation Wiki（镜像站）',
  description: '来福Simulation Wiki 的非官方静态镜像站',
  lang: 'zh-CN',
  lastUpdated: false,
  cleanUrls: true,
  ignoreDeadLinks: true,
  head: [
    ['meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }],
    ['meta', { name: 'theme-color', content: '#00665a', media: '(prefers-color-scheme: light)' }],
    ['meta', { name: 'theme-color', content: '#1a2926', media: '(prefers-color-scheme: dark)' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['link', { id: 'site-favicon', rel: 'icon', href: 'https://static.wikia.nocookie.net/lifesimulation/images/e/e6/Site-logo.png/revision/latest?cb=20251002013153&path-prefix=zh' }],
    ['link', { rel: 'manifest', href: '/manifest.json' }],
    ['link', { rel: 'preload', href: '/wiki-data/index.json', as: 'fetch', crossorigin: 'anonymous' }]
  ],
  // 镜像站是纯 SPA：所有路由都在 #/wiki/ 下，VitePress 自带的布局壳体（导航、大纲、侧边栏、页脚）
  // 由 style.css 中的 .mirror-shell 规则直接隐藏，这里也声明空配置避免默认侧边栏参与路由分析。
  themeConfig: {
    nav: [],
    sidebar: [],
    outline: false,
    footer: { message: '', copyright: '' }
  }
})
