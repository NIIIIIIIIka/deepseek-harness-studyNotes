import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { pathToFileURL } from 'node:url'

const ctx = new Context()
ctx.baseUrl = `${pathToFileURL(process.cwd()).href}/`

ctx.logger.exporter({
  colors: 0,
  export: (message) => {
    const text = message.args
      .map((arg) => arg instanceof Error ? (arg.stack ?? arg.message) : String(arg))
      .join(' ')
    console.log(`[${message.name}] ${text}`)
  },
})

const FiberState = {
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  UNLOADING: 4,
  DISPOSED: 5,
} as const

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@deepseek-ai/cordis-plugin-include',
  config: { path: './cordis.yml' },
})
await ctx.loader.await()

let hasFailure = false
for (const runtime of ctx.registry.values()) {
  for (const fiber of runtime.fibers) {
    if (fiber.state === FiberState.ACTIVE) continue
    if (fiber.state === FiberState.PENDING) {
      console.log(`[launcher] 插件未激活（PENDING，可能在等待依赖）：${fiber.name}`)
    } else if (fiber.state === FiberState.FAILED) {
      console.log(`[launcher] 插件加载失败（FAILED）：${fiber.name}`)
      hasFailure = true
    }
  }
}

if (hasFailure) process.exitCode = 1
