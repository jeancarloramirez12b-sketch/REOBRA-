import { AppError } from '../../errors/AppError.js'
import { type AiConfig, unconfiguredMessage } from './config.js'

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }

export type ProviderResult = {
  text: string
  inputTokens: number | null
  outputTokens: number | null
  model: string
}

export type ProviderOptions = {
  timeoutMs: number
  maxOutputTokens: number
  model: string
}

export interface AiProvider {
  readonly name: string
  complete(turns: ChatTurn[], options: ProviderOptions): Promise<ProviderResult>
}

class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai'

  constructor(private readonly config: AiConfig) {}

  async complete(turns: ChatTurn[], options: ProviderOptions): Promise<ProviderResult> {
    if (!this.config.apiKey) {
      throw new AppError(503, 'AI_NOT_CONFIGURED', unconfiguredMessage())
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: turns,
          max_tokens: options.maxOutputTokens,
          temperature: 0.2,
        }),
      })
      if (!response.ok) {
        throw new AppError(502, 'AI_PROVIDER_ERROR', 'El proveedor de inteligencia artificial no respondió. Inténtalo de nuevo.')
      }
      const payload: unknown = await response.json()
      const text = readContent(payload)
      const usage = readUsage(payload)
      if (!text) {
        throw new AppError(502, 'AI_RESPONSE_INVALID', 'El proveedor no devolvió una respuesta utilizable.')
      }
      return { text, inputTokens: usage.input, outputTokens: usage.output, model: options.model }
    } catch (error) {
      if (error instanceof AppError) throw error
      if (isTimeout(error)) {
        throw new AppError(504, 'AI_TIMEOUT', 'El proveedor tardó demasiado en responder.')
      }
      throw new AppError(502, 'AI_PROVIDER_ERROR', 'El proveedor de inteligencia artificial no respondió. Inténtalo de nuevo.')
    } finally {
      clearTimeout(timer)
    }
  }
}

let testProvider: AiProvider | null = null

export function setAiProviderForTests(provider: AiProvider | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Solo las pruebas pueden sustituir el proveedor.')
  }
  testProvider = provider
}

export function resolveProvider(config: AiConfig): AiProvider | null {
  if (process.env.NODE_ENV === 'test' && testProvider) return testProvider
  if (!config.configured || !config.apiKey) return null
  return new OpenAiCompatibleProvider(config)
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function readContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('choices' in payload)) return ''
  const choices = payload.choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return ''
  const message = 'message' in choices[0] ? choices[0].message : null
  if (!message || typeof message !== 'object' || !('content' in message) || typeof message.content !== 'string') return ''
  return message.content
}

function readUsage(payload: unknown): { input: number | null; output: number | null } {
  if (!payload || typeof payload !== 'object' || !('usage' in payload) || !payload.usage || typeof payload.usage !== 'object') {
    return { input: null, output: null }
  }
  const input = 'prompt_tokens' in payload.usage ? Number(payload.usage.prompt_tokens) : null
  const output = 'completion_tokens' in payload.usage ? Number(payload.usage.completion_tokens) : null
  return {
    input: Number.isInteger(input) ? input : null,
    output: Number.isInteger(output) ? output : null,
  }
}
