# DeepSeek Harness 学习笔记：Part 0–Part 1

> 原教程版本：DeepSeek Harness `v0.2.1-alpha.1`（`dsh-v0.2.1-alpha.1`，提交 `5badb150`）  
> 核心主题：TypeScript 阅读基础 + Cordis 插件内核

## 0. 总览：先建立一张心智地图

DeepSeek Harness 是一个 AI Agent 运行时，核心设计哲学是：**一切皆插件（Everything is a plugin）**。

它的底层框架 Cordis 只有三个核心概念：

1. **插件（plugin）**：描述“我要为应用贡献什么能力”。
2. **上下文（context / `ctx`）**：共享的能力仓库；插件从中取能力，也向其中注册能力。
3. **组合（composition）**：通过 `cordis.yml` 声明应用由哪些插件组成。

可以把整个运行机制压缩成下面这条链：

```text
cordis.yml
   ↓ Loader 加载
插件 apply(ctx, config)
   ├─ 注册服务到 ctx
   ├─ 监听/触发事件
   └─ 注册 effect 与清理逻辑
             ↓
       fiber 管理生命周期
```

Part 1 后半部分的工具、模型、记忆和 Agent Loop，本质上仍是：**把服务放入 `ctx`，再用事件和生命周期把它们组合起来。**

---

## Part 0：给 JavaScript 学习者的 TypeScript 速查

### 0.1 TypeScript 的本质

TypeScript 是 JavaScript 的超集。类型标注只在开发和编译阶段存在，运行时会被擦除：

```ts
const name: string = 'cordis'
const tags: string[] = ['plugin', 'service']

function greet(who: string): string {
  return `Hello, ${who}!`
}
```

类型不会改变程序行为，但能提前发现错误。

### 0.2 `interface` 与 `type`

`interface` 常用于描述对象形状：

```ts
interface Config {
  greeting: string
  targets: string[]
  description?: string
}
```

`?` 表示可选，因此 `description` 的实际类型是 `string | undefined`。

`type` 常用于类型别名和联合类型：

```ts
type Mode = 'native' | 'ptc'
```

联合类型表示“只能是这些值之一”。

### 0.3 `import type`：只引入类型

```ts
import type { Context } from '@deepseek-ai/cordis'
```

- 只用于 `: Context` 等类型位置时，用 `import type`。
- 需要 `new Service()`、继承类或调用运行时值时，用普通 `import`。
- `import type` 编译后会消失，不产生运行时依赖。

特殊用法：

```ts
import type {} from './stats.ts'
```

这不会导入任何运行时值，只是让 TypeScript 加载该文件里的声明合并。

### 0.4 声明合并：编译期和运行期要配套

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}
```

这段代码只告诉 TypeScript：`ctx.greeter` 合法；它不会真的创建 `greeter`。

真正的运行时注册来自：

```ts
super(ctx, 'greeter')
```

因此要牢牢记住：

```text
declare module  → 编译期：让类型系统认识服务
super(ctx, ...) → 运行期：真的把服务注册到 ctx
```

只写前者会导致运行时没值；只写后者则代码能跑，但类型检查报错。

### 0.5 泛型、Promise 与异步生成器

```ts
const Config: Schema<MyConfig> = Schema.object({ ... })
```

`<MyConfig>` 表示把类型参数传给 `Schema`，从而让校验器记住它校验的数据形状。

普通异步函数：

```ts
async function load(): Promise<string> {
  return 'done'
}
```

流式输出使用异步生成器：

```ts
async function* stream(): AsyncIterable<string> {
  yield '你'
  yield '好'
}

for await (const chunk of stream()) {
  console.log(chunk)
}
```

---

## Part 1：Cordis 插件内核

## 1. 第一个插件：插件只描述“贡献什么”

最小插件：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

对应配置：

```yaml
- name: './main.ts'
```

启动过程：

1. 启动器创建根 `Context`。
2. 挂载 Loader。
3. Loader 读取 `cordis.yml`。
4. Loader 加载模块并调用 `apply(ctx)`。

插件可以有三种形态：

- 对象插件：模块导出 `apply`，最常用，可同时携带 `name`、`inject`、`Config` 等元数据。
- 函数插件：默认导出一个函数。
- 类插件：继承 `Service`，既是插件入口，也是服务实例。

关键结论：**应用的 bootstrap 在配置中，插件代码只声明自己的贡献。**

易错点：YAML 中模块路径拼错时，错误可能只进入尚未输出到控制台的 logger，表现为“什么都没发生”。先检查拼写。

## 2. 生命周期：注册即效果（effect）

Cordis 的核心承诺是：**插件注册的资源会在插件卸载时自动回收。**

对于 Cordis 不认识的外部资源，需要手动登记：

```ts
ctx.effect(() => {
  const timer = setInterval(() => console.log('heartbeat'), 100)

  return () => clearInterval(timer)
}, 'heartbeat-timer')
```

规则：

- effect 执行体立即运行。
- 返回值是清理函数（disposer）。
- 插件卸载时，清理函数按注册的**相反顺序**执行，即后进先出。
- 逆序清理可以先拆依赖方，再拆被依赖资源。

以下注册本身已经是 effect，无需重复包装：

| 注册方式 | 卸载时自动行为 |
|---|---|
| `ctx.on(...)` | 移除监听器 |
| `ctx.plugin(...)` | 卸载子插件树 |
| `ctx.set(...)` | 移除服务 |
| `ctx.effect(...)` | 执行返回的 disposer |

主动卸载当前插件：

```ts
await ctx.fiber.dispose()
```

状态变化为：`UNLOADING → 逆序清理 → DISPOSED`。

如果定时器、WebSocket、`fs.watch` 等未放入 effect，插件虽然“卸载”了，资源仍会存活，甚至阻止 Node 进程退出。

## 3. 服务：通过 `ctx` 共享具名能力

服务提供方：

```ts
export class Counter extends Service {
  private count = 0

  constructor(ctx: Context) {
    super(ctx, 'counter')
  }

  increment() {
    return ++this.count
  }
}

export function apply(ctx: Context) {
  ctx.plugin(Counter)
}
```

服务消费方：

```ts
export const inject = ['counter']

export function apply(ctx: Context) {
  ctx.counter.increment()
}
```

其中：

- `super(ctx, 'counter')` 把服务实例注册为 `ctx.counter`。
- 服务注册也是 effect，提供方卸载后服务自动消失。
- `inject` 声明硬依赖；服务尚不存在时，插件保持 `PENDING`，不会运行一半再失败。
- 启动顺序由依赖图决定，而不是 YAML 中的书写顺序。

服务名位于全局扁平命名空间。自定义插件最好使用带项目前缀的名称，避免与 `llm`、`tools`、`session` 等内置服务冲突。

## 4. 事件：让互不认识的插件通信

服务是“我知道对方名字，直接调用”；事件是“我只发消息，不关心谁监听”。

```ts
ctx.emit('stats/report', name, count)

ctx.on('stats/report', (name, count) => {
  console.log(name, count)
})
```

事件也可以通过声明合并获得类型检查：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}
```

建议事件名采用 `命名空间/动作`，例如 `stats/report`、`session/event`。

五种分发模式：

| 模式 | 语义 | 适用场景 |
|---|---|---|
| `emit` | 同步广播，不等待、不收集返回值 | 通知多个观察者 |
| `parallel` | 所有监听器并发执行并等待结束 | 并行处理多方任务 |
| `serial` | 顺序执行，第一个有返回值者胜出 | 异步“谁先回答算谁” |
| `bail` | `serial` 的同步版本 | 同步拦截或查询 |
| `waterfall` | 中间件链，可包装、修改或截断结果 | 可插拔决策流程 |

`waterfall` 的核心是 `next()`：

```ts
ctx.on('demo/transform', async (input, next) => {
  const result = await next()
  return result.toUpperCase()
})
```

- 调用 `next()`：继续执行下游。
- 不调用 `next()` 而直接返回：有意短路，后续逻辑全部跳过。

最危险的 bug：观察型监听器忘记调用 `next()`，无意中吞掉整个下游流程。

## 5. 配置：类型、默认值和运行时验证统一

```ts
export interface Config {
  greeting: string
  targets: string[]
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export function apply(ctx: Context, config: Config) {
  // config 已完成校验并补齐默认值
}
```

这里两个 `Config` 可以同名，因为 TypeScript 的类型空间和值空间彼此独立：

- `interface Config`：给 TypeScript 检查，编译后消失。
- `const Config`：运行时 schema，给 Cordis 验证配置。

配置从 `cordis.yml` 传入：

```yaml
- name: './main.ts'
  config:
    targets: ['alpha', 'beta']
```

关键原则：

- 默认值由 schema 补齐，不在 `apply` 中零散兜底。
- 配置无效时，fiber 进入 `FAILED`，`apply` 不执行。
- 配置错误必须“响亮地失败”，不能带着错误假设继续运行。
- 配置通过参数传入而非全局读取，因此易测试，也能被 profile 或父级组合覆盖。

## 6. 组合：`cordis.yml` 就是应用本身

一个完整条目可以包含：

```yaml
- id: greeter
  name: './greeter.ts'
  config:
    greeting: 'Hello'
  disabled: false
```

- `id`：稳定身份，帮助 Loader 判断条目是被修改还是被替换；正式项目应为每个条目设置。
- `name`：模块路径或包名。
- `config`：插件配置。
- `disabled`：保留配置但卸载插件，适合调试。

插件还可以分组、嵌套；`isolate` 可让不同组获得同名服务的独立实例。

### PENDING：最常见的“静默无反应”

```ts
export const inject = ['timer']
```

如果无人提供 `timer`，插件不会报错，而会保持 `PENDING`。提供方随后出现时，插件会被自动唤醒。

诊断思路：遍历 `ctx.registry.values()`，检查每个 runtime 下的 `fiber.state`。

### HMR 的本质

热替换并非另一套机制，而是：

1. 配置或文件发生变化。
2. 卸载旧 fiber，逆序回卷全部 effect。
3. 加载新代码，重新运行 `apply`。

因此，**所有资源都正确登记为 effect，是安全热替换的前提。**

## 7. 能力接缝：定义、提供、消费三者分离

一条 capability seam 有三个角色：

| 角色 | 职责 |
|---|---|
| Service Definition | 定义能力名称和方法签名 |
| Provider | 提供一种具体实现，可有多个 |
| Consumer | 只依赖抽象能力，不认识具体实现 |

能力定义：

```ts
export abstract class Notifier extends Service {
  constructor(ctx: Context) {
    super(ctx, 'notifier')
  }

  abstract send(message: string): void
}
```

注意：定义文件只充当“词汇表”，通常不写入 `cordis.yml`；配置中加载的是某个具体 Provider。

这样做的价值是：把控制台通知换成邮件、Webhook 或大写版通知时，只需要增加 Provider 并修改配置，Consumer 不需要改动。

Harness 中的典型接缝：

| 接缝 | 可能的 Provider | Consumer |
|---|---|---|
| `shell` | 本机 Bash、沙箱 Bash | Bash 工具插件 |
| `llm` | DeepSeek、OpenAI、MockAdapter | Agent Loop |
| `tools` | 各种工具插件 | Agent Loop |
| `session` | 本地或其他持久化实现 | 多数业务插件 |

## 8. 诊断：先看 fiber 状态机

每个插件运行时都是一个 fiber，状态包括：

```text
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
              ↓
            FAILED
```

| 状态 | 含义 | 首要检查 |
|---|---|---|
| `PENDING` | 正等待依赖服务 | 哪个 `inject` 没有 Provider |
| `LOADING` | `apply` 或构造函数正在执行 | 是否异步卡住 |
| `ACTIVE` | 正常运行 | 无需处理 |
| `FAILED` | 加载抛错 | logger 中的原始错误 |
| `UNLOADING` | 正在清理 effect | 是否有清理逻辑卡住 |
| `DISPOSED` | 已彻底卸载 | 是否被意外卸载 |

一个插件失败时：

1. 错误写入 logger。
2. 当前 fiber 进入 `FAILED`。
3. 已注册 effect 自动回卷。
4. 其他插件继续运行。

动态挂载或测试时可主动捕获启动错误：

```ts
const fiber = ctx.plugin(BrokenPlugin)

await fiber.await().catch((error) => {
  console.log(error.message)
})
```

推荐排错顺序：

1. 看 registry：谁不是 `ACTIVE`？
2. 看日志：是否配置了 console exporter，原始错误是什么？
3. 看 effect 树：`fiber.getEffects()` 中有哪些资源、由谁注册、为何未清理？

注意：npm 包中的 `FiberState` 是 `const enum`，可能没有运行时导出。教程因此直接使用数字状态值；不要想当然地在运行时 import 它。

## 9. 假 LLM：用标准流式协议搭桥

这一课把“能力接缝”应用到模型调用：

- Definition：抽象 `Llm` 服务。
- Provider：按剧本返回数据的 `MockAdapter`。
- Consumer：使用 `for await` 消费流的调用方。

```ts
export abstract class Llm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

典型流式顺序：

```text
block-start
  → text-delta / reasoning-delta / tool-call-delta（若干）
  → block-end
  → usage
  → finish
```

`StreamChunk` 使用判别联合：

```ts
type StreamChunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'finish'; reason: { kind: 'stop' | 'tool-calls' | 'max-tokens' | 'error' } }
  // 其他 chunk...
```

消费方使用：

```ts
for await (const chunk of ctx.llm.stream(options)) {
  switch (chunk.type) {
    case 'text-delta':
      // 处理文字增量
      break
    case 'tool-call-delta':
      // 按 id 和 index 累积参数片段
      break
  }
}
```

工具调用参数可能分成多个 `argumentsDelta`，后续片段甚至不再携带 `name`。因此消费方必须按 `id` / `index` 聚合片段，不能把单条 delta 当成完整调用。

MockAdapter 的意义：

- 不需要 API Key 和网络。
- 输出完全可控，可重复测试。
- 能在接入真实模型前验证 Agent Loop、工具调用和错误处理。
- 因 Consumer 依赖的是 `llm` 抽象，换真实 Provider 时无需修改 Agent Loop。

---

## Part 1 的核心关系

| 机制 | 解决的问题 | 关键 API / 写法 |
|---|---|---|
| 插件 | 能力如何进入应用 | `apply(ctx, config)`、`ctx.plugin()` |
| effect | 资源如何自动清理 | `ctx.effect()`、disposer |
| 服务 | 插件如何直接共享能力 | `Service`、`super(ctx, name)`、`inject` |
| 事件 | 陌生插件如何松耦合通信 | `on`、`emit`、`parallel`、`waterfall` |
| 配置 | 如何校验并补齐外部参数 | `interface Config` + `const Config: Schema<Config>` |
| 组合 | 如何声明整个应用 | `cordis.yml`、`id`、`disabled` |
| 接缝 | 如何替换实现而不改消费方 | Definition / Provider / Consumer |
| fiber | 如何管理插件状态与故障隔离 | `state`、`await()`、`dispose()` |
| 流式协议 | 如何逐步传递模型输出 | `AsyncIterable`、`yield`、`for await` |

## 一套实用检查清单

写一个新插件时：

- 是否导出了 `apply`，或使用了正确的类/函数插件形态？
- 服务是否同时完成运行时注册和 `Context` 声明合并？
- 硬依赖是否写入 `inject`？
- 定时器、连接、watcher 等外部资源是否包在 `ctx.effect` 中？
- 事件是否声明了类型，命名是否采用 `命名空间/动作`？
- `waterfall` 观察者是否调用了 `next()`？
- 配置是否由 schema 验证并补默认值？
- `cordis.yml` 条目是否有稳定 `id`？
- 是否通过抽象服务隔离了 Provider 与 Consumer？

应用“没反应”时：

1. 检查 YAML 路径和模块名拼写。
2. 检查 fiber 是否 `PENDING`，以及缺少哪个依赖。
3. 检查 fiber 是否 `FAILED`，读取 logger 原始错误。
4. 确认 logger 有 console exporter。
5. 检查 effect 树和清理逻辑。

## 一句话总结

Part 0 教你读懂 Cordis 使用的 TypeScript；Part 1 则建立了 Harness 的完整地基：**插件负责贡献能力，`ctx` 负责连接能力，effect 管生命周期，服务和事件管通信，YAML 管组合，fiber 管状态与故障，而能力接缝保证实现可以替换。**

## 资料来源

- [教程在线版](https://bald0wang.github.io/deepseek-harness-notes/)
- [教程 GitHub 仓库](https://github.com/Relph1119/deepseek-harness-notes)

