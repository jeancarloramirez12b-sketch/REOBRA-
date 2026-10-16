export type BackendConnectionStatus = 'checking' | 'connected' | 'unavailable'

export type BackendConnectionState = {
  status: BackendConnectionStatus
  message: string
  checkedAt: string | null
  endpoint: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHealthyPayload(value: unknown): boolean {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) {
    return false
  }

  return value.data.status === 'ok' && value.data.service === 'reobra-backend'
}

function unavailable(
  message: string,
  endpoint: string | null,
): BackendConnectionState {
  return {
    status: 'unavailable',
    message,
    checkedAt: new Date().toISOString(),
    endpoint,
  }
}

export async function checkBackendHealth(externalSignal?: AbortSignal): Promise<BackendConnectionState> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
  const endpoint = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api/health` : null

  if (!endpoint) {
    return unavailable(
      'La URL del backend no está configurada. Defina VITE_API_BASE_URL en frontend/.env.',
      null,
    )
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  const abortFromOutside = () => controller.abort()
  externalSignal?.addEventListener('abort', abortFromOutside)

  try {
    if (externalSignal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      return unavailable('El backend respondió con un error.', endpoint)
    }

    const payload: unknown = await response.json()
    if (!isHealthyPayload(payload)) {
      return unavailable('El backend respondió con un formato inesperado.', endpoint)
    }

    return {
      status: 'connected',
      message: 'El servicio está en ejecución.',
      checkedAt: new Date().toISOString(),
      endpoint,
    }
  } catch (error) {
    if (externalSignal?.aborted) {
      throw error
    }

    const timedOut = controller.signal.aborted
    return unavailable(
      timedOut ? 'El backend no respondió a tiempo.' : 'No se pudo contactar el backend.',
      endpoint,
    )
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromOutside)
  }
}
