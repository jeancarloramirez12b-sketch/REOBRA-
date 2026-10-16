import type { Response } from 'express'

export const sessionCookieName = 'reobra_session'
export const csrfCookieName = 'reobra_csrf'
export const sessionTtlSeconds = 60 * 60 * 12
export const sessionRotationSeconds = 60 * 60 * 6

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null
  }

  for (const part of header.split(';')) {
    const item = part.trim()
    const separator = item.indexOf('=')
    if (separator === -1) {
      continue
    }
    if (item.slice(0, separator) === name) {
      return item.slice(separator + 1)
    }
  }

  return null
}

function cookieSuffix(maxAge: number, secure: boolean): string {
  const parts = [`Path=/`, `Max-Age=${maxAge}`, 'SameSite=Lax']
  if (secure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function writeSessionCookies(res: Response, token: string, csrf: string, secure: boolean): void {
  const suffix = cookieSuffix(sessionTtlSeconds, secure)
  res.append('Set-Cookie', `${sessionCookieName}=${token}; HttpOnly; ${suffix}`)
  res.append('Set-Cookie', `${csrfCookieName}=${csrf}; ${suffix}`)
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  const suffix = cookieSuffix(0, secure)
  res.append('Set-Cookie', `${sessionCookieName}=; HttpOnly; ${suffix}`)
  res.append('Set-Cookie', `${csrfCookieName}=; ${suffix}`)
}
