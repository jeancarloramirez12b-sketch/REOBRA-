import { NavLink, useLocation } from 'react-router-dom'
import logoUrl from '../../assets/logo.svg'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { sections } from '../../routes/navigation.ts'
import { Icon } from '../ui/Icon.tsx'
import { IconButton } from '../ui/IconButton.tsx'
import { sceneForPath, scenes } from '../visual/scenes.ts'
import sceneStyles from '../visual/scene.module.css'
import styles from './Sidebar.module.css'

type SidebarProps = {
  mobileOpen: boolean
  collapsed: boolean
  inert: boolean
  onNavigate: () => void
  onToggleCollapse: () => void
}

export function Sidebar({ mobileOpen, collapsed, inert, onNavigate, onToggleCollapse }: SidebarProps) {
  const auth = useAuth()
  const { pathname } = useLocation()
  const scene = scenes[sceneForPath(pathname)]
  const accountLinks = auth.status === 'authenticated'
    ? [
        { path: '/perfil', label: 'Mi perfil', icon: 'user' as const },
        { path: '/organizaciones', label: 'Mis organizaciones', icon: 'organization' as const },
        { path: '/invitacion', label: 'Aceptar invitación', icon: 'chevron' as const },
      ]
    : [
        { path: '/ingresar', label: 'Ingresar', icon: 'user' as const },
        { path: '/registro', label: 'Crear cuenta', icon: 'organization' as const },
      ]
  const className = [styles.sidebar, mobileOpen ? styles.open : '', collapsed ? styles.collapsed : '']
    .filter(Boolean)
    .join(' ')

  return (
    <aside id="navegacion-principal" className={className} aria-label="Navegación principal" inert={inert}>
      <div className={styles.brand}>
        <img src={logoUrl} width="36" height="36" alt="" />
        <div className={styles.brandCopy}>
          <p className={styles.wordmark}>REOBRA</p>
          <p className={styles.tagline}>Materiales recuperables</p>
        </div>
        <IconButton className={styles.close} label="Cerrar menú" onClick={onNavigate}>
          <Icon name="close" />
        </IconButton>
      </div>
      {collapsed ? null : (
        <div className={sceneStyles.thumb}>
          <img src={scene.src} alt={scene.alt} />
        </div>
      )}
      <nav className={styles.nav} aria-label="Secciones">
        {sections.map((section) => (
          <NavLink
            key={section.path}
            to={section.path}
            end={section.path === '/'}
            className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
            onClick={onNavigate}
            title={collapsed ? section.label : undefined}
          >
            <Icon name={section.icon} />
            <span className={styles.label}>{section.label}</span>
          </NavLink>
        ))}
      </nav>
      <nav className={styles.nav} aria-label="Cuenta">
        {accountLinks.map((link) => (
          <NavLink
            key={link.path}
            to={link.path}
            className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
            onClick={onNavigate}
            title={collapsed ? link.label : undefined}
          >
            <Icon name={link.icon} />
            <span className={styles.label}>{link.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className={styles.footer}>
        <p className={styles.phase}>Fase 11 · Asistente</p>
        <IconButton
          className={styles.collapse}
          label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          aria-expanded={!collapsed}
          aria-controls="navegacion-principal"
          onClick={onToggleCollapse}
        >
          <Icon name="panel" />
        </IconButton>
      </div>
    </aside>
  )
}
