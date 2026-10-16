import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './Card.module.css'

type CardProps = {
  children: ReactNode
  to?: string
  accent?: 'mint' | 'cyan'
}

export function Card({ children, to, accent = 'mint' }: CardProps) {
  const className = `${styles.card} ${accent === 'cyan' ? styles.cyan : styles.mint}`
  if (to) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    )
  }
  return <article className={className}>{children}</article>
}
