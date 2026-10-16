import { DatabaseConfigError, getPool } from '../config/database.js'
import { AppError } from '../errors/AppError.js'

function databaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code
    if (typeof code === 'string' && code.trim()) {
      return code
    }
  }

  return 'UNKNOWN'
}

export async function checkDatabaseConnection(): Promise<{ status: 'ok' }> {
  try {
    const pool = getPool()
    await pool.query('SELECT 1 AS ok')
    return { status: 'ok' }
  } catch (error) {
    if (error instanceof DatabaseConfigError) {
      throw new AppError(
        503,
        'DATABASE_NOT_CONFIGURED',
        `La configuración de MySQL está incompleta o no es válida (${error.details.join(', ')}).`,
      )
    }

    if (error instanceof AppError) {
      throw error
    }

    console.error(`[database] No se pudo conectar con MySQL (${databaseErrorCode(error)}).`)
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'No se pudo establecer la conexión con MySQL.')
  }
}
