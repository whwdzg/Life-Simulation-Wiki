import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectWiki } from '../src/lib/collect.mjs'
import { loadConfig, SITE } from '../src/lib/config.mjs'
import { generateSite } from '../src/lib/generate.mjs'
import { createLogger, formatDuration } from '../src/lib/util.mjs'
import { formatDateTime } from '../src/lib/format.mjs'

const logger = createLogger('build')

async function main() {
  const startedAt = Date.now()
  const config = loadConfig()
  logger.info(`${SITE.name} 静态镜像构建开始`)
  logger.info(`API: ${config.apiUrl}`)
  logger.info(`输出: ${config.outDir}`)
  logger.info(`站点路径: ${config.base || '/'} · 站点源: ${config.origin}`)

  await rm(config.outDir, { recursive: true, force: true })
  await mkdir(config.cacheDir, { recursive: true })
  await mkdir(config.outDir, { recursive: true })

  const data = await collectWiki(config, { logger })
  logger.info(`页面数据抓取完成，用时 ${formatDuration(Date.now() - startedAt)}`)

  const result = await generateSite({
    config,
    data,
    buildStartedAt: startedAt,
    logger,
  })

  const duration = Date.now() - startedAt
  const summary = {
    generatedAt: new Date().toISOString(),
    generatedAtLocal: formatDateTime(new Date()),
    durationMs: duration,
    base: config.base,
    origin: config.origin,
    pages: result.build.pages,
    failedPages: result.build.failedPages,
    media: result.build.media,
    parseFailures: result.build.parseFailures,
    remoteMedia: result.build.remoteMedia,
    requestCount: result.build.requestCount,
    runUrl: config.runUrl,
  }
  await writeFile(join(config.cacheDir, 'last-build.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(join(config.outDir, 'build-info.json'), `${JSON.stringify(summary, null, 2)}\n`)

  logger.info(
    `构建完成：${result.build.pages} 页（失败 ${result.build.failedPages}）、${result.build.media.files} 个媒体文件（${result.build.media.assets} 个资源，${formatDuration(duration)}）`,
  )
  if (config.runUrl) logger.info(`Actions: ${config.runUrl}`)
}

main().catch((error) => {
  logger.error(error)
  process.exitCode = 1
})
