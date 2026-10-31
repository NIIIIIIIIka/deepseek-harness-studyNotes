import type { Context } from '@deepseek-ai/cordis'
import { Llm, type GenerateOptions, type StreamChunk } from './llm.ts'

export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

export function toolCallResponse(id: string, name: string, args: object): StreamChunk[] {
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 0, id, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

export const name = 'llm-mock'

export class MockAdapter extends Llm {
  constructor(
    ctx: Context,
    private script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]))[],
  ) {
    super(ctx)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (!entry) throw new Error('MockAdapter: 剧本用完了')
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) yield chunk
  }
}

export function apply(ctx: Context) {
  ctx.plugin(MockAdapter, [
    textResponse('你好，我是假模型。'),
    toolCallResponse('call-1', 'get_weather', { city: '北京' }),

    // 作业修改：从 GenerateOptions 读取真实的消息数量并生成响应。
    (options) => textResponse(`我收到 ${options.messages.length} 条消息`),
  ])
}
