import { useCallback, useEffect, useRef, useState } from 'react'
import { checkBackendHealth, type BackendConnectionState } from './healthService.ts'

export type BackendHealthController = BackendConnectionState & {
  retry: () => void
}

const initialState: BackendConnectionState = {
  status: 'checking',
  message: 'Comprobando conexión con el backend.',
  checkedAt: null,
  endpoint: null,
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function useBackendHealth(): BackendHealthController {
  const [state, setState] = useState<BackendConnectionState>(initialState)
  const requestId = useRef(0)

  const runCheck = useCallback(async (signal?: AbortSignal) => {
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setState((current) => ({
      ...current,
      status: 'checking',
      message: 'Comprobando conexión con el backend.',
    }))

    try {
      const next = await checkBackendHealth(signal)
      if (signal?.aborted || requestId.current !== currentRequest) {
        return
      }
      setState(next)
    } catch (error) {
      if (isAbortError(error) || signal?.aborted || requestId.current !== currentRequest) {
        return
      }
      setState({
        status: 'unavailable',
        message: 'No se pudo contactar el backend.',
        checkedAt: new Date().toISOString(),
        endpoint: null,
      })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void runCheck(controller.signal)
    return () => controller.abort()
  }, [runCheck])

  const retry = useCallback(() => {
    void runCheck()
  }, [runCheck])

  return { ...state, retry }
}
