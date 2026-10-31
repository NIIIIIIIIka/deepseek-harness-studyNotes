# Part 1 / 09：假 LLM 服务作业

## 作业要求

按照[上游第 09 课](https://github.com/Relph1119/deepseek-harness-notes/tree/master/lessons/part1/09-fake-llm)的“动手改一改”，让动态剧本根据 `GenerateOptions.messages.length` 返回收到的消息数量：

```ts
(options) => textResponse(`我收到 ${options.messages.length} 条消息`)
```

## 完成方式

保留上游示例的前两段剧本：

1. 普通文字流式响应。
2. 参数被拆分为两个 delta 的工具调用。
3. 将第三段动态剧本改为读取 `options.messages.length`。

这样可以同时验证文字流、工具调用流，以及 Provider 对 `GenerateOptions` 的访问。

## 运行

需要 Node.js `^22.19 || >=24` 和 pnpm：

```bash
cd homework/part1/09-fake-llm
pnpm install
pnpm check
pnpm start
```

第三段输出应包含：

```text
我收到 1 条消息
--- 内容块结束：文字 "我收到 1 条消息" ---
[结束] 原因：stop
```

每次请求在 `main.ts` 中只构造了一条 user 消息，所以动态剧本得到的 `messages.length` 为 `1`。
