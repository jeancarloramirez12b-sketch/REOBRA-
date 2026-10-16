import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import type { Pool, PoolConnection } from 'mysql2/promise'
import { getPool } from '../config/database.js'

export type SqlExecutor = Pool | PoolConnection

export async function queryRows<T extends RowDataPacket>(
  executor: SqlExecutor,
  statement: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await executor.query<T[]>(statement, params)
  return rows
}

export async function insertRow(executor: SqlExecutor, statement: string, params: unknown[] = []): Promise<number> {
  const [result] = await executor.query<ResultSetHeader>(statement, params)
  return Number(result.insertId)
}

export async function withTransaction<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection()

  try {
    await connection.beginTransaction()
    const result = await run(connection)
    await connection.commit()
    return result
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // La transacción ya fue cerrada por el servidor.
    }
    throw error
  } finally {
    connection.release()
  }
}
