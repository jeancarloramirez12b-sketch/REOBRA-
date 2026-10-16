import mysql, { type Pool } from 'mysql2/promise'

export type DatabaseConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export class DatabaseConfigError extends Error {
  readonly details: string[]

  constructor(details: string[]) {
    super('MySQL configuration is invalid')
    this.name = 'DatabaseConfigError'
    this.details = details
  }
}

let pool: Pool | null = null

export function readDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const details: string[] = []
  const host = env.DB_HOST?.trim() ?? ''
  const portValue = env.DB_PORT?.trim() ?? ''
  const user = env.DB_USER?.trim() ?? ''
  const database = env.DB_NAME?.trim() ?? ''
  const passwordDefined = env.DB_PASSWORD !== undefined

  if (!host) {
    details.push('DB_HOST')
  }
  if (!portValue) {
    details.push('DB_PORT')
  }
  if (!user) {
    details.push('DB_USER')
  }
  if (!passwordDefined) {
    details.push('DB_PASSWORD')
  }
  if (!database) {
    details.push('DB_NAME')
  }

  const port = Number(portValue)
  const portIsValid = Number.isInteger(port) && port >= 1 && port <= 65535
  if (portValue && !portIsValid && !details.includes('DB_PORT')) {
    details.push('DB_PORT')
  }

  if (details.length > 0 || !portIsValid) {
    throw new DatabaseConfigError(details)
  }

  return {
    host,
    port,
    user,
    password: env.DB_PASSWORD ?? '',
    database,
  }
}

export function getPool(): Pool {
  if (pool) {
    return pool
  }

  const config = readDatabaseConfig()
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 5000,
    enableKeepAlive: true,
    charset: 'utf8mb4',
  })

  return pool
}

export async function closePool(): Promise<void> {
  if (!pool) {
    return
  }

  const current = pool
  pool = null
  await current.end()
}
