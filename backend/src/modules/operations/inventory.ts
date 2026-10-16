import type { RowDataPacket } from 'mysql2'
import type { PoolConnection } from 'mysql2/promise'
import { AppError } from '../../errors/AppError.js'
import { queryRows } from '../../utils/sql.js'

export type Availability = {
  quantity: number
  delivered: number
  committed: number
  available: number
}

function decimal(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    throw new AppError(500, 'INVALID_QUANTITY', 'Hay una cantidad que no se puede leer.')
  }
  return Math.round(number * 1000) / 1000
}

export async function lockAvailability(connection: PoolConnection, materialId: number): Promise<Availability> {
  const locked = await queryRows<RowDataPacket>(
    connection,
    'SELECT quantity FROM materials WHERE id = ? FOR UPDATE',
    [materialId],
  )
  if (!locked[0]) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
  }
  const deliveredRows = await queryRows<RowDataPacket>(
    connection,
    `SELECT COALESCE(SUM(d.delivered_quantity), 0) AS total
     FROM deliveries d
     INNER JOIN material_requests r ON r.id = d.request_id
     WHERE r.material_id = ? AND d.status = 'delivered'`,
    [materialId],
  )
  const committedRows = await queryRows<RowDataPacket>(
    connection,
    `SELECT COALESCE(SUM(GREATEST(r.requested_quantity - COALESCE(done.total_delivered, 0), 0)), 0) AS total
     FROM material_requests r
     LEFT JOIN (
       SELECT request_id, SUM(delivered_quantity) AS total_delivered
       FROM deliveries
       WHERE status = 'delivered'
       GROUP BY request_id
     ) done ON done.request_id = r.id
     WHERE r.material_id = ? AND r.status IN ('accepted', 'partially_fulfilled')`,
    [materialId],
  )
  const quantity = decimal(locked[0].quantity)
  const delivered = decimal(deliveredRows[0]?.total ?? 0)
  const committed = decimal(committedRows[0]?.total ?? 0)
  return {
    quantity,
    delivered,
    committed,
    available: decimal(quantity - delivered - committed),
  }
}
