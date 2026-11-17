import { resolve } from 'node:path'

export const SITE = {
  name: '来福Simulation Wiki',
  title: '来福Simulation Wiki 镜像站',
  description: '来福Simulation Wiki 的非官方静态镜像站，每小时自动同步条目、模板与图片，可离线浏览。',
  lang: 'zh-CN',
  apiUrl: 'https://lifesimulation.fandom.com/zh/api.php',
  sourceUrl: 'https://lifesimulation.fandom.com/zh/wiki/%E6%9D%A5%E7%A6%8FSimulation_Wiki',
  sourceOrigin: 'https://lifesimulation.fandom.com',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/deed.zh-hans',
  repository: 'https://github.com/whwdzg/Life-Simulation-Wiki',
}

/** Namespaces mirrored by the static site. */
export const MIRRORED_NAMESPACES = [0, 2, 4, 6, 10, 14, 502, 828, 2900]

const NAMESPACE_LABELS = {
  0: '条目',
  2: '用户',
  4: '项目',
  6: '文件',
  10: '模板',
  14: '分类',
  502: '博客',
  828: '模块',
  2900: '地图',
}

export const namespaceLabel = (ns) => NAMESPACE_LABELS[ns] ?? `命名空间 ${ns}`

/** Normalize SITE_BASE ("/repo/", "repo", "/") to "" or "/repo". */
export function normalizeBase(value) {
  let base = String(value ?? '').trim()
  if (!base || base === '/') return ''
  if (!base.startsWith('/')) base = `/${base}`
  return base.replace(/\/+$/, '')
}

export function normalizeOrigin(value) {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

function positiveInt(value, fallback, max = 16) {
  const number = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(number, max)
}

export function loadConfig(env = process.env) {
  return {
    apiUrl: env.WIKI_API || SITE.apiUrl,
    base: normalizeBase(env.SITE_BASE ?? '/'),
    origin: normalizeOrigin(env.SITE_ORIGIN || 'http://localhost:5173'),
    outDir: resolve(env.OUT_DIR || 'dist'),
    cacheDir: resolve(env.CACHE_DIR || '.cache'),
    concurrency: positiveInt(env.SYNC_CONCURRENCY, 6),
    mediaConcurrency: positiveInt(env.MEDIA_CONCURRENCY, 8),
    namespaces: MIRRORED_NAMESPACES,
    pageLimit: env.PAGE_LIMIT ? Number.parseInt(env.PAGE_LIMIT, 10) : 0,
    skipMedia: env.SKIP_MEDIA === '1',
    userAgent:
      env.WIKI_USER_AGENT ||
      'LifeSimulationWikiMirror/1.0 (+https://github.com/whwdzg/Life-Simulation-Wiki; static mirror)',
    runUrl: env.GITHUB_RUN_URL || '',
    repository: env.GITHUB_REPOSITORY || 'whwdzg/Life-Simulation-Wiki',
    revision: env.GITHUB_SHA || '',
    now: env.MIRROR_NOW ? new Date(env.MIRROR_NOW) : new Date(),
  }
}
