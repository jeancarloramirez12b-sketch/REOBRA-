import type { ReactNode } from 'react'
import { Badge } from './Badge.tsx'
import styles from './PageHeader.module.css'

type PageHeaderProps = {
  eyebrow?: string
  title: string
  children?: ReactNode
  actions?: ReactNode
  planned?: boolean
}

export function PageHeader({ eyebrow, title, children, actions, planned = false }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <div className={styles.titleRow}>
          <h1>{title}</h1>
          {planned ? <Badge tone="warning">Disponible próximamente</Badge> : null}
        </div>
        {children ? <div className={styles.text}>{children}</div> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}
