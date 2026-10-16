import type { ReactNode } from 'react'
import { scenes, type SceneId } from '../visual/scenes.ts'
import { Icon, type IconName } from './Icon.tsx'
import styles from './EmptyState.module.css'
import sceneStyles from '../visual/scene.module.css'

const sceneByIcon: Partial<Record<IconName, SceneId>> = {
  home: 'home',
  inventory: 'inventory',
  passport: 'passport',
  projects: 'project',
  compatibility: 'matching',
  deliveries: 'logistics',
  impact: 'impact',
  assistant: 'assistant',
  settings: 'organization',
  user: 'auth',
  organization: 'organization',
}

type EmptyStateProps = {
  icon?: IconName
  scene?: SceneId
  title: string
  children: ReactNode
}

export function EmptyState({ icon = 'info', scene, title, children }: EmptyStateProps) {
  const picture = scenes[scene ?? sceneByIcon[icon] ?? 'home']

  return (
    <div className={styles.empty}>
      <div className={`${sceneStyles.still} ${styles.photo}`}>
        <img src={picture.src} alt={picture.alt} />
      </div>
      <span className={styles.icon}>
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      <div className={styles.copy}>{children}</div>
    </div>
  )
}
