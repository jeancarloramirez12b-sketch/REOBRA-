import { Link, useOutletContext } from 'react-router-dom'
import type { ShellContext } from '../components/layout/shellContext.ts'
import { Button } from '../components/ui/Button.tsx'
import { ConnectionStatus } from '../components/ui/ConnectionStatus.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Tabs } from '../components/ui/Tabs.tsx'
import styles from './screen.module.css'

export function SettingsPage() {
  const { health, sidebarCollapsed, toggleSidebar } = useOutletContext<ShellContext>()

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Plataforma" title="Configuración">
        <p>Preferencias de esta instalación, estado técnico y acceso a la cuenta. Los módulos de materiales siguen en preparación.</p>
      </PageHeader>

      <Tabs
        label="Secciones de configuración"
        tabs={[
          {
            id: 'interfaz',
            label: 'Interfaz',
            content: (
              <div className={styles.stack}>
                <p className={styles.note}>
                  La barra lateral {sidebarCollapsed ? 'está contraída' : 'está expandida'} en escritorio. La elección se
                  guarda en este navegador.
                </p>
                <Button variant="quiet" onClick={toggleSidebar}>
                  {sidebarCollapsed ? 'Expandir la barra lateral' : 'Contraer la barra lateral'}
                </Button>
              </div>
            ),
          },
          {
            id: 'sistema',
            label: 'Sistema',
            content: (
              <div className={styles.stack}>
                <dl className={styles.legend}>
                  <div className={styles.field}>
                    <span>Aplicación</span>
                    <strong>REOBRA</strong>
                    <small>Identidad, organizaciones, inventario, pasaporte, proyectos, matching, operaciones e indicadores de impacto. Una estimación no certifica emisiones.</small>
                  </div>
                </dl>
                <ConnectionStatus health={health} onRetry={health.retry} />
              </div>
            ),
          },
          {
            id: 'cuenta',
            label: 'Cuenta',
            content: (
              <div className={styles.stack}>
                <p className={styles.note}>
                  La sesión vive en una cookie del navegador. El servidor guarda solo el hash del identificador.
                </p>
                <p>
                  <Link to="/perfil">Mi perfil</Link>
                  {' · '}
                  <Link to="/organizaciones">Mis organizaciones</Link>
                  {' · '}
                  <Link to="/ingresar">Ingresar</Link>
                </p>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
