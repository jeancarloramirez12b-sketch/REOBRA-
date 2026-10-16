import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

dotenv.config({ path: path.join(backendRoot, '.env') })

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  frontendOrigin: string
}

let cachedConfig: AppConfig | null = null

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const errors: string[] = []

  const nodeEnvValue = env.NODE_ENV?.trim() || 'development'
  const nodeEnv =
    nodeEnvValue === 'development' || nodeEnvValue === 'test' || nodeEnvValue === 'production'
      ? nodeEnvValue
      : null

  if (!nodeEnv) {
    errors.push('NODE_ENV debe ser development, test o production.')
  }

  const portValue = env.PORT?.trim() ?? ''
  const port = Number(portValue)
  if (!portValue || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT debe ser un número entero entre 1 y 65535.')
  }

  const originValue = env.FRONTEND_ORIGIN?.trim() ?? ''
  let frontendOrigin = ''
  if (!originValue) {
    errors.push('FRONTEND_ORIGIN es obligatorio. Ejemplo: http://localhost:5173')
  } else {
    try {
      const url = new URL(originValue)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push('FRONTEND_ORIGIN debe usar el protocolo http o https.')
      } else {
        frontendOrigin = url.origin
      }
    } catch {
      errors.push('FRONTEND_ORIGIN debe ser una URL válida. Ejemplo: http://localhost:5173')
    }
  }

  if (!nodeEnv || !frontendOrigin || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Configuración inválida del backend:\n- ${errors.join('\n- ')}`)
  }

  return {
    nodeEnv,
    port,
    frontendOrigin,
  }
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = parseConfig(process.env)
  }

  return cachedConfig
}
