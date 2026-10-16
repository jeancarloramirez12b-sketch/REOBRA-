import { Link } from 'react-router-dom'
import styles from './Breadcrumbs.module.css'

type BreadcrumbsProps = {
  current: string
}

export function Breadcrumbs({ current }: BreadcrumbsProps) {
  return (
    <nav className={styles.nav} aria-label="Migas de pan">
      <ol>
        <li>
          <Link to="/">Inicio</Link>
        </li>
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  )
}
