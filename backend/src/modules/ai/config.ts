export type AiConfig = {
  enabled: boolean
  provider: 'none' | 'openai'
  model: string
  apiKey: string | null
  baseUrl: string
  timeoutMs: number
  maxInputChars: number
  maxOutputTokens: number
  userHourlyLimit: number
  orgHourlyLimit: number
  configured: boolean
}

const notConfiguredMessage = 'Servicio de inteligencia artificial no configurado'

function integerBetween(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value?.trim() ?? '')
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

export function parseAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const enabled = env.AI_ENABLED?.trim().toLowerCase() === 'true'
  const requested = env.AI_PROVIDER?.trim().toLowerCase() ?? ''
  const provider = requested === 'openai' ? 'openai' : 'none'
  const apiKey = env.AI_API_KEY?.trim() || null
  const model = env.AI_MODEL?.trim() || 'gpt-4o-mini'
  const baseUrl = (env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '')
  const configured = enabled && provider === 'openai' && Boolean(apiKey) && model.length > 0 && baseUrl.startsWith('https://')
  return {
    enabled,
    provider: configured ? 'openai' : 'none',
    model,
    apiKey: configured ? apiKey : null,
    baseUrl,
    timeoutMs: integerBetween(env.AI_TIMEOUT_MS, 20000, 1000, 60000),
    maxInputChars: integerBetween(env.AI_MAX_INPUT_CHARS, 2000, 200, 4000),
    maxOutputTokens: integerBetween(env.AI_MAX_OUTPUT_TOKENS, 800, 64, 4000),
    userHourlyLimit: integerBetween(env.AI_USER_HOURLY_LIMIT, 30, 1, 500),
    orgHourlyLimit: integerBetween(env.AI_ORG_HOURLY_LIMIT, 200, 1, 5000),
    configured,
  }
}

export function getAiConfig(): AiConfig {
  return parseAiConfig(process.env)
}

export function unconfiguredMessage(): string {
  return notConfiguredMessage
}
