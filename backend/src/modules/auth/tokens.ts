import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashesMatch(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex')
  const right = Buffer.from(rightHex, 'hex')
  if (left.length === 0 || left.length !== right.length) {
    return false
  }

  return timingSafeEqual(left, right)
}
