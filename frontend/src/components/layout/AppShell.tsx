import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useBackendHealth } from '../../services/useBackendHealth.ts'
import { SceneBanner } from '../visual/SceneBanner.tsx'
import { Header } from './Header.tsx'
import { Sidebar } from './Sidebar.tsx'
import type { ShellContext } from './shellContext.ts'
import styles from './AppShell.module.css'

const sidebarStorageKey = 'reobra.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === '1'
  } catch {
    return false
  }
}

const compactQuery = '(max-width: 900px)'

export function AppShell() {
  const health = useBackendHealth()
  const location = useLocation()
  const [isCompact, setIsCompact] = useState(() => window.matchMedia(compactQuery).matches)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed)

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(sidebarStorageKey, next ? '1' : '0')
      } catch {
        // La preferencia solo vive en memoria si el navegador bloquea el almacenamiento.
      }
      return next
    })
  }

  const shellContext: ShellContext = {
    health,
    sidebarCollapsed,
    toggleSidebar,
  }

  useEffect(() => {
    const media = window.matchMedia(compactQuery)
    const update = () => setIsCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isCompact) {
      setMobileOpen(false)
    }
  }, [isCompact])

  useEffect(() => {
    if (!mobileOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  useEffect(() => {
    if (!isCompact || !mobileOpen) {
      return
    }

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isCompact, mobileOpen])

  return (
    <div className={styles.shell} data-collapsed={sidebarCollapsed && !isCompact ? 'true' : 'false'}>
      <a className={styles.skip} href="#contenido">
        Saltar al contenido
      </a>
      {isCompact && mobileOpen ? (
        <button type="button" className={styles.backdrop} aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />
      ) : null}
      <Sidebar
        mobileOpen={mobileOpen}
        collapsed={sidebarCollapsed && !isCompact}
        inert={isCompact && !mobileOpen}
        onNavigate={() => setMobileOpen(false)}
        onToggleCollapse={toggleSidebar}
      />
      <div className={styles.mainColumn}>
        <Header health={health} menuOpen={mobileOpen} onOpenMenu={() => setMobileOpen(true)} />
        <main id="contenido" className={styles.content}>
          <div className={styles.contentInner}>
            <SceneBanner />
            <Outlet context={shellContext} />
          </div>
        </main>
      </div>
    </div>
  )
}
