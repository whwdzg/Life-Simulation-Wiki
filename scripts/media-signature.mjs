import { createHash } from 'node:crypto'
import { WikiApi } from '../src/lib/api.mjs'
import { loadConfig } from '../src/lib/config.mjs'
import { createLogger } from '../src/lib/util.mjs'

const logger = createLogger('signature')

async function main() {
  const config = loadConfig()
  const api = new WikiApi({ apiUrl: config.apiUrl, userAgent: config.userAgent, logger })
  const images = await api.allImages()
  const signature = createHash('sha256')
    .update(
      images
        .map((image) => `${image.name}|${image.timestamp}|${image.url}|${image.size}|${image.mime}|${image.sha1 ?? ''}`)
        .sort()
        .join('\n'),
    )
    .digest('hex')
  process.stdout.write(`${signature}\n`)
  console.error(`[signature] 媒体清单签名：${signature.slice(0, 16)}…（${images.length} 个文件）`)
}

main().catch((error) => {
  logger.error(error)
  process.exitCode = 1
})
