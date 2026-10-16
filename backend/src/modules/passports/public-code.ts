import { randomBytes } from 'node:crypto'

const publicCodePattern = /^rob_[a-z0-9]{20}$/

export function createPublicCode(): string {
  return `rob_${randomBytes(10).toString('hex')}`
}

export function isPublicCode(value: string): boolean {
  return publicCodePattern.test(value)
}

export function declaredOrigin(input: { originType: string; city: string; department: string }): string {
  return `Dato declarado por la organización. Procedencia: ${input.originType}. Lugar general: ${input.city}, ${input.department}.`.slice(
    0,
    2000,
  )
}
