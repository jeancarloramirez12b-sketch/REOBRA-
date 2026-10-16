import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { insertRow, type SqlExecutor } from '../../utils/sql.js'

export const traceEventTypes = [
  'registered',
  'details_updated',
  'assessment_recorded',
  'passport_issued',
  'passport_revised',
  'request_created',
  'request_updated',
  'delivery_recorded',
  'availability_changed',
  'note',
  'evidence_added',
  'evidence_removed',
  'visibility_changed',
] as const

export type TraceEventType = (typeof traceEventTypes)[number]

export type TraceEventInput = {
  materialId: number
  actorUserId: number | null
  organizationId: number | null
  eventType: TraceEventType
  description: string
  operationKey: string
  metadata?: Record<string, string | number | boolean | null>
}

export function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && String(error.code) === 'ER_DUP_ENTRY'
}

export async function recordTraceEvent(executor: SqlExecutor, input: TraceEventInput): Promise<'recorded' | 'duplicate'> {
  const description = input.description.trim()
  if (description.length === 0 || description.length > 2000) {
    throw new AppError(400, 'INVALID_INPUT', 'El evento de trazabilidad no tiene un resumen válido.')
  }
  if (!/^[a-z0-9:_-]{8,80}$/i.test(input.operationKey)) {
    throw new AppError(400, 'INVALID_INPUT', 'La clave de operación no es válida.')
  }

  try {
    await insertRow(
      executor,
      `INSERT INTO material_trace_events (
         material_id, actor_user_id, organization_id, event_type, description, event_timestamp, metadata_json, operation_key
       ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?, ?)`,
      [
        input.materialId,
        input.actorUserId,
        input.organizationId,
        input.eventType,
        description,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.operationKey,
      ],
    )
    return 'recorded'
  } catch (error) {
    if (isDuplicateKey(error)) {
      return 'duplicate'
    }
    throw error
  }
}

export type TraceEventRow = RowDataPacket & {
  id: number
  event_type: string
  description: string
  event_timestamp: string
  actor_name: string | null
  organization_name: string | null
  metadata_json: unknown
}
