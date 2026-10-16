import type { ReactNode } from 'react'
import styles from './Badge.module.css'

type BadgeProps = {
  children: ReactNode
  tone?: 'neutral' | 'warning' | 'ok' | 'info' | 'danger'
}

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>
}
