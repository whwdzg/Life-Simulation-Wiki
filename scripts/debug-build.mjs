import { build } from 'vitepress'

try {
  await build('docs')
} catch (error) {
  console.error('[debug-build] full error:', error)
  process.exit(1)
}