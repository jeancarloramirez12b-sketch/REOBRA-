import type { ReactNode } from 'react'
import { scenes } from '../visual/scenes.ts'
import sceneStyles from '../visual/scene.module.css'
import { Icon } from './Icon.tsx'
import styles from './ErrorState.module.css'

type ErrorStateProps = {
  title: string
  children: ReactNode
  action?: ReactNode
}

export function ErrorState({ title, children, action }: ErrorStateProps) {
  const scene = scenes.auth

  return (
    <div className={styles.error} role="alert">
      <div className={`${sceneStyles.still} ${styles.photo}`}>
        <img src={scene.src} alt="" />
      </div>
      <span className={styles.icon}>
        <Icon name="alert" />
      </span>
      <h1>{title}</h1>
      <div className={styles.copy}>{children}</div>
      {action}
    </div>
  )
}
