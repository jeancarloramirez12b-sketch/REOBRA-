import { z } from 'zod'
import { AppError } from '../../errors/AppError.js'
import { priorities, projectStatuses, projectTypes, visibilities } from './states.js'

function parseSchema<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'La solicitud tiene datos inválidos.')
  }
  return parsed.data
}

function requiredText(label: string, max: number) {
  return z
    .string({ required_error: `${label} es obligatorio.` })
    .trim()
    .min(1, `${label} es obligatorio.`)
    .max(max, `${label} no puede superar ${max} caracteres.`)
}

function optionalText(max: number, message: string) {
  return z
    .union([
      z.string().max(max, message).transform((value) => {
        const trimmed = value.trim()
        return trimmed.length === 0 ? null : trimmed
      }),
      z.null(),
    ])
    .optional()
}

const identifierSchema = z.coerce
  .number({ invalid_type_error: 'El identificador no es válido.' })
  .int('El identificador no es válido.')
  .positive('El identificador no es válido.')
  .refine((value) => Number.isSafeInteger(value), 'El identificador no es válido.')

const quantitySchema = z.union([z.number(), z.string()]).transform((value, context) => {
  const raw = typeof value === 'number' ? value.toString() : value.trim()
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(raw) || Number(raw) <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La cantidad debe ser mayor que cero, con hasta 3 decimales.',
    })
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

const dateField = z.union([z.string(), z.null()]).transform((value, context) => {
  if (value === null) {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (!realDate(trimmed)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha no es válida.' })
    return z.NEVER
  }
  return trimmed
})

const specificationSchema = z
  .array(
    z.object({
      name: requiredText('El requisito', 80),
      value: requiredText('El valor del requisito', 240),
    }),
  )
  .max(12, 'Una necesidad admite hasta 12 requisitos.')

const projectBody = {
  title: requiredText('El nombre', 180),
  description: optionalText(4000, 'La descripción no puede superar 4000 caracteres.'),
  projectType: z.enum(projectTypes, { errorMap: () => ({ message: 'El tipo de proyecto no es válido.' }) }),
  city: requiredText('El municipio', 120),
  department: requiredText('El departamento', 120),
  address: optionalText(240, 'La dirección no puede superar 240 caracteres.'),
  startDate: dateField.optional(),
  endDate: dateField.optional(),
  visibility: z.enum(visibilities, { errorMap: () => ({ message: 'La visibilidad no es válida.' }) }).optional(),
  responsibleUserId: identifierSchema.nullable().optional(),
}

export function parseCreateProject(value: unknown) {
  return parseSchema(
    z
      .object({
        organizationId: identifierSchema,
        ...projectBody,
        status: z.enum(['draft', 'active'], { errorMap: () => ({ message: 'El proyecto nuevo solo puede quedar en borrador o activo.' }) }).optional(),
      })
      .strict(),
    value,
  )
}

export function parseUpdateProject(value: unknown) {
  return parseSchema(z.object(projectBody).partial().strict(), value)
}

export function parseProjectStatus(value: unknown) {
  return parseSchema(
    z
      .object({
        status: z.enum(projectStatuses, { errorMap: () => ({ message: 'El estado del proyecto no es válido.' }) }),
      })
      .strict(),
    value,
  )
}

export function parseProjectQuery(value: Record<string, unknown>) {
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
        status: z.enum(projectStatuses, { errorMap: () => ({ message: 'El estado del proyecto no es válido.' }) }).optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(12),
      })
      .strict(),
    normalized,
  )
}

const needBody = {
  categoryId: identifierSchema,
  unitId: identifierSchema,
  title: requiredText('El material solicitado', 180),
  description: requiredText('La descripción', 500),
  requiredQuantity: quantitySchema,
  requiredCondition: z
    .enum(['not_declared', 'good', 'fair', 'deteriorated', 'mixed'], {
      errorMap: () => ({ message: 'La condición aceptable no es válida.' }),
    })
    .nullable()
    .optional(),
  priority: z.enum(priorities, { errorMap: () => ({ message: 'La prioridad no es válida.' }) }).optional(),
  neededBy: dateField.optional(),
  city: optionalText(120, 'El municipio no puede superar 120 caracteres.'),
  department: optionalText(120, 'El departamento no puede superar 120 caracteres.'),
  locationDescription: optionalText(500, 'La ubicación no puede superar 500 caracteres.'),
  observations: optionalText(2000, 'Las observaciones no pueden superar 2000 caracteres.'),
  specifications: specificationSchema.optional(),
  visibility: z.enum(visibilities, { errorMap: () => ({ message: 'La visibilidad no es válida.' }) }).optional(),
}

export function parseCreateNeed(value: unknown) {
  return parseSchema(
    z
      .object({
        ...needBody,
        status: z.enum(['draft', 'open'], { errorMap: () => ({ message: 'La necesidad nueva solo puede quedar en borrador o abierta.' }) }).optional(),
      })
      .strict(),
    value,
  )
}

export function parseUpdateNeed(value: unknown) {
  return parseSchema(z.object(needBody).partial().strict(), value)
}

export function parseNeedQuery(value: Record<string, unknown>) {
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
        q: z.string().trim().max(120).optional(),
        status: z
          .enum(['draft', 'open', 'paused', 'partially_covered', 'covered', 'satisfied', 'cancelled'], {
            errorMap: () => ({ message: 'El estado de la necesidad no es válido.' }),
          })
          .optional(),
        priority: z.enum(priorities).optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .strict(),
    normalized,
  )
}

export function parsePublicProjectCode(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^prj_[a-z0-9]{20}$/.test(raw)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el proyecto.')
  }
  return raw
}
