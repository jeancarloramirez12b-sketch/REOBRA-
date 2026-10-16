import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './api.ts'
import type { AccountUser, MembershipSummary, SessionPayload } from './types.ts'

const activeOrganizationKey = 'reobra.activeOrganization'

type AuthStatus = 'loading' | 'anonymous' | 'expired' | 'authenticated'

type AuthContextValue = {
  status: AuthStatus
  user: AccountUser | null
  memberships: MembershipSummary[]
  activeOrganizationId: number | null
  setActiveOrganizationId: (organizationId: number | null) => void
  refresh: () => Promise<void>
  establish: (payload: SessionPayload) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readActiveOrganization(): number | null {
  const raw = window.sessionStorage.getItem(activeOrganizationKey)
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AccountUser | null>(null)
  const [memberships, setMemberships] = useState<MembershipSummary[]>([])
  const [activeOrganizationId, setActiveOrganizationState] = useState<number | null>(null)

  const establish = useCallback((payload: SessionPayload) => {
    setUser(payload.user)
    setMemberships(payload.memberships)
    setStatus('authenticated')
    setActiveOrganizationState((current) => {
      const stored = current ?? readActiveOrganization()
      const active = payload.memberships.some(
        (membership) => membership.organizationId === stored && membership.membershipStatus === 'active',
      )
      return active ? stored : null
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const payload = await api<SessionPayload>('/api/auth/me')
      establish(payload)
    } catch (error) {
      setUser(null)
      setMemberships([])
      if (error instanceof ApiError && (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')) {
        setStatus('expired')
        return
      }
      setStatus('anonymous')
    }
  }, [establish])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setActiveOrganizationId = useCallback((organizationId: number | null) => {
    setActiveOrganizationState(organizationId)
    if (organizationId) {
      window.sessionStorage.setItem(activeOrganizationKey, String(organizationId))
    } else {
      window.sessionStorage.removeItem(activeOrganizationKey)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} })
    } catch {
      // Si la sesión ya no existe, el estado local igual debe quedar cerrado.
    }
    setUser(null)
    setMemberships([])
    setActiveOrganizationState(null)
    window.sessionStorage.removeItem(activeOrganizationKey)
    setStatus('anonymous')
  }, [])

  const value = useMemo(
    () => ({
      status,
      user,
      memberships,
      activeOrganizationId,
      setActiveOrganizationId,
      refresh,
      establish,
      logout,
    }),
    [status, user, memberships, activeOrganizationId, setActiveOrganizationId, refresh, establish, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth debe usarse dentro de AuthProvider.')
  }
  return value
}
