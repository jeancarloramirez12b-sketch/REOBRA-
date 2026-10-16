import type { ReactNode } from 'react'
import styles from './SectionHeader.module.css'

type SectionHeaderProps = {
  id?: string
  title: string
  children?: ReactNode
}

export function SectionHeader({ id, title, children }: SectionHeaderProps) {
  return (
    <div className={styles.header}>
      <h2 id={id}>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  )
}
