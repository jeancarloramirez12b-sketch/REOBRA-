import { z } from 'zod'
import { AppError } from '../../errors/AppError.js'

function parseSchema<T>(schema: z.ZodTypeAny, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'La solicitud tiene datos inválidos.')
  }
  return parsed.data as T
}

const availabilityStatuses = ['draft', 'published', 'paused', 'withdrawn'] as const
const conditions = ['not_declared', 'good', 'fair', 'deteriorated', 'mixed'] as const
const origins = ['construction', 'industrial', 'demolition', 'other'] as const

const protectedFields = [
  'id',
  'organizationId',
  'createdByUserId',
  'technicalValidationStatus',
  'organization_id',
  'created_by_user_id',
  'technical_validation_status',
]

function requiredText(label: string, max: number) {
  return z
    .string({ required_error: `${label} es obligatorio.` })
    .trim()
    .min(1, `${label} es obligatorio.`)
    .max(max, `${label} no puede superar ${max} caracteres.`)
}

function nullableText(max: number, message: string) {
  return z.union([
    z.string().max(max, message).transform((value) => {
      const trimmed = value.trim()
      return trimmed.length === 0 ? null : trimmed
    }),
    z.null(),
  ])
}

const identifierSchema = z.coerce
  .number({ invalid_type_error: 'El identificador no es válido.' })
  .int('El identificador no es válido.')
  .positive('El identificador no es válido.')
  .refine((value) => Number.isSafeInteger(value), 'El identificador no es válido.')

const quantitySchema = z.union([z.number(), z.string()]).transform((value, context) => {
  const raw = typeof value === 'number' ? value.toString() : value.trim()
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(raw)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La cantidad debe ser un número mayor que cero, con hasta 3 decimales.',
    })
    return z.NEVER
  }
  if (Number(raw) <= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'La cantidad debe ser mayor que cero.' })
    return z.NEVER
  }
  return raw
})

function realDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 2000 || year > 2100) {
    return false
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const availableFromField = z.union([z.string(), z.null()]).transform((value, context) => {
  if (value === null) {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (!realDate(trimmed)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha de disponibilidad no es válida.' })
    return z.NEVER
  }
  return trimmed
})

const conditionField = z.enum(conditions, { errorMap: () => ({ message: 'La condición declarada no es válida.' }) })
const originField = z.enum(origins, { errorMap: () => ({ message: 'La procedencia no es válida.' }) })
const statusField = z.enum(availabilityStatuses, { errorMap: () => ({ message: 'El estado del registro no es válido.' }) })

export const createMaterialSchema = z
  .object({
    organizationId: identifierSchema,
    categoryId: identifierSchema,
    unitId: identifierSchema,
    title: requiredText('El nombre', 180),
    description: nullableText(4000, 'La descripción no puede superar 4000 caracteres.').optional(),
    materialCondition: conditionField.optional(),
    quantity: quantitySchema,
    originType: originField,
    city: requiredText('El municipio o la ciudad', 120),
    department: requiredText('El departamento', 120),
    locationDescription: nullableText(500, 'La ubicación general no puede superar 500 caracteres.').optional(),
    availabilityStatus: statusField.optional(),
    availableFrom: availableFromField.optional(),
  })
  .strict()

export const updateMaterialSchema = z
  .object({
    categoryId: identifierSchema.optional(),
    unitId: identifierSchema.optional(),
    title: requiredText('El nombre', 180).optional(),
    description: nullableText(4000, 'La descripción no puede superar 4000 caracteres.').optional(),
    materialCondition: conditionField.optional(),
    quantity: quantitySchema.optional(),
    originType: originField.optional(),
    city: requiredText('El municipio o la ciudad', 120).optional(),
    department: requiredText('El departamento', 120).optional(),
    locationDescription: nullableText(500, 'La ubicación general no puede superar 500 caracteres.').optional(),
    availabilityStatus: statusField.optional(),
    availableFrom: availableFromField.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'No hay cambios para guardar.',
  })

export const materialStatusSchema = z
  .object({
    availabilityStatus: statusField,
  })
  .strict()

const queryIdentifier = z
  .string()
  .regex(/^[1-9]\d*$/, 'El identificador no es válido.')
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value), 'El identificador no es válido.')

export const materialQuerySchema = z
  .object({
    q: z.string().trim().max(120, 'La búsqueda no puede superar 120 caracteres.').optional(),
    categoryId: queryIdentifier.optional(),
    organizationId: queryIdentifier.optional(),
    status: statusField.optional(),
    availability: z
      .enum(['available', 'unavailable'], { errorMap: () => ({ message: 'El filtro de disponibilidad no es válido.' }) })
      .optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
    sort: z.enum(['updated_at', 'created_at', 'title']).default('updated_at'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict()

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>
export type MaterialQuery = z.infer<typeof materialQuerySchema>
export type MaterialStatus = (typeof availabilityStatuses)[number]

export function rejectTechnicalClaim(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return
  }
  if ('technicalValidationStatus' in value || 'technical_validation_status' in value) {
    throw new AppError(400, 'INVALID_INPUT', 'La evaluación técnica no se declara en el inventario.')
  }
}

export function rejectProtectedMaterialFields(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return
  }
  for (const field of protectedFields) {
    if (field in value) {
      throw new AppError(400, 'INVALID_INPUT', 'Ese dato no se puede modificar desde el inventario.')
    }
  }
}

export function parseMaterialQuery(value: Record<string, unknown>): MaterialQuery {
  const normalized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const single = Array.isArray(item) ? item[0] : item
    if (single !== '') {
      normalized[key] = single
    }
  }
  return parseSchema<MaterialQuery>(materialQuerySchema, normalized)
}

export function parseCreateMaterial(value: unknown): CreateMaterialInput {
  rejectTechnicalClaim(value)
  return parseSchema<CreateMaterialInput>(createMaterialSchema, value)
}

export function parseUpdateMaterial(value: unknown): UpdateMaterialInput {
  rejectProtectedMaterialFields(value)
  return parseSchema<UpdateMaterialInput>(updateMaterialSchema, value)
}

export function parseMaterialStatus(value: unknown): { availabilityStatus: MaterialStatus } {
  rejectProtectedMaterialFields(value)
  return parseSchema<{ availabilityStatus: MaterialStatus }>(materialStatusSchema, value)
}
