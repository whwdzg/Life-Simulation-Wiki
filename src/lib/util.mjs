export async function mapConcurrent(items, limit, mapper) {
  const list = [...items]
  const results = new Array(list.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (nextIndex < list.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(list[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export const formatBytes = (bytes) => {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

export const formatDuration = (milliseconds) => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

export function createLogger(prefix = 'mirror') {
  const started = Date.now()
  const stamp = () => {
    const elapsed = Math.round((Date.now() - started) / 1000)
    return `[${prefix} +${elapsed}s]`
  }
  return {
    info: (...args) => console.log(stamp(), ...args),
    warn: (...args) => console.warn(stamp(), ...args),
    error: (...args) => console.error(stamp(), ...args),
    started,
  }
}

export async function mapPool(items, limit, worker) {
  const queue = [...items]
  const failures = []
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
      while (queue.length) {
        const item = queue.shift()
        try {
          await worker(item)
        } catch (error) {
          failures.push({ item, error })
        }
      }
    }),
  )
  return failures
}
