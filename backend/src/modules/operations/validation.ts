import { z } from 'zod'
import { AppError } from '../../errors/AppError.js'
import { logisticsModes } from './states.js'

function parseSchema<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'La solicitud tiene datos inválidos.')
  }
  return parsed.data
}

const quantity = z.coerce.number({ errorMap: () => ({ message: 'La cantidad no es válida.' }) }).positive('La cantidad debe ser mayor que cero.')

const createSchema = z.object({
  materialId: z.coerce.number().int().positive(),
  needId: z.coerce.number().int().positive(),
  quantity,
  message: z.string().trim().min(1, 'El mensaje no puede estar vacío.').max(2000).optional(),
  submit: z.boolean().optional(),
})

export function parseCreateOperation(value: unknown): z.output<typeof createSchema> {
  return parseSchema(createSchema, value)
}

export function parseCounteroffer(value: unknown): { quantity: number; conditions?: string } {
  return parseSchema(
    z.object({
      quantity,
      conditions: z.string().trim().min(1).max(2000).optional(),
    }),
    value,
  )
}

export function parseLogistics(value: unknown): {
  mode: (typeof logisticsModes)[number]
  originCity?: string
  originDepartment?: string
  destinationCity?: string
  destinationDepartment?: string
  pickupPlace?: string
  scheduledDate?: string
  timeWindow?: string
  notes?: string
  status: 'scheduled' | 'ready_for_pickup' | 'cancelled'
} {
  return parseSchema(
    z.object({
      mode: z.enum(logisticsModes),
      originCity: z.string().trim().min(1).max(120).optional(),
      originDepartment: z.string().trim().min(1).max(120).optional(),
      destinationCity: z.string().trim().min(1).max(120).optional(),
      destinationDepartment: z.string().trim().min(1).max(120).optional(),
      pickupPlace: z.string().trim().min(1).max(300).optional(),
      scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha no es válida.').optional(),
      timeWindow: z.string().trim().min(1).max(80).optional(),
      notes: z.string().trim().min(1).max(1000).optional(),
      status: z.enum(['scheduled', 'ready_for_pickup', 'cancelled']),
    }),
    value,
  )
}

export function parseMovement(value: unknown): { quantity: number; occurredAt: string; notes?: string; condition?: 'good' | 'fair' | 'deteriorated' | 'different' | 'not_declared' } {
  return parseSchema(
    z.object({
      quantity,
      occurredAt: z.string().datetime({ offset: true, message: 'La fecha real debe incluir zona horaria.' }),
      notes: z.string().trim().min(1).max(1000).optional(),
      condition: z.enum(['good', 'fair', 'deteriorated', 'different', 'not_declared']).optional(),
    }),
    value,
  )
}

export function parseIncident(value: unknown): { type: 'unavailable' | 'short_quantity' | 'delay' | 'condition_difference' | 'delivery_cancelled' | 'receipt_pending'; description: string; deliveryId?: number } {
  return parseSchema(
    z.object({
      type: z.enum(['unavailable', 'short_quantity', 'delay', 'condition_difference', 'delivery_cancelled', 'receipt_pending']),
      description: z.string().trim().min(1, 'Describe la incidencia.').max(2000),
      deliveryId: z.coerce.number().int().positive().optional(),
    }),
    value,
  )
}

export function parseResolution(value: unknown): { resolution: string } {
  return parseSchema(z.object({ resolution: z.string().trim().min(1, 'La resolución es obligatoria.').max(2000) }), value)
}

export function parseRequestQuery(value: Record<string, unknown>): { box: string; q?: string; page: number; pageSize: number } {
  const normalized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const single = Array.isArray(item) ? item[0] : item
    if (single !== '') {
      normalized[key] = single
    }
  }
  return parseSchema(
    z.object({
      box: z.enum(['all', 'sent', 'received', 'pending', 'negotiating', 'accepted', 'rejected', 'cancelled', 'finished']).default('all'),
      q: z.string().trim().min(1).max(120).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(20).default(10),
    }),
    normalized,
  )
}
