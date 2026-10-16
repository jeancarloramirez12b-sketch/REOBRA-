import { z } from 'zod'
import { AppError } from '../../errors/AppError.js'
import { isPublicCode } from './public-code.js'

function parseSchema<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'La solicitud tiene datos inválidos.')
  }
  return parsed.data
}

const evidenceKinds = ['photograph', 'technical_sheet', 'inspection_report', 'origin_document', 'quality_document', 'other'] as const

export function parsePublicCode(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !isPublicCode(raw)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el pasaporte.')
  }
  return raw
}

export function parsePassportQuery(value: Record<string, unknown>): { q?: string; page: number; pageSize: number } {
  const normalized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const single = Array.isArray(item) ? item[0] : item
    if (single !== '') {
      normalized[key] = single
    }
  }
  return parseSchema(
    z
      .object({
        q: z.string().trim().max(120, 'La búsqueda no puede superar 120 caracteres.').optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(12),
      })
      .strict(),
    normalized,
  )
}

export function parseEventQuery(value: Record<string, unknown>): { page: number; pageSize: number } {
  const normalized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const single = Array.isArray(item) ? item[0] : item
    if (single !== '') {
      normalized[key] = single
    }
  }
  return parseSchema(
    z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .strict(),
    normalized,
  )
}

export function parseVisibility(value: unknown): { visibility: 'private' | 'public' } {
  return parseSchema(
    z
      .object({
        visibility: z.enum(['private', 'public'], { errorMap: () => ({ message: 'La visibilidad no es válida.' }) }),
      })
      .strict(),
    value,
  )
}

export function parseEvidenceFields(kind: unknown, disclosure: unknown): {
  evidenceKind: (typeof evidenceKinds)[number]
  disclosure: 'internal' | 'public'
} {
  return parseSchema(
    z.object({
      evidenceKind: z.enum(evidenceKinds, { errorMap: () => ({ message: 'El tipo de evidencia no es válido.' }) }),
      disclosure: z.enum(['internal', 'public'], { errorMap: () => ({ message: 'La visibilidad del documento no es válida.' }) }).default('internal'),
    }),
    { evidenceKind: kind, disclosure: disclosure === undefined || disclosure === '' ? 'internal' : disclosure },
  )
}

export function parseReview(value: unknown): { reviewStatus: 'reviewed' | 'not_accepted' } {
  return parseSchema(
    z
      .object({
        reviewStatus: z.enum(['reviewed', 'not_accepted'], {
          errorMap: () => ({ message: 'El estado de revisión no es válido.' }),
        }),
      })
      .strict(),
    value,
  )
}

export function parseOperationKey(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  if (!/^[a-z0-9:_-]{8,64}$/i.test(value)) {
    throw new AppError(400, 'INVALID_INPUT', 'La clave de operación no es válida.')
  }
  return value
}
