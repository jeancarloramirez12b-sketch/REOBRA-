import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { LoadingState } from '../../components/ui/LoadingState.tsx'
import { useAuth } from './AuthProvider.tsx'

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') {
    return <LoadingState label="Comprobando la sesión." />
  }
  if (auth.status === 'expired') {
    return <Navigate to="/sesion-expirada" replace />
  }
  if (auth.status !== 'authenticated') {
    return <Navigate to="/ingresar" replace state={{ from: location.pathname }} />
  }

  return children
}
