import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { pageTitle } from '../../routes/navigation.ts'
import type { BackendHealthController } from '../../services/useBackendHealth.ts'
import { Breadcrumbs } from '../ui/Breadcrumbs.tsx'
import { ConnectionStatus } from '../ui/ConnectionStatus.tsx'
import { Icon } from '../ui/Icon.tsx'
import { IconButton } from '../ui/IconButton.tsx'
import styles from './Header.module.css'

type HeaderProps = {
  health: BackendHealthController
  menuOpen: boolean
  onOpenMenu: () => void
}

export function Header({ health, menuOpen, onOpenMenu }: HeaderProps) {
  const location = useLocation()
  const auth = useAuth()
  const title = pageTitle(location.pathname)
  const activeMemberships = auth.memberships.filter((membership) => membership.membershipStatus === 'active')

  useEffect(() => {
    document.title = title === 'Inicio' ? 'REOBRA' : `${title} · REOBRA`
  }, [title])

  return (
    <header className={styles.header}>
      <IconButton className={styles.menu} label="Abrir menú" aria-expanded={menuOpen} aria-controls="navegacion-principal" onClick={onOpenMenu}>
        <Icon name="menu" />
      </IconButton>
      <div className={styles.heading}>
        {location.pathname !== '/' ? <Breadcrumbs current={title} /> : null}
        <p className={styles.title}>{title}</p>
      </div>
      <div className={styles.account}>
        {auth.status === 'authenticated' ? (
          <>
            {activeMemberships.length > 0 ? (
              <label className={styles.org}>
                <span>Organización activa</span>
                <select
                  value={auth.activeOrganizationId ?? ''}
                  onChange={(event) => auth.setActiveOrganizationId(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">Sin selección</option>
                  {activeMemberships.map((membership) => (
                    <option key={membership.organizationId} value={membership.organizationId}>
                      {membership.organizationName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Link to="/perfil">Mi perfil</Link>
            <Link to="/organizaciones">Organizaciones</Link>
            <button type="button" onClick={() => void auth.logout()}>Salir</button>
          </>
        ) : auth.status === 'loading' ? null : (
          <>
            <Link to="/ingresar">Ingresar</Link>
            <Link to="/registro">Crear cuenta</Link>
          </>
        )}
      </div>
      <ConnectionStatus health={health} compact />
    </header>
  )
}
