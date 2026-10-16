export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`
  for (const part of document.cookie.split(';')) {
    const item = part.trim()
    if (item.startsWith(prefix)) {
      return decodeURIComponent(item.slice(prefix.length))
    }
  }
  return null
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; form?: FormData; idempotencyKey?: string } = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
  if (!baseUrl) {
    throw new ApiError(0, 'UNCONFIGURED', 'La URL del backend no está configurada.')
  }

  const method = options.method ?? 'GET'
  const headers = new Headers({ Accept: 'application/json' })
  if (options.form === undefined && options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie('reobra_csrf')
    if (csrf) {
      headers.set('X-CSRF-Token', csrf)
    }
  }
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey)
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se pudo contactar el backend.')
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null
    throw new ApiError(
      response.status,
      error ? String(error.code) : 'REQUEST_FAILED',
      error ? String(error.message) : 'La solicitud no se pudo completar.',
    )
  }

  return payload.data as T
}

export async function apiBlob(path: string): Promise<Blob> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
  if (!baseUrl) {
    throw new ApiError(0, 'UNCONFIGURED', 'La URL del backend no está configurada.')
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { method: 'GET', credentials: 'include', headers: { Accept: 'image/*' } })
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se pudo contactar el backend.')
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null
    throw new ApiError(
      response.status,
      error ? String(error.code) : 'REQUEST_FAILED',
      error ? String(error.message) : 'No se pudo abrir la imagen.',
    )
  }

  return response.blob()
}
