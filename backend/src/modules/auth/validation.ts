import { z } from 'zod'
import { AppError } from '../../errors/AppError.js'

const emailSchema = z
  .string({ required_error: 'El correo es obligatorio.' })
  .trim()
  .max(254, 'El correo es demasiado largo.')
  .email('El correo no tiene un formato válido.')
  .transform((value) => value.toLowerCase())

const fullNameSchema = z
  .string({ required_error: 'El nombre es obligatorio.' })
  .trim()
  .min(1, 'El nombre es obligatorio.')
  .max(160, 'El nombre no puede superar 160 caracteres.')

const phoneSchema = z
  .string()
  .trim()
  .max(32, 'El teléfono no puede superar 32 caracteres.')
  .refine((value) => value.length === 0 || (value.length >= 7 && /^[0-9+\-().\s]+$/.test(value)), {
    message: 'El teléfono debe tener entre 7 y 32 caracteres.',
  })
  .transform((value) => (value.length === 0 ? null : value))

export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: z.string({ required_error: 'La contraseña es obligatoria.' }).min(1, 'La contraseña es obligatoria.').max(128),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'Debes aceptar las condiciones de la cuenta.' }),
    }),
  })
  .strict()

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string({ required_error: 'La contraseña es obligatoria.' }).min(1, 'La contraseña es obligatoria.').max(128),
  })
  .strict()

export const profileSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema.nullable().optional(),
  })
  .strict()

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'La contraseña actual es obligatoria.').max(128),
    newPassword: z.string().min(1, 'La nueva contraseña es obligatoria.').max(128),
  })
  .strict()

export const organizationSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(180, 'El nombre no puede superar 180 caracteres.'),
    organizationType: z.enum(['company', 'public_entity', 'educational', 'nonprofit', 'other'], {
      errorMap: () => ({ message: 'El tipo de organización no es válido.' }),
    }),
    contactEmail: emailSchema,
    city: z.string().trim().min(1, 'La ciudad es obligatoria.').max(120),
    department: z.string().trim().min(1, 'El departamento es obligatorio.').max(120),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'El país debe ser un código de dos letras.')
      .optional(),
    taxIdentifier: z
      .string()
      .trim()
      .max(32, 'El identificador tributario no puede superar 32 caracteres.')
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
  })
  .strict()

export const organizationPatchSchema = organizationSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'No hay cambios para guardar.',
})

const membershipRole = z.enum(['owner', 'administrator', 'editor', 'technical_reviewer', 'viewer'])
const inviteRole = z.enum(['administrator', 'editor', 'technical_reviewer', 'viewer'])

export const invitationSchema = z
  .object({
    email: emailSchema,
    role: inviteRole,
  })
  .strict()

export const memberPatchSchema = z
  .object({
    role: membershipRole.optional(),
    membershipStatus: z.enum(['active', 'suspended']).optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.membershipStatus !== undefined, {
    message: 'Indica el rol o el estado que quieres cambiar.',
  })

export const acceptInvitationSchema = z
  .object({
    token: z.string().trim().min(20, 'La invitación no es válida.').max(200, 'La invitación no es válida.'),
  })
  .strict()

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'La solicitud tiene datos inválidos.')
  }
  return parsed.data
}
