import { useOutletContext } from 'react-router-dom'
import type { ShellContext } from '../components/layout/shellContext.ts'
import { Card } from '../components/ui/Card.tsx'
import { ConnectionStatus } from '../components/ui/ConnectionStatus.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { SectionHeader } from '../components/ui/SectionHeader.tsx'
import { scenes, type SceneId } from '../components/visual/scenes.ts'
import sceneStyles from '../components/visual/scene.module.css'
import styles from './screen.module.css'

const access: Array<{ to: string; title: string; text: string; icon: 'inventory' | 'projects' | 'passport' | 'compatibility' | 'deliveries' | 'impact' | 'assistant' | 'organization'; scene: SceneId; accent: 'mint' | 'cyan' }> = [
  { to: '/inventario', title: 'Explorar materiales', text: 'Consulta y registra los materiales de tu organización.', icon: 'inventory', scene: 'inventory', accent: 'mint' },
  { to: '/proyectos', title: 'Consultar proyectos', text: 'Registra obras y las necesidades de material de tu organización.', icon: 'projects', scene: 'project', accent: 'cyan' },
  { to: '/pasaporte', title: 'Conocer la trazabilidad', text: 'Abre el pasaporte digital y el historial de un material.', icon: 'passport', scene: 'passport', accent: 'mint' },
  { to: '/compatibilidad', title: 'Comparar materiales', text: 'El motor de coincidencias explica cobertura y puntaje por separado.', icon: 'compatibility', scene: 'matching', accent: 'cyan' },
  { to: '/solicitudes', title: 'Seguir una entrega', text: 'Solicitudes, reservas, despachos y recepciones confirmadas.', icon: 'deliveries', scene: 'logistics', accent: 'mint' },
  { to: '/impacto', title: 'Comprender el impacto', text: 'Indicadores de lo recibido y confirmado, con la evidencia y las limitaciones de cada cifra.', icon: 'impact', scene: 'impact', accent: 'cyan' },
  { to: '/asistente', title: 'Preguntar al asistente', text: 'Orientación y borradores sobre los datos que ya puedes consultar. No certifica materiales.', icon: 'assistant', scene: 'assistant', accent: 'mint' },
  { to: '/organizaciones', title: 'Organizaciones', text: 'El espacio de trabajo de cada organización y sus roles.', icon: 'organization', scene: 'organization', accent: 'cyan' },
]

const steps: Array<[string, string, string, SceneId]> = [
  ['01', 'Identificar', 'Materiales sobrantes o potencialmente recuperables.', 'inventory'],
  ['02', 'Evaluar', 'Condición y posibilidades de uso, sin darlos por aptos de antemano.', 'passport'],
  ['03', 'Conectar', 'Relacionar materiales con necesidades de proyectos.', 'matching'],
  ['04', 'Coordinar', 'Solicitudes, reservas y entregas confirmadas por las dos organizaciones.', 'logistics'],
  ['05', 'Registrar', 'Resultados verificables, no estimaciones presentadas como hechos.', 'impact'],
]

export function HomePage() {
  const { health } = useOutletContext<ShellContext>()

  return (
    <div className={styles.page}>
      <section className={styles.welcome}>
        <p className={styles.index}>Economía circular · Construcción e industria</p>
        <h1>Transformamos materiales disponibles en nuevas oportunidades.</h1>
        <p className={styles.lead}>
          REOBRA conecta recursos, organizaciones y proyectos para impulsar una construcción más circular.
        </p>
        <p className={styles.note}>
          Esta versión permite crear una cuenta, una organización, el inventario, el pasaporte digital, los
          proyectos y sus necesidades, una comparación explicable, la operación de solicitudes, la medición de lo recibido y confirmado
          y un asistente que explica esos datos cuando el proveedor está configurado.
        </p>
      </section>

      <section className={styles.stack} aria-labelledby="accesos">
        <SectionHeader id="accesos" title="Recorrer REOBRA">
          El inventario, el pasaporte, los proyectos, el matching, las operaciones, el centro de impacto y el asistente usan registros reales.
        </SectionHeader>
        <div className={styles.accessGrid}>
          {access.map((item) => (
            <Card key={item.to} to={item.to} accent={item.accent}>
              <div className={sceneStyles.thumb}>
                <img src={scenes[item.scene].src} alt={scenes[item.scene].alt} />
              </div>
              <Icon name={item.icon} />
              <h2>{item.title}</h2>
              <p className={styles.note}>{item.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className={styles.stack} aria-labelledby="proceso">
        <SectionHeader id="proceso" title="Cómo funciona REOBRA">
          Este recorrido describe el propósito de la plataforma. Todavía no está automatizado.
        </SectionHeader>
        <ol className={styles.steps}>
          {steps.map(([index, title, text, scene]) => (
            <li key={index}>
              <div className={sceneStyles.thumb}>
                <img src={scenes[scene].src} alt={scenes[scene].alt} />
              </div>
              <span>{index}</span>
              <strong>{title}</strong>
              <small>{text}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.stack} aria-labelledby="estado-sistema">
        <SectionHeader id="estado-sistema" title="Estado del sistema" />
        {health.status === 'checking' ? (
          <LoadingState label="Comprobando conexión con el backend." />
        ) : (
          <ConnectionStatus health={health} onRetry={health.retry} />
        )}
      </section>
    </div>
  )
}
