import { z } from 'zod'
import { AppError } from '../../errors/AppError.js'
import { actionKinds, forbiddenActionKinds, type ActionKind } from './policy.js'

const modules = ['assistant', 'inventory', 'material', 'project', 'matching', 'impact'] as const

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'La solicitud tiene datos inválidos.')
  }
  return parsed.data
}

const optionalOrganization = z.number().int().positive().nullable().optional().transform((value) => value ?? null)

export function parseChat(value: unknown) {
  return parseSchema(z.object({
    message: z.string().trim().min(1, 'Escribe un mensaje.').max(4000, 'El mensaje es demasiado largo.'),
    conversationId: z.number().int().positive().optional(),
    moduleContext: z.enum(modules).nullable().optional().transform((item) => item ?? null),
    organizationId: optionalOrganization,
  }).strict(), value)
}

export function parseConversation(value: unknown) {
  return parseSchema(z.object({
    title: z.string().trim().min(1).max(160).optional(),
    moduleContext: z.enum(modules).nullable().optional().transform((item) => item ?? null),
    organizationId: optionalOrganization,
  }).strict(), value)
}

export function parseMaterialSuggestion(value: unknown) {
  return parseSchema(z.object({
    organizationId: optionalOrganization,
    title: z.string().trim().max(180).default(''),
    description: z.string().trim().max(4000).default(''),
    quantity: z.string().trim().max(40).default(''),
    unitName: z.string().trim().max(80).default(''),
    condition: z.string().trim().max(80).default(''),
    city: z.string().trim().max(120).default(''),
    department: z.string().trim().max(120).default(''),
    availabilityStatus: z.string().trim().max(40).default(''),
    hasEvidence: z.boolean().optional().default(false),
    restrictions: z.string().trim().max(500).default(''),
  }).strict(), value)
}

export function parseProjectSuggestion(value: unknown) {
  return parseSchema(z.object({
    organizationId: optionalOrganization,
    title: z.string().trim().max(180).default(''),
    description: z.string().trim().max(2000).default(''),
    quantity: z.string().trim().max(40).default(''),
    unitName: z.string().trim().max(80).default(''),
    categoryName: z.string().trim().max(160).default(''),
    condition: z.string().trim().max(80).default(''),
    specificationName: z.string().trim().max(80).default(''),
    specificationValue: z.string().trim().max(240).default(''),
  }).strict(), value)
}

export function parseMatchingExplain(value: unknown) {
  return parseSchema(z.object({
    needId: z.number().int().positive(),
    materialId: z.number().int().positive(),
  }).strict(), value)
}

export function parseImpactExplain(value: unknown) {
  return parseSchema(z.object({
    organizationId: z.number().int().positive().optional(),
    projectId: z.number().int().positive().optional(),
    indicator: z.string().trim().max(40).optional(),
  }).strict(), value)
}

const payloadSchemas: Record<ActionKind, z.ZodType<Record<string, unknown>>> = {
  prepare_description: z.object({ description: z.string().trim().min(1).max(4000) }).strict(),
  suggest_category: z.object({ categoryId: z.number().int().positive(), categoryName: z.string().trim().min(1).max(160) }).strict(),
  prepare_need: z.object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(500).optional().default(''),
    requiredQuantity: z.string().trim().max(40).optional().default(''),
    unitName: z.string().trim().max(80).optional().default(''),
  }).strict(),
  apply_search_filters: z.object({
    q: z.string().trim().max(120).optional().default(''),
    category: z.string().trim().max(80).optional().default(''),
    status: z.string().trim().max(40).optional().default(''),
  }).strict(),
  open_material: z.object({ materialId: z.number().int().positive() }).strict(),
}

export type ActionPreview = {
  kind: ActionKind
  summary: string
  payload: Record<string, unknown>
  organizationId: number | null
  conversationId?: number
}

export function parseActionPreview(value: unknown): ActionPreview {
  const parsed = parseSchema(z.object({
    kind: z.string().trim().max(40),
    summary: z.string().trim().min(1).max(500),
    payload: z.record(z.unknown()).optional().default({}),
    organizationId: optionalOrganization,
    conversationId: z.number().int().positive().optional(),
  }).strict(), value)
  if ((forbiddenActionKinds as readonly string[]).includes(parsed.kind)) {
    throw new AppError(400, 'ACTION_NOT_ALLOWED', 'El asistente no puede ejecutar esa acción.')
  }
  if (!(actionKinds as readonly string[]).includes(parsed.kind)) {
    throw new AppError(400, 'ACTION_NOT_ALLOWED', 'El asistente no puede ejecutar esa acción.')
  }
  const kind = parsed.kind as ActionKind
  return {
    kind,
    summary: parsed.summary,
    payload: parseActionPayload(kind, parsed.payload),
    organizationId: parsed.organizationId ?? null,
    conversationId: parsed.conversationId,
  }
}

export function parseActionPayload(kind: ActionKind, payload: unknown): Record<string, unknown> {
  return parseSchema(payloadSchemas[kind], payload ?? {})
}

export function parseFeedback(value: unknown) {
  return parseSchema(z.object({
    messageId: z.number().int().positive(),
    rating: z.enum(['helpful', 'not_helpful']),
    note: z.string().trim().max(500).nullable().optional().transform((item) => item || null),
  }).strict(), value)
}
