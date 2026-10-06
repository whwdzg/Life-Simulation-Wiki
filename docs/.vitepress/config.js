import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '来福Simulation Wiki（镜像站）',
  description: '来福Simulation Wiki 的非官方静态镜像站',
  base: './',
  head: [
    ['link', { id: 'site-favicon', rel: 'icon', href: 'https://static.wikia.nocookie.net/lifesimulation/images/e/e6/Site-logo.png/revision/latest?cb=20251002013153&path-prefix=zh' }],
  ],
})
